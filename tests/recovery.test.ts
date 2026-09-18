import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureArchive, type EvidenceCatalog } from '../src/archive.js';
import { selectRecovery } from '../src/recovery.js';
import type { CodexItem } from '../src/codex.js';
import type { JevAsker } from '../src/types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const item = (value: Record<string, unknown>): CodexItem => value as CodexItem;

async function archive(items: CodexItem[]): Promise<{ catalog: EvidenceCatalog; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-recovery-'));
  roots.push(root);
  const path = join(root, 'index.json');
  const catalog = await captureArchive(items, root, { session: 's', transcript: join(root, 'rollout.jsonl'), cwd: root }, 1_000);
  return { catalog, path };
}

function askerFor(value: number, seen?: { state?: unknown; questions?: unknown }): JevAsker {
  return {
    ask: async (state, questions) => {
      if (seen) { seen.state = state; seen.questions = questions; }
      return {
        answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul' as const, noul: value }])),
        model: 'jev-test',
        usage: { input_tokens: 12, output_tokens: 3 },
      };
    },
  };
}

describe('task-aware recovery selection', () => {
  it('sends cross-turn context, paired tool input and output, while excluding protected records', async () => {
    const objective = `Build the recovery selector and preserve the deployment constraint. ${'objective detail '.repeat(24)} Final objective detail must survive raw message retrieval.`;
    const value = await archive([
      item({ type: 'message', role: 'user', content: objective }),
      item({ type: 'message', role: 'assistant', content: 'I will inspect the archive first.' }),
      item({ type: 'reasoning', content: 'private chain of thought must never be sent' }),
      item({ type: 'message', role: 'system', content: 'system-only secret' }),
      item({ type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"src/recovery.ts"}' }),
      item({ type: 'function_call_output', call_id: 'c1', output: 'Read src/recovery.ts; found the paired implementation.' }),
      item({ type: 'message', role: 'user', content: 'Keep uploads disabled and avoid repeating failed writes.' }),
      item({ type: 'message', role: 'assistant', content: 'The latest constraint is recorded.' }),
    ]);
    const seen: { state?: unknown; questions?: unknown } = {};
    const result = await selectRecovery(value.catalog, value.path, askerFor(0.8, seen), { now: () => 2_000 });
    expect(result.mode).toBe('jev');
    expect(result.selectedIds).toHaveLength(result.candidateCount);
    const serialized = JSON.stringify({ state: seen.state, questions: seen.questions });
    expect(serialized).toContain('Build the recovery selector');
    expect(serialized).toContain('Final objective detail must survive raw message retrieval.');
    expect(serialized).toContain('Keep uploads disabled');
    expect(serialized).toContain('src/recovery.ts');
    expect(serialized).toContain('paired implementation');
    expect(serialized).not.toContain('private chain of thought');
    expect(serialized).not.toContain('system-only secret');
    expect(JSON.stringify(seen.questions)).toMatch(/task relevance/i);
    expect(JSON.stringify(seen.questions)).toMatch(/avoiding repeating mistakes/i);
    expect(JSON.stringify(seen.questions)).toMatch(/yes\/no/i);
    const state = seen.state as { candidates: Array<{ id: string }> };
    const questions = Object.values(seen.questions as Record<string, { instructions: string }>);
    expect(state.candidates.every((candidate) => questions.some((question) => question.instructions.includes(candidate.id)))).toBe(true);
  });

  it('bounds adversarial context and tool strings below the serialized request budget', async () => {
    const huge = 'x'.repeat(200_000);
    const items: CodexItem[] = [item({ type: 'message', role: 'user', content: huge })];
    for (let index = 0; index < 40; index += 1) {
      items.push(item({ type: 'function_call', call_id: `c${index}`, name: 'Bash', arguments: JSON.stringify({ command: huge, path: `src/${index}.ts` }) }));
      items.push(item({ type: 'function_call_output', call_id: `c${index}`, output: huge }));
    }
    const value = await archive(items);
    let requestChars = 0;
    const asker: JevAsker = {
      ask: async (state, questions) => {
        requestChars = JSON.stringify({ state, questions }).length;
        return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 0.5 }])) };
      },
    };
    const result = await selectRecovery(value.catalog, value.path, asker, { maxCandidates: 99 });
    expect(result.candidateCount).toBeLessThanOrEqual(24);
    expect(requestChars).toBeLessThanOrEqual(50_000);
    expect(result.requestChars).toBe(requestChars);
  });

  it('validates every score and falls back without exposing the thrown error', async () => {
    const value = await archive([
      item({ type: 'message', role: 'user', content: 'Fix the failing build.' }),
      item({ type: 'function_call', call_id: 'bad', name: 'Bash', arguments: '{"command":"npm test"}' }),
      item({ type: 'function_call_output', call_id: 'bad', output: 'failure: exit code 1' }),
    ]);
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async (_state, questions) => ({
        answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, { noul: index === 0 ? 2 : 0.2 }])),
      }),
    });
    expect(result.mode).toBe('local-fallback');
    expect(result.requests).toBe(1);
    expect(result.reason).toBe('jev unavailable; local recovery ranking used');
    expect(result.reason).not.toContain('2');
  });

  it('falls back deterministically when the injected asker fails', async () => {
    const value = await archive([
      item({ type: 'message', role: 'user', content: 'Do not repeat the failed write.' }),
      item({ type: 'function_call', call_id: 'w', name: 'apply_patch', arguments: '{"file_path":"src/a.ts"}' }),
      item({ type: 'function_call_output', call_id: 'w', output: { isError: true, error: 'write failed', exit_code: 1 } }),
    ]);
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async () => { throw new Error('provider secret should stay private'); },
    });
    expect(result.mode).toBe('local-fallback');
    expect(result.selectedIds).toHaveLength(result.candidateCount);
    expect(result.reason).toBe('jev unavailable; local recovery ranking used');
    expect(JSON.stringify(result)).not.toContain('provider secret');
  });

  it('reports no request when there are no eligible candidates', async () => {
    const value = await archive([
      item({ type: 'reasoning', content: 'opaque' }),
      item({ type: 'message', role: 'system', content: 'not eligible' }),
    ]);
    let called = false;
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async () => { called = true; return { answers: {} }; },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ mode: 'local-fallback', requests: 0, candidateCount: 0, selectedIds: [] });
  });
});
