import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureArchive, type EvidenceCatalog } from '../src/archive.js';
import { deriveRecoveryRequirements, selectRecovery } from '../src/recovery.js';
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
  it('preserves instruction text and reports units that cannot fit without changing their meaning', () => {
    const source = 'a'.repeat(64);
    const oversized = `Keep ${'the exact original constraint '.repeat(20)} and do not upload records`;
    const result = deriveRecoveryRequirements([{ id: source, turn: 1,
      text: `20 seconds is the timeout.\n- Preserve field-a.\n- Preserve field.a.\n- Preserve Foo.\n- Preserve foo.\n${oversized}` }]);
    expect(result.requirements.map(value => value.text)).toEqual(expect.arrayContaining([
      '20 seconds is the timeout.', 'Preserve field-a.', 'Preserve field.a.', 'Preserve Foo.', 'Preserve foo.',
    ]));
    expect(result.requirements.every(value => !value.text.includes('exact original constraint'))).toBe(true);
    expect(result.omittedCount).toBe(1);
    expect(result.omittedSourceIds).toEqual([source]);
    expect(deriveRecoveryRequirements([{ id: source, turn: 1, text: '1.5 seconds is the delay.\n-5 is the minimum.\n1) Keep zero valid.' }])
      .requirements.map(value => value.text)).toEqual(expect.arrayContaining([
        '1.5 seconds is the delay.', '-5 is the minimum.', 'Keep zero valid.',
      ]));
  });

  it('retains an earlier constraint through acknowledgement turns and keeps later corrections explicit', () => {
    const messages = [
      { id: 'a'.repeat(64), turn: 1, text: 'Build the import feature.' },
      { id: 'b'.repeat(64), turn: 2, text: 'Keep uploads disabled.' },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `${index}`.repeat(64), turn: index + 3, text: 'Continue.' })),
      { id: 'c'.repeat(64), turn: 12, text: 'Correction: preserve the identifier exactly.' },
    ];
    const result = deriveRecoveryRequirements(messages);
    expect(result.requirements.map(value => value.text)).toContain('Keep uploads disabled.');
    expect(result.requirements[0]?.text).toBe('Correction: preserve the identifier exactly.');
    expect(result.requirements.some(value => value.text === 'Continue.')).toBe(false);
  });

  it('excludes nested hidden content and structured credentials from messages and encoded tool results', async () => {
    const value = await archive([
      item({ type: 'message', role: 'user', content: [
        { type: 'reasoning', text: 'HIDDEN_USER_REASONING' },
        { type: 'input_text', text: 'Keep uploads disabled.' },
      ] }),
      item({ type: 'message', role: 'assistant', content: [
        { channel: 'analysis', text: 'HIDDEN_ASSISTANT_ANALYSIS' },
        { type: 'output_text', text: 'I will preserve the upload constraint.' },
      ] }),
      item({ type: 'function_call', call_id: 'nested', name: 'read_file', arguments: { accessToken: 'HIDDEN_TOKEN', path: 'policy.json' } }),
      item({ type: 'function_call_output', call_id: 'nested', output: JSON.stringify({ content: [
        { type: 'reasoning', text: 'HIDDEN_TOOL_REASONING' },
        { role: 'developer', text: 'HIDDEN_TOOL_DEVELOPER' },
        { type: 'text', text: JSON.stringify({ status: 'uploads disabled', privateKey: 'HIDDEN_KEY', reasoning_content: 'HIDDEN_NESTED_REASONING' }) },
      ] }) }),
    ]);
    const seen: { state?: unknown; questions?: unknown } = {};
    expect((await selectRecovery(value.catalog, value.path, askerFor(0.8, seen))).mode).toBe('jev');
    const request = JSON.stringify(seen);
    expect(request).toContain('uploads disabled');
    expect(request).not.toContain('HIDDEN_');
  });

  it('falls back completely when even one requirement answer is missing', async () => {
    const value = await archive([item({ type: 'message', role: 'user', content: 'Keep uploads disabled. Preserve IDs.' })]);
    const result = await selectRecovery(value.catalog, value.path, { ask: async (_state, questions) => {
      const answers = Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.9 }]));
      delete answers[Object.keys(answers).find(key => key.startsWith('requirement_'))!];
      return { answers };
    } });
    expect(result).toMatchObject({ mode: 'local-fallback', requests: 1 });
  });

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
    expect(JSON.stringify(seen.state)).toMatch(/failed attempts/i);
    expect(JSON.stringify(seen.state)).toMatch(/Latest user corrections control/i);
    const state = seen.state as { candidates: Array<{ id: string }> };
    const questions = seen.questions as Record<string, { type: string; instructions: string; criteria?: { true?: string; false?: string } }>;
    expect(Object.values(questions).every((question) => question.type === 'noul')).toBe(true);
    Object.entries(questions).forEach(([key, question]) => {
      const parts = key.split('_');
      const index = key.startsWith('candidate_') ? Number(parts[1]) - 1 : Number(parts[2]);
      expect(question.instructions).toContain(`state.candidates[${index}]`);
      expect(question.instructions).toMatch(/^Does .*\?$/);
      expect(question.criteria?.true).toMatch(/facts.*prior outcomes/i);
      expect(question.criteria?.false).toMatch(/unrelated/i);
    });
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

  it('keeps the complete candidate pool and bounded user requirements in one Jev request', async () => {
    const items: CodexItem[] = [item({ type: 'message', role: 'user', content: 'Build the recovery selector.' })];
    for (let index = 0; index < 24; index += 1) {
      items.push(item({ type: 'function_call', call_id: `pool-${index}`, name: 'read_file', arguments: JSON.stringify({ path: `src/${index}.ts` }) }));
      items.push(item({ type: 'function_call_output', call_id: `pool-${index}`, output: `POOL-FACT-${index} ${'visible evidence '.repeat(90)}` }));
      items.push(item({ type: 'message', role: 'user', content: `Keep requirement ${index} and preserve its correction.` }));
    }
    const value = await archive(items);
    let requestChars = 0;
    let sentState: { candidates?: unknown[]; requirements?: string[] } = {};
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async (state, questions) => {
        requestChars = JSON.stringify({ state, questions }).length;
        sentState = state as typeof sentState;
        return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 0.5 }])) };
      },
    });
    expect(result.mode, JSON.stringify(result)).toBe('jev');
    expect(result.candidateCount).toBe(24);
    expect(sentState.candidates).toHaveLength(24);
    expect(sentState.requirements).toHaveLength(6);
    expect(requestChars).toBeLessThanOrEqual(50_000);
  });

  it('orders complementary requirement support and derives requirements from user messages only', async () => {
    const value = await archive([
      item({ type: 'message', role: 'user', content: 'Preserve the first requirement.' }),
      item({ type: 'message', role: 'assistant', content: 'Assistant suggestion must not become a requirement.' }),
      item({ type: 'function_call', call_id: 'redundant', name: 'read_file', arguments: '{}' }),
      item({ type: 'function_call_output', call_id: 'redundant', output: 'first requirement evidence' }),
      item({ type: 'function_call', call_id: 'complementary', name: 'read_file', arguments: '{}' }),
      item({ type: 'function_call_output', call_id: 'complementary', output: 'second requirement evidence' }),
      item({ type: 'message', role: 'user', content: 'Correction: preserve the second requirement instead.' }),
    ]);
    let stateSeen: { candidates: Array<{ id: string }>; requirements: string[] } | undefined;
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async (state, questions) => {
        stateSeen = state as typeof stateSeen;
        const candidateCount = stateSeen!.candidates.length;
        const answers: Record<string, { type: 'noul'; noul: number }> = {};
        Object.keys(questions).forEach((key) => {
          const match = /^requirement_(\d+)_(\d+)$/.exec(key);
          if (!match) answers[key] = { type: 'noul', noul: 0.9 };
          else {
            const requirementIndex = Number(match[1]);
            const candidateIndex = Number(match[2]);
            answers[key] = { type: 'noul', noul: candidateIndex === requirementIndex ? 0.95 : 0.05 };
          }
        });
        expect(candidateCount).toBeGreaterThan(1);
        return { answers };
      },
    });
    expect(result.mode).toBe('jev');
    expect(stateSeen?.requirements).toEqual(expect.arrayContaining(['Correction: preserve the second requirement instead.', 'Preserve the first requirement.']));
    expect(stateSeen?.requirements).not.toContain('Assistant suggestion must not become a requirement.');
    expect(result.selectedIds.slice(0, 2)).toEqual(stateSeen?.candidates.slice(0, 2).map((candidate) => candidate.id));
  });

  it('falls back locally when a requirement support probability is malformed', async () => {
    const value = await archive([
      item({ type: 'message', role: 'user', content: 'Keep the deployment constraint.' }),
      item({ type: 'function_call', call_id: 'malformed-support', name: 'read_file', arguments: '{}' }),
      item({ type: 'function_call_output', call_id: 'malformed-support', output: 'deployment constraint evidence' }),
    ]);
    const result = await selectRecovery(value.catalog, value.path, {
      ask: async (_state, questions) => ({
        answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: key.startsWith('requirement_') ? Number.NaN : 0.8 }])),
      }),
    });
    expect(result.mode).toBe('local-fallback');
    expect(result.requests).toBe(1);
  });
});
