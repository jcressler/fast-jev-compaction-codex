import { describe, expect, it } from 'vitest';
import { buildEvidenceEntries, rankEvidence, searchEvidence, type EvidenceSummary } from '../src/evidence.js';
import type { CodexItem } from '../src/codex.js';
import type { JevAsker } from '../src/types.js';

const item = (value: Record<string, unknown>): CodexItem => value as CodexItem;

describe('evidence index', () => {
  it('pairs successful writes and prioritizes their write evidence', () => {
    const entries = buildEvidenceEntries([
      item({ type: 'message', role: 'user', content: 'Please update the file.' }),
      item({ type: 'function_call', call_id: 'w1', name: 'apply_patch', arguments: '{"file_path":"src/a.ts","patch":"..."}' }),
      item({ type: 'function_call_output', call_id: 'w1', output: 'Applied patch successfully to src/a.ts' }),
    ]);
    const tool = entries.find((entry) => entry.kind === 'tool')!;
    expect(tool.flags).toContain('write');
    expect(tool.flags).toContain('identifier');
    expect(tool.outcome).toContain('src/a.ts');
    expect(searchEvidence(entries.map(({ records: _records, ...summary }) => summary), 'apply_patch', 1)[0]?.id).toBe(tool.id);
  });

  it('retains failed output fields and marks failure', () => {
    const entries = buildEvidenceEntries([
      item({ type: 'function_call', call_id: 'b1', name: 'Bash', arguments: '{"command":"npm test"}' }),
      item({ type: 'function_call_output', call_id: 'b1', output: { isError: true, error: 'tests failed', exit_code: 2, id: 'run-42' } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.flags).toEqual(expect.arrayContaining(['failure', 'identifier']));
    expect(entries[0]?.outcome).toContain('tests failed');
    expect(entries[0]?.outcome).toContain('run-42');
    expect(entries[0]?.records[1]).toMatchObject({ output: { exit_code: 2 } });
  });

  it('does not treat false or empty structured error fields as failures', () => {
    const entries = buildEvidenceEntries([
      item({ type: 'function_call', call_id: 'ok', name: 'Bash', arguments: '{"command":"git status"}' }),
      item({ type: 'function_call_output', call_id: 'ok', output: '{"isError":false,"error":[],"exit_code":0,"status_code":200}' }),
    ]);
    expect(entries[0]?.flags).not.toContain('failure');
  });

  it('flags consequential shell commands as writes', () => {
    const entries = buildEvidenceEntries([
      item({ type: 'function_call', call_id: 'push', name: 'Bash', arguments: '{"command":"git push origin main"}' }),
      item({ type: 'function_call_output', call_id: 'push', output: 'Everything up-to-date' }),
    ]);
    expect(entries[0]?.flags).toContain('write');
  });

  it('does not lose ambiguous duplicate calls or their outputs', () => {
    const records = [
      item({ type: 'function_call', call_id: 'dup', name: 'Read', arguments: '{}' }),
      item({ type: 'function_call', call_id: 'dup', name: 'Read', arguments: '{}' }),
      item({ type: 'function_call_output', call_id: 'dup', output: 'one' }),
    ];
    const entries = buildEvidenceEntries(records);
    expect(entries.flatMap((entry) => entry.records)).toHaveLength(records.length);
    expect(entries.every((entry) => entry.flags.includes('ambiguous'))).toBe(true);
  });

  it('pairs same-kind records, preserves IDs, and uses user boundaries for turns', () => {
    const records = [
      item({ type: 'message', role: 'user', content: 'Keep this constraint: never delete data.' }),
      item({ type: 'custom_tool_call', call_id: 'c1', name: 'lookup', input: { q: 'x' } }),
      item({ type: 'custom_tool_call_output', call_id: 'c1', output: { id: 'abc12345', value: 'found' } }),
      item({ type: 'message', role: 'assistant', content: 'Found it.' }),
      item({ type: 'message', role: 'user', content: 'Decided: use the result.' }),
    ];
    const entries = buildEvidenceEntries(records);
    expect(entries.map((entry) => entry.turn)).toEqual([0, 0, 0, 1]);
    expect(entries[0]?.flags).toEqual(['constraint']);
    expect(entries[0]?.role).toBe('user');
    expect(entries.at(-1)?.turn).toBe(1);
    expect(entries.find((entry) => entry.callId === 'c1')?.records).toEqual(records.slice(1, 3));
    expect(entries.find((entry) => entry.callId === 'c1')?.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps protected text opaque and out of summaries', () => {
    const entries = buildEvidenceEntries([
      item({ type: 'reasoning', text: 'private chain of thought secret' }),
      item({ type: 'message', role: 'system', content: 'system secret' }),
      item({ type: 'message', role: 'assistant', channel: 'analysis', content: 'analysis secret' }),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.kind === 'opaque' && entry.summary === '' && entry.outcome === '' && entry.flags.length === 0)).toBe(true);
    expect(entries.map((entry) => `${entry.summary} ${entry.outcome}`).join(' ')).not.toContain('private chain of thought');
  });
});

function summary(id: string, tool: string, outcome: string): EvidenceSummary {
  return { id, kind: 'tool', callId: id, tool, turn: 0, summary: `${tool} operation`, outcome, flags: [] };
}

describe('evidence retrieval', () => {
  it('finds exact tool and call IDs deterministically', () => {
    const entries = [summary('call-1', 'Read', 'src/a.ts'), summary('call-2', 'Bash', 'failed npm test')];
    expect(searchEvidence(entries, 'call-2', 1)).toEqual([entries[1]]);
    expect(searchEvidence(entries, 'Bash', 1)).toEqual([entries[1]]);
  });

  it('falls back in local order when Jev answers are invalid', async () => {
    const entries = [summary('a', 'Read', 'alpha'), summary('b', 'Write', 'beta')];
    const asker: JevAsker = { ask: async () => ({ answers: { evidence_0: { type: 'noul', noul: 2 } } }) };
    const ranked = await rankEvidence(entries, 'operation', asker, 2);
    expect(ranked.mode).toBe('local-fallback');
    expect(ranked.requests).toBe(1);
    expect(ranked.entries).toEqual([entries[1], entries[0]]);
  });

  it('uses valid Jev scores without exposing records', async () => {
    let state: unknown;
    let questions: unknown;
    const entries = [summary('a', 'Read', 'alpha'), summary('b', 'Write', 'beta')];
    const asker: JevAsker = { ask: async (received, receivedQuestions) => {
      state = received;
      questions = receivedQuestions;
      return { answers: { evidence_0: { type: 'noul', noul: 0.9 }, evidence_1: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 3 } };
    } };
    const ranked = await rankEvidence(entries, 'operation', asker, 2);
    expect(ranked.mode).toBe('jev');
    expect(ranked.entries.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(JSON.stringify(state)).not.toContain('records');
    const candidateState = state as { candidates: Array<{ id: string }> };
    const candidateQuestions = questions as Record<string, { type: string; instructions: string; criteria?: { true?: string; false?: string } }>;
    expect(Object.values(candidateQuestions).every((question) => question.type === 'noul')).toBe(true);
    Object.entries(candidateQuestions).forEach(([key, question]) => {
      const index = Number(key.split('_')[1]);
      expect(question.instructions).toContain(`state.candidates[${index}]`);
      expect(question.instructions).toContain(`id=${candidateState.candidates[index]?.id}`);
      expect(question.instructions).toContain('state.query');
      expect(question.instructions).toMatch(/binary proposition/i);
      expect(question.criteria?.true).toMatch(/failed attempt/i);
      expect(question.criteria?.false).toMatch(/unrelated/i);
    });
  });

  it('prefers newer local ties and bounds hostile Jev metadata', async () => {
    const huge = 'x'.repeat(50_000);
    const entries: EvidenceSummary[] = [
      { id: 'old', kind: 'tool', callId: 'old', tool: 'Read', turn: 1, summary: 'same operation', outcome: 'same', flags: [] },
      { id: 'new', kind: 'tool', callId: 'new', tool: 'Read', turn: 2, summary: 'same operation', outcome: 'same', flags: [] },
      { id: huge, kind: 'tool', callId: huge, tool: huge, turn: 999999999999, summary: huge, outcome: huge, flags: [huge, huge, huge, huge, huge, huge, huge, huge, huge] },
      { id: 'opaque', kind: 'opaque', turn: 0, summary: huge, outcome: huge, flags: [] },
    ];
    expect(searchEvidence(entries, 'Read operation', 2).map((entry) => entry.id)).toEqual(['new', 'old']);
    let receivedState: unknown;
    let receivedQuestions: unknown;
    const asker: JevAsker = { ask: async (state, questions) => {
      receivedState = state;
      receivedQuestions = questions;
      return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul' as const, noul: 0.5 }])) };
    } };
    await rankEvidence(entries, 'operation', asker, 3);
    const serialized = JSON.stringify({ receivedState, receivedQuestions });
    expect(serialized.length).toBeLessThan(24_000);
    expect(serialized).not.toContain('records');
    const state = receivedState as { candidates: Array<{ id: string; callId?: string; tool?: string; summary: string; outcome: string; flags: string[] }> };
    expect(state.candidates).toHaveLength(3);
    expect(state.candidates.every((candidate) => candidate.id.length <= 64 && (candidate.callId?.length ?? 0) <= 64 && (candidate.tool?.length ?? 0) <= 64 && candidate.summary.length <= 100 && candidate.outcome.length <= 120 && candidate.flags.every((flag) => flag.length <= 20))).toBe(true);
    expect(Object.values(receivedQuestions as Record<string, { instructions: string }>).every((question) => question.instructions.length <= 430)).toBe(true);
  });
});
