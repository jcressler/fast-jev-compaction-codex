import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCatalog, retrieveEvidence } from '../src/archive.js';
import { checkpointPaths, readRecoveryRun, recoveryContext, runHook } from '../src/hooks.js';

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

async function fixture(label = 'first', count = 0) {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-hooks-'));
  temporaryDirectories.push(root);
  const data = join(root, 'data');
  const transcript = join(root, 'rollout.jsonl');
  const cwd = join(root, 'project');
  await writeFile(transcript, transcriptText(label, count), 'utf8');
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
  it('emits complementary evidence instead of filling the index with one repeated topic', async () => {
    const value = await fixture('coverage');
    const items: Record<string, unknown>[] = [
      { type: 'message', role: 'user', content: 'Preserve the receipt reference.\nPreserve the migration invariant.' },
    ];
    for (let index = 0; index < 20; index++) {
      items.push({ type: 'function_call', call_id: `receipt-${index}`, name: 'read_file', arguments: '{}' },
        { type: 'function_call_output', call_id: `receipt-${index}`, output: `Receipt reference saved: R-101. ${'Receipt details. '.repeat(22)}` });
    }
    items.push({ type: 'function_call', call_id: 'migration', name: 'read_file', arguments: '{}' },
      { type: 'function_call_output', call_id: 'migration', output: 'Migration invariant: never renumber existing item identifiers.' });
    await writeFile(value.transcript, items.map(payload => JSON.stringify({ type: 'response_item', payload })).join('\n'));
    const env = { ...value.env, FAST_JEV_MODE: 'jev', FAST_JEV_ALLOW_NETWORK: '1', TYPESAFE_API_KEY: 'test-only' };
    let calls = 0;
    const asker = { ask: async (state: unknown, questions: Record<string, unknown>) => {
      calls++;
      const typed = state as { requirements: string[]; candidates: Array<{ result?: string }> };
      return { answers: Object.fromEntries(Object.entries(questions).map(([key, value]) => {
        const question = value as { instructions: string };
        const candidateIndex = Number(/state\.candidates\[(\d+)\]/.exec(question.instructions)![1]);
        const requirementIndex = /state\.requirements\[(\d+)\]/.exec(question.instructions)?.[1];
        const result = typed.candidates[candidateIndex]!.result ?? '';
        let noul = result.includes('Receipt reference saved') ? 0.99 : result.includes('Migration invariant') ? 0.4 : 0.01;
        if (requirementIndex !== undefined) {
          const requirement = typed.requirements[Number(requirementIndex)]!;
          noul = (/receipt/i.test(requirement) && result.includes('Receipt reference saved')) ||
            (/migration/i.test(requirement) && result.includes('Migration invariant')) ? 0.99 : 0.01;
        }
        return [key, { noul }];
      })) };
    } };
    await runHook(preInput(value), { env, asker });
    const { archive } = checkpointPaths(preInput(value), env);
    const catalog = await readCatalog(archive);
    const migration = catalog.entries.find(entry => entry.callId === 'migration')!;
    const selected = await readRecoveryRun(catalog, archive);
    expect(selected?.mode).toBe('jev');
    expect(selected?.requirements?.included).toBe(2);
    expect(selected?.selectedIds.indexOf(migration.id)).toBeLessThan(3);
    const restored = await runHook(compactStart(value), { env, asker });
    expect(JSON.stringify(restored)).toContain('never renumber existing item identifiers');
    expect((await readRecoveryRun(catalog, archive))?.emittedIds).toContain(migration.id);
    expect(calls).toBe(1);
  });

  it('records the exact bounded index emitted after compaction, without storing its text in telemetry', async () => {
    const value = await fixture('emission', 40);
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    const { archive } = checkpointPaths(preInput(value), value.env);
    const catalog = await readCatalog(archive);
    expect((await readRecoveryRun(catalog, archive))?.emittedIds).toBeUndefined();
    const output = await runHook(compactStart(value), { env: value.env, now: () => 1_001 }) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const context = output.hookSpecificOutput.additionalContext;
    const ids = context.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line).id);
    const run = await readRecoveryRun(catalog, archive);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(catalog.entries.filter(entry => entry.kind !== 'opaque').length);
    expect(run).toMatchObject({ mode: 'local', emittedIds: ids, emittedContextChars: context.length,
      emittedContextSha256: createHash('sha256').update(context).digest('hex') });
    expect(context.length).toBeLessThanOrEqual(6_000);
    expect(JSON.stringify(run)).not.toContain('request-emission');
    expect(JSON.stringify(run)).not.toContain('private reasoning');
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_002 })).toEqual({});
    expect(await readRecoveryRun(catalog, archive)).toEqual(run);
  });

  it('rejects incomplete or invalid emission telemetry', async () => {
    const value = await fixture('bad-emission');
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    await runHook(compactStart(value), { env: value.env, now: () => 1_001 });
    const paths = checkpointPaths(preInput(value), value.env);
    const catalog = await readCatalog(paths.archive);
    const path = join(paths.directory, `selection-${catalog.generation}.json`);
    const run = JSON.parse(await readFile(path, 'utf8'));
    for (const invalid of [
      { emittedContextChars: 6_001 }, { emittedContextSha256: 'invalid' },
      { emittedContextSha256: undefined }, { emittedIds: ['a'.repeat(64)] },
      { emittedIds: [run.emittedIds[0], run.emittedIds[0]] },
    ]) {
      await writeFile(path, JSON.stringify({ ...run, ...invalid }));
      expect(await readRecoveryRun(catalog, paths.archive)).toBeUndefined();
    }
  });

  it('uses configured Jev before compaction and delivers its selection exactly once', async () => {
    const value = await fixture('jev', 15);
    const env = { ...value.env, FAST_JEV_MODE: 'jev', FAST_JEV_ALLOW_NETWORK: '1', TYPESAFE_API_KEY: 'test-only-secret' };
    let calls = 0;
    const asker = { ask: async (_state: unknown, questions: Record<string, unknown>) => {
      calls++;
      return { model: 'jev-test', usage: { input_tokens: 100, output_tokens: 20 },
        answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.9 }])) };
    } };
    const before = await readFile(value.transcript);
    await runHook(preInput(value), { env, asker, now: () => 1_000 });
    expect(calls).toBe(1);
    const { archive } = checkpointPaths(preInput(value), env);
    const catalog = await readCatalog(archive);
    const run = await readRecoveryRun(catalog, archive);
    expect(run).toMatchObject({ mode: 'jev', requests: 1, model: 'jev-test', usage: { input_tokens: 100 } });
    expect(run!.selectedIds.length).toBeGreaterThan(0);
    expect(run!.requirements?.included).toBeGreaterThan(0);
    expect(run!.requirements?.sourceIds.every(id => catalog.entries.some(entry =>
      entry.id === id && entry.kind === 'message' && entry.role === 'user'))).toBe(true);
    expect(JSON.stringify(run)).not.toContain('test-only-secret');
    expect(JSON.stringify(run)).not.toContain('request-jev');
    const restored = await runHook(compactStart(value), { env, asker, now: () => 1_001 });
    expect(JSON.stringify(restored)).toContain('Selection: jev');
    expect((await readRecoveryRun(catalog, archive))?.requirements).toEqual(run!.requirements);
    expect(calls).toBe(1);
    expect(await readFile(value.transcript)).toEqual(before);
    expect(await runHook(compactStart(value), { env, asker, now: () => 1_002 })).toEqual({});
  });

  it('does not call Jev without mode, network opt-in, and a key', async () => {
    const value = await fixture('gates');
    let calls = 0;
    const asker = { ask: async () => { calls++; throw new Error('must never call'); } };
    for (const extras of [
      { TYPESAFE_API_KEY: 'test-key', FAST_JEV_ALLOW_NETWORK: '1' },
      { TYPESAFE_API_KEY: 'test-key', FAST_JEV_MODE: 'jev' },
      { FAST_JEV_ALLOW_NETWORK: '1', FAST_JEV_MODE: 'jev' },
    ]) {
      const env = { ...value.env, ...extras };
      await runHook(preInput(value), { env, asker, now: () => 1_000 });
      const { archive } = checkpointPaths(preInput(value), env);
      expect((await readRecoveryRun(await readCatalog(archive), archive))?.requests).toBe(0);
    }
    expect(calls).toBe(0);
  });

  it('keeps local recovery when Jev fails without exposing the error', async () => {
    const value = await fixture('fallback');
    const env = { ...value.env, FAST_JEV_MODE: 'jev', FAST_JEV_ALLOW_NETWORK: '1', TYPESAFE_API_KEY: 'test-key' };
    const asker = { ask: async () => { throw new Error('secret provider text'); } };
    await runHook(preInput(value), { env, asker, now: () => 1_000 });
    const { archive } = checkpointPaths(preInput(value), env);
    const run = await readRecoveryRun(await readCatalog(archive), archive);
    expect(run).toMatchObject({ mode: 'local-fallback', requests: 1 });
    expect(JSON.stringify(run)).not.toContain('secret provider text');
    const restored = await runHook(compactStart(value), { env, now: () => 1_001 });
    expect(JSON.stringify(restored)).toContain('tool evidence for fallback');
    expect(JSON.stringify(restored)).toContain('Selection: local-fallback');
  });

  it('uses Jev order while pinning current user instructions ahead of it', async () => {
    const value = await fixture('order', 12);
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    const { archive } = checkpointPaths(preInput(value), value.env);
    const catalog = await readCatalog(archive);
    const selected = catalog.entries.find(e => e.summary.includes('order-tail-0'))!;
    const context = recoveryContext(catalog, archive, 3_000, { mode: 'jev', selectedIds: [selected.id] });
    expect(context).toContain(selected.id);
    expect(context.indexOf('request-order')).toBeLessThan(context.indexOf(selected.id));
    expect(context.length).toBeLessThanOrEqual(3_000);
    expect(recoveryContext(catalog, archive, 20).length).toBeLessThanOrEqual(20);
    expect(recoveryContext(catalog, archive, 0)).toBe('');
  });

  it('rejects corrupt selection metadata and omits unexpected fields from status', async () => {
    const value = await fixture('metadata');
    await runHook(preInput(value), { env: value.env, now: () => 1_000 });
    const paths = checkpointPaths(preInput(value), value.env);
    const catalog = await readCatalog(paths.archive);
    const path = join(paths.directory, `selection-${catalog.generation}.json`);
    const run = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...run, credential: 'unexpected-sensitive-field' }));
    expect(JSON.stringify(await readRecoveryRun(catalog, paths.archive))).not.toContain('unexpected-sensitive-field');
    await writeFile(path, JSON.stringify({ ...run, mode: 'jev', selectedIds: ['a'.repeat(64)] }));
    expect(await readRecoveryRun(catalog, paths.archive)).toBeUndefined();
    expect(JSON.stringify(await runHook(compactStart(value), { env: value.env, now: () => 1_001 })))
      .toContain('Selection: local');
  });

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
