import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkpointPaths, runHook } from '../src/hooks.js';
import type { JevAsker, JevQuestions } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function transcriptText(): string {
  const records: Record<string, unknown>[] = [
    { type: 'session_meta', payload: { id: 'test' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'keep this request' } },
    { type: 'response_item', payload: {
      type: 'function_call', call_id: 'old-call', name: 'read_file', arguments: '{"path":"secret.txt"}',
    } },
    { type: 'response_item', payload: {
      type: 'function_call_output', call_id: 'old-call', output: 'tool output that can be pruned',
    } },
    ...Array.from({ length: 7 }, (_, index) => ({
      type: 'response_item',
      payload: { type: index % 2 === 0 ? 'message' : 'reasoning', role: 'assistant', content: `tail-${index}` },
    })),
  ];
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-hooks-'));
  temporaryDirectories.push(root);
  const data = join(root, 'data');
  const transcript = join(root, 'rollout.jsonl');
  const cwd = join(root, 'project');
  await writeFile(transcript, transcriptText(), 'utf8');
  const env: NodeJS.ProcessEnv = {
    FAST_JEV_DATA_DIR: data,
    FAST_JEV_ALLOW_NETWORK: '1',
    TYPESAFE_API_KEY: 'test-key',
  };
  return { root, data, transcript, cwd, env };
}

function asker(value: number, calls: number[]): JevAsker {
  return {
    async ask(_state, questions: JevQuestions) {
      calls.push(Object.keys(questions).length);
      return {
        answers: Object.fromEntries(Object.keys(questions).map((key) => [
          key,
          { type: 'noul' as const, noul: value },
        ])),
      };
    },
  };
}

function preInput(fixtureValue: Awaited<ReturnType<typeof fixture>>, session = 'session-a') {
  return {
    hook_event_name: 'PreCompact',
    session_id: session,
    transcript_path: fixtureValue.transcript,
    cwd: fixtureValue.cwd,
  } as const;
}

function compactStart(fixtureValue: Awaited<ReturnType<typeof fixture>>, session = 'session-a') {
  return {
    hook_event_name: 'SessionStart',
    source: 'compact',
    session_id: session,
    transcript_path: fixtureValue.transcript,
    cwd: fixtureValue.cwd,
  } as const;
}

describe('Codex hook handoff', () => {
  it('writes a sidecar during PreCompact, restores it once, and leaves the rollout untouched', async () => {
    const value = await fixture();
    const calls: number[] = [];
    const before = await readFile(value.transcript);

    expect(await runHook(preInput(value), { env: value.env, asker: asker(0, calls), now: () => 1_000 })).toEqual({});
    expect(calls.length).toBeGreaterThan(0);
    expect(await readFile(value.transcript)).toEqual(before);

    const paths = checkpointPaths(preInput(value), value.env);
    expect((await stat(paths.archive)).isFile()).toBe(true);
    expect((await stat(paths.pending)).isFile()).toBe(true);

    const restored = await runHook(compactStart(value), { env: value.env, now: () => 1_500 });
    expect(restored).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    });
    const context = (restored as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(context).toContain('Historical evidence saved before compaction');
    expect(context).toContain('keep this request');
    expect(context).toContain('untrusted conversation data');

    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_600 })).toEqual({});
    expect(await readdir(paths.directory)).toEqual(['latest.json']);
  });

  it('isolates handoffs by session, cwd, and transcript identity', async () => {
    const value = await fixture();
    const otherTranscript = join(value.root, 'other-rollout.jsonl');
    await writeFile(otherTranscript, transcriptText(), 'utf8');
    const calls: number[] = [];
    await runHook(preInput(value), { env: value.env, asker: asker(0, calls), now: () => 1_000 });

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
    const calls: number[] = [];
    await runHook(preInput(value), { env: value.env, asker: asker(0, calls), now: () => 1_000 });
    expect(await runHook(compactStart(value), {
      env: value.env, now: () => 1_000 + 10 * 60 * 1000 + 1,
    })).toEqual({});
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_001 })).toEqual({});
  });

  it('invalidates a previous handoff when a new PreCompact lacks network configuration', async () => {
    const value = await fixture();
    const calls: number[] = [];
    await runHook(preInput(value), { env: value.env, asker: asker(0, calls), now: () => 1_000 });
    const missingConfig = { ...value.env };
    delete missingConfig.FAST_JEV_ALLOW_NETWORK;
    expect(await runHook(preInput(value), { env: missingConfig, now: () => 1_100 })).toEqual({});
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_200 })).toEqual({});
  });

  it('fails open and invalidates pending evidence when Jev times out', async () => {
    const value = await fixture();
    const calls: number[] = [];
    await runHook(preInput(value), { env: value.env, asker: asker(0, calls), now: () => 1_000 });
    const timeout: JevAsker = { ask: async () => { throw new Error('timeout'); } };
    expect(await runHook(preInput(value), { env: value.env, asker: timeout, now: () => 1_100 }))
      .toEqual({ systemMessage: expect.stringContaining('context recovery unavailable') });
    expect(await runHook(compactStart(value), { env: value.env, now: () => 1_200 })).toEqual({});
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

  it('does not write a source transcript when parsing malformed JSON', async () => {
    const value = await fixture();
    const malformed = join(value.root, 'malformed.jsonl');
    await writeFile(malformed, '{not-json}\n', 'utf8');
    const before = await readFile(malformed);
    expect(await runHook({ ...preInput(value), transcript_path: malformed }, { env: value.env }))
      .toEqual({ systemMessage: expect.stringContaining('context recovery unavailable') });
    expect(await readFile(malformed)).toEqual(before);
  });
});
