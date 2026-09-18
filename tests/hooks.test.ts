import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCatalog, retrieveEvidence } from '../src/archive.js';
import { checkpointPaths, runHook } from '../src/hooks.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function records(label: string, count = 0): Record<string, unknown>[] {
  return [
    { type: 'session_meta', payload: { id: 'test' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: `request-${label}` } },
    { type: 'response_item', payload: {
      type: 'function_call', call_id: `call-${label}`, name: 'read_file', arguments: '{"path":"evidence.txt"}',
    } },
    { type: 'response_item', payload: {
      type: 'function_call_output', call_id: `call-${label}`, output: `tool evidence for ${label}`,
    } },
    { type: 'response_item', payload: {
      type: 'reasoning', channel: 'analysis', content: `private reasoning for ${label}`,
    } },
    ...Array.from({ length: count }, (_, index) => ({
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: `${label}-tail-${index}` },
    })),
  ];
}

function transcriptText(label: string, count = 0): string {
  return records(label, count).map((record) => JSON.stringify(record)).join('\n') + '\n';
}

async function fixture(label = 'first') {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-hooks-'));
  temporaryDirectories.push(root);
  const data = join(root, 'data');
  const transcript = join(root, 'rollout.jsonl');
  const cwd = join(root, 'project');
  await writeFile(transcript, transcriptText(label), 'utf8');
  const env: NodeJS.ProcessEnv = { FAST_JEV_DATA_DIR: data };
  return { root, data, transcript, cwd, env };
}

function preInput(value: Awaited<ReturnType<typeof fixture>>, session = 'session-a') {
  return {
    hook_event_name: 'PreCompact',
    session_id: session,
    transcript_path: value.transcript,
    cwd: value.cwd,
  } as const;
}

function compactStart(value: Awaited<ReturnType<typeof fixture>>, session = 'session-a') {
  return {
    hook_event_name: 'SessionStart',
    source: 'compact',
    session_id: session,
    transcript_path: value.transcript,
    cwd: value.cwd,
  } as const;
}

describe('Codex hook handoff', () => {
  it('captures locally by default, leaves the rollout untouched, and restores once', async () => {
    const value = await fixture();
    const before = await readFile(value.transcript);

    expect(await runHook(preInput(value), { env: value.env, now: () => 1_000 })).toEqual({});
    expect(await readFile(value.transcript)).toEqual(before);

    const paths = checkpointPaths(preInput(value), value.env);
    expect(paths.archive.endsWith('index.json')).toBe(true);
    expect((await stat(paths.archive)).isFile()).toBe(true);
    expect((await stat(paths.pending)).isFile()).toBe(true);

    const catalog = await readCatalog(paths.archive);
    expect(catalog.version).toBe(2);
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(catalog.currentIds.length).toBeGreaterThan(0);
    const restored = await runHook(compactStart(value), { env: value.env, now: () => 1_500 });
    expect(restored).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    });
    const context = (restored as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(context.length).toBeLessThanOrEqual(6_000);
    expect(context).toContain('request-first');
    expect(context).toContain('call-first');
    expect(context).toContain('tool evidence for first');
    expect(context).not.toContain('private reasoning for first');

    const evidence = await retrieveEvidence(paths.archive, catalog.entries[0].id);
    expect(evidence.entry.id).toBe(catalog.entries[0].id);
    expect(evidence.records.length).toBeGreaterThan(0);
    expect(evidence.records.every((record) => typeof record.type === 'string')).toBe(true);

    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_600 })).toEqual({});
    expect(await readdir(paths.directory)).toEqual(expect.arrayContaining(['index.json']));
    expect((await readdir(paths.directory)).filter((name) => name === 'pending.json')).toHaveLength(0);
  });

  it('merges sequential compactions while keeping prior evidence IDs stable', async () => {
    const value = await fixture('first');
    const firstInput = preInput(value);
    await runHook(firstInput, { env: value.env, now: () => 1_000 });
    const firstCatalog = await readCatalog(checkpointPaths(firstInput, value.env).archive);
    const firstIds = new Set(firstCatalog.entries.map((entry) => entry.id));

    await writeFile(value.transcript, transcriptText('second'), 'utf8');
    const before = await readFile(value.transcript);
    expect(await runHook(firstInput, { env: value.env, now: () => 2_000 })).toEqual({});
    expect(await readFile(value.transcript)).toEqual(before);

    const archive = checkpointPaths(firstInput, value.env).archive;
    const catalog = await readCatalog(archive);
    expect(catalog.entries.length).toBeGreaterThan(firstCatalog.entries.length);
    expect([...firstIds].every((id) => catalog.entries.some((entry) => entry.id === id))).toBe(true);
    expect(catalog.currentIds.every((id) => catalog.entries.some((entry) => entry.id === id))).toBe(true);
    const allRecords = (await Promise.all(catalog.entries.map((entry) =>
      retrieveEvidence(archive, entry.id)))).flatMap((result) => result.records);
    expect(allRecords.some((record) => JSON.stringify(record).includes('tool evidence for first'))).toBe(true);
    expect(allRecords.some((record) => JSON.stringify(record).includes('tool evidence for second'))).toBe(true);
  });

  it('isolates handoffs by session, cwd, and transcript identity', async () => {
    const value = await fixture();
    const otherTranscript = join(value.root, 'other-rollout.jsonl');
    await writeFile(otherTranscript, transcriptText('other'), 'utf8');
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });

    expect(await runHook({ ...compactStart(value), session_id: 'session-b' }, {
      env: value.env, now: () => 1_100,
    })).toEqual({});
    expect(await runHook({ ...compactStart(value), cwd: join(value.root, 'other-project') }, {
      env: value.env, now: () => 1_100,
    })).toEqual({});
    expect(await runHook({ ...compactStart(value), transcript_path: otherTranscript }, {
      env: value.env, now: () => 1_100,
    })).toEqual({});
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_100 }))
      .toMatchObject({ hookSpecificOutput: { hookEventName: 'SessionStart' } });
  });

  it('expires stale pending evidence and consumes the claim', async () => {
    const value = await fixture();
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    expect(await runHook(compactStart(value), {
      env: value.env, now: () => 1_000 + 10 * 60 * 1000 + 1,
    })).toEqual({});
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_001 })).toEqual({});
  });

  it('disables and invalidates a pending handoff when FAST_JEV_ENABLED is zero', async () => {
    const value = await fixture();
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    const disabled = { ...value.env, FAST_JEV_ENABLED: '0' };
    expect(await runHook(compactStart(value), { env: disabled, now: () => 1_100 })).toEqual({});
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_200 })).toEqual({});
  });

  it('fails open without mutating a malformed source transcript', async () => {
    const value = await fixture();
    const malformed = join(value.root, 'malformed.jsonl');
    await writeFile(malformed, '{not-json}\n', 'utf8');
    const before = await readFile(malformed);
    expect(await runHook({ ...preInput(value), transcript_path: malformed }, { env: value.env }))
      .toEqual({ systemMessage: expect.stringContaining('context recovery unavailable') });
    expect(await readFile(malformed)).toEqual(before);
  });

  it('returns an empty response for malformed, unknown, and non-compact events', async () => {
    const value = await fixture();
    for (const input of [
      null,
      {},
      '{"hook_event_name":"PreCompact"}',
      { ...preInput(value), hook_event_name: 'PostCompact' },
      { ...compactStart(value), source: 'startup' },
    ]) {
      expect(await runHook(input, { env: value.env })).toEqual({});
    }
  });
});
