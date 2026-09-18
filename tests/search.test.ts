import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureArchive, readCatalog, retrieveEvidence } from '../src/archive.js';
import { rankArchiveSearch, searchArchive } from '../src/search.js';
import type { CodexItem } from '../src/codex.js';
import type { JevAsker } from '../src/types.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const item = (value: Record<string, unknown>): CodexItem => value as CodexItem;

async function fixture(records: CodexItem[]) {
  const directory = await mkdtemp(join(tmpdir(), 'raw-search-'));
  roots.push(directory);
  const index = join(directory, 'index.json');
  const identity = { session: 'search-test', transcript: join(directory, 'source.jsonl'), cwd: directory };
  const catalog = await captureArchive(records, directory, identity, 100);
  return { directory, index, catalog };
}

function pair(id: string, output: unknown, input = 'echo synthetic'): CodexItem[] {
  return [
    item({ type: 'function_call', call_id: id, name: 'exec', arguments: { command: input } }),
    item({ type: 'function_call_output', call_id: id, output }),
  ];
}

async function forgeOpaqueEntriesAsTools(index: string): Promise<void> {
  const catalog = JSON.parse(await readFile(index, 'utf8')) as {
    entries: Array<Record<string, unknown>>;
  };
  const opaqueIds = new Set(catalog.entries.filter((entry) => entry.kind === 'opaque').map((entry) => entry.id));
  const rewrite = (value: string) => {
    const parsed = JSON.parse(value) as { entries: Array<Record<string, unknown>> };
    parsed.entries = parsed.entries.map((entry) => opaqueIds.has(entry.id)
      ? { ...entry, kind: 'tool', summary: 'forged summary', outcome: 'forged outcome' }
      : entry);
    return JSON.stringify(parsed);
  };
  await writeFile(index, rewrite(JSON.stringify(catalog)), 'utf8');
  for (const name of await readdir(join(dirname(index), 'captures'))) {
    if (!name.endsWith('.json')) continue;
    const path = join(dirname(index), 'captures', name);
    await writeFile(path, rewrite(await readFile(path, 'utf8')), 'utf8');
  }
}

describe('bounded raw archive search', () => {
  it('finds tail facts in structured and escaped output while preserving the immutable pair ID', async () => {
    const tail = 'TAIL-RECEIPT-Δ-0042';
    const escaped = 'ESCAPED-JSON-0042';
    const filler = 'batched output detail '.repeat(1_200);
    const f = await fixture([
      ...pair('tail-pair', { chunks: [{ type: 'text', text: `${filler}${tail}` }], escaped: JSON.stringify({ value: escaped }) }),
    ]);
    const before = await readFile(f.index);
    const original = f.catalog.entries.find((entry) => entry.callId === 'tail-pair')!;

    const result = await searchArchive(f.index, `${tail} ${escaped}`, { limit: 5 });
    const found = result.entries.find((entry) => entry.id === original.id)!;

    expect(found.id).toBe(original.id);
    expect(found.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordIndex: 1, field: 'output' }),
    ]));
    expect(found.matches.some((match) => match.text.includes(tail))).toBe(true);
    expect(found.matches.some((match) => match.text.includes(escaped))).toBe(true);
    expect(found.matchedTerms.join(' ')).toMatch(/tail-receipt/i);
    expect(found.matchedTerms.join(' ')).toMatch(/escaped-json/i);
    expect((await retrieveEvidence(f.index, original.id)).records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call' }),
      expect.objectContaining({ type: 'function_call_output' }),
    ]));
    expect(await readFile(f.index)).toEqual(before);
  });

  it('returns message matches and excludes protected records even when the catalog is forged', async () => {
    const visible = 'VISIBLE-UNICODE-Café-δelta';
    const protectedMarker = 'PROTECTED-RAW-MARKER';
    const f = await fixture([
      item({ type: 'message', role: 'user', content: `${'context '.repeat(80)}${visible}` }),
      item({ type: 'message', role: 'system', content: protectedMarker }),
      item({ type: 'message', role: 'developer', content: protectedMarker }),
      item({ type: 'message', role: 'assistant', channel: 'analysis', content: protectedMarker }),
      item({ type: 'reasoning', content: protectedMarker }),
      item({ type: 'future_opaque_item', content: protectedMarker }),
    ]);
    await forgeOpaqueEntriesAsTools(f.index);

    const visibleResult = await searchArchive(f.index, 'café δelta');
    expect(visibleResult.entries).toHaveLength(1);
    expect(visibleResult.entries[0]?.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordIndex: 0, field: 'message' }),
    ]));

    const protectedResult = await searchArchive(f.index, protectedMarker);
    expect(protectedResult.entries).toHaveLength(0);
  });

  it('does not match or expose nested protected structured blocks', async () => {
    const protectedMarker = 'NESTED-PROTECTED-RAW-MARKER';
    const visibleMarker = 'NESTED-VISIBLE-FACT';
    const f = await fixture([
      ...pair('structured-protected', {
        content: [
          { type: 'reasoning', text: protectedMarker },
          { type: 'analysis', text: protectedMarker },
          { type: 'system', text: protectedMarker },
          { type: 'developer', text: protectedMarker },
          { type: 'image', text: protectedMarker },
          { type: 'text', text: visibleMarker },
        ],
        reasoning_content: protectedMarker,
      }),
      ...pair('json-protected', JSON.stringify({ type: 'reasoning', text: protectedMarker })),
    ]);

    const protectedResult = await searchArchive(f.index, protectedMarker);
    expect(protectedResult.entries).toHaveLength(0);
    const visibleResult = await searchArchive(f.index, visibleMarker);
    expect(visibleResult.entries.map((entry) => entry.callId)).toEqual(['structured-protected']);
    expect(visibleResult.entries[0]?.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordIndex: 1, field: 'output' }),
    ]));
    expect(JSON.stringify(visibleResult.entries)).not.toContain(protectedMarker);
  });

  it('bounds entry pages and resumes at the returned catalog cursor', async () => {
    const records: CodexItem[] = [];
    for (let index = 0; index < 5; index += 1) {
      records.push(...pair(`page-${index}`, index === 4 ? 'CURSOR-TAIL-FACT' : `ordinary-${index}`));
    }
    const f = await fixture(records);

    const first = await searchArchive(f.index, 'CURSOR-TAIL-FACT', { maxEntries: 2 });
    expect(first.entries).toHaveLength(0);
    expect(first.scan.scannedEntries).toBe(2);
    expect(first.scan.complete).toBe(false);
    expect(first.scan.nextOffset).toBe(2);

    const second = await searchArchive(f.index, 'CURSOR-TAIL-FACT', { offset: first.scan.nextOffset!, maxEntries: 2 });
    expect(second.entries).toHaveLength(0);
    expect(second.scan.scannedEntries).toBe(2);
    expect(second.scan.nextOffset).toBe(4);
    expect(second.scan.complete).toBe(false);

    const final = await searchArchive(f.index, 'CURSOR-TAIL-FACT', { offset: second.scan.nextOffset!, maxEntries: 2 });
    expect(final.entries.map((entry) => entry.callId)).toEqual(['page-4']);
    expect(final.scan.complete).toBe(true);
    expect(final.scan.nextOffset).toBeNull();
  });

  it('reports byte and object budgets without reading past the configured limits', async () => {
    const f = await fixture([
      ...pair('large', 'x'.repeat(5_000)),
      ...pair('later', 'BUDGET-LATER-FACT'),
    ]);
    const result = await searchArchive(f.index, 'BUDGET-LATER-FACT', { maxBytes: 300, maxObjectBytes: 10_000 });
    expect(result.scan.scanBudgetBytes).toBe(300);
    expect(result.scan.scannedBytes).toBeLessThanOrEqual(300);
    expect(result.scan.complete).toBe(false);
    expect(result.scan.nextOffset).not.toBeNull();
    expect(result.scan.skipped.some((entry) => /budget|bytes/i.test(entry.reason))).toBe(true);
  });

  it('skips oversized, missing, and corrupt objects and continues to later evidence', async () => {
    const f = await fixture([
      ...pair('oversized', 'z'.repeat(1_000)),
      ...pair('missing', 'missing object'),
      ...pair('corrupt', 'corrupt object'),
      ...pair('good-after-errors', 'AFTER-CORRUPTION-FACT'),
    ]);
    const catalog = await readCatalog(f.index);
    const byCall = new Map(catalog.entries.map((entry) => [entry.callId, entry]));
    await unlink(join(f.directory, 'objects', `${byCall.get('missing')!.id}.json`));
    await writeFile(join(f.directory, 'objects', `${byCall.get('corrupt')!.id}.json`), '{}', 'utf8');

    const result = await searchArchive(f.index, 'AFTER-CORRUPTION-FACT', { maxObjectBytes: 300 });
    expect(result.entries.map((entry) => entry.callId)).toEqual(['good-after-errors']);
    expect(result.scan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: byCall.get('oversized')!.id }),
      expect.objectContaining({ id: byCall.get('missing')!.id }),
      expect.objectContaining({ id: byCall.get('corrupt')!.id }),
    ]));
    expect(result.scan.complete).toBe(false);
    expect(result.scan.nextOffset).toBeNull();
  });

  it('validates query input and matches Unicode case-insensitively', async () => {
    const f = await fixture(pair('unicode', 'Café ΔELTA'));
    await expect(searchArchive(f.index, '')).rejects.toThrow();
    await expect(searchArchive(f.index, '   ')).rejects.toThrow();
    await expect(searchArchive(f.index, 'x'.repeat(4_001))).rejects.toThrow();
    const result = await searchArchive(f.index, 'CAFÉ δelta');
    expect(result.entries.map((entry) => entry.callId)).toEqual(['unicode']);
  });

  it('sends Jev only bounded query-centered excerpts and returns original entries', async () => {
    const f = await fixture([
      ...pair('rank-a', `${'unrelated '.repeat(40)}BOUNDARY-FACT-A`),
      ...pair('rank-b', `${'unrelated '.repeat(40)}BOUNDARY-FACT-B`),
    ]);
    const local = await searchArchive(f.index, 'BOUNDARY-FACT', { limit: 10 });
    const original = [...local.entries];
    let receivedState: unknown;
    let receivedQuestions: unknown;
    const asker: JevAsker = {
      ask: async (state, questions) => {
        receivedState = state;
        receivedQuestions = questions;
        const candidates = (state as { candidates?: unknown }).candidates;
        if (!Array.isArray(candidates)) throw new Error('missing Jev candidates');
        return {
          answers: Object.fromEntries(candidates.map((candidate, index) => [
            `evidence_${index}`,
            { type: 'noul' as const, noul: index === 0 ? 0.9 : 0.1 },
          ])),
        };
      },
    };

    const ranked = await rankArchiveSearch(local, 'BOUNDARY-FACT', asker, 2);
    expect(ranked.mode).toBe('jev');
    expect(ranked.entries).toHaveLength(2);
    expect(ranked.entries.every((entry) => original.includes(entry as typeof original[number]))).toBe(true);
    const firstCandidateId = (receivedState as { candidates: Array<{ id: string }> }).candidates[0]!.id;
    expect(ranked.entries[0]).toBe(original.find((entry) => entry.id === firstCandidateId));

    const state = receivedState as { candidates: Array<Record<string, unknown>> };
    expect(state.candidates.length).toBeGreaterThan(0);
    expect(state.candidates.every((candidate) => !('records' in candidate) && !('matches' in candidate))).toBe(true);
    expect(state.candidates.every((candidate) => typeof candidate.outcome === 'string' && (candidate.outcome as string).length <= 300)).toBe(true);
    expect(state.candidates.every((candidate) => !('arguments' in candidate) && !('input' in candidate))).toBe(true);
    expect(state.candidates.some((candidate) => /boundary-fact/i.test(String(candidate.evidence)))).toBe(true);
    expect(JSON.stringify({ receivedState, receivedQuestions })).not.toContain('records');
    expect(JSON.stringify({ receivedState, receivedQuestions })).not.toContain('matches');
  });

  it('asks binary relevance and requirement propositions and selects complementary support', async () => {
    const query = 'REQUIREMENT-COVERAGE-FACT';
    const f = await fixture([
      ...pair('redundant-high-general', `${query} requirement one evidence`),
      ...pair('redundant-lower-general', `${query} requirement one older evidence`),
      ...pair('complementary', `${query} requirement two evidence`),
    ]);
    const local = await searchArchive(f.index, query, { limit: 10 });
    let receivedState: unknown;
    let receivedQuestions: unknown;
    const asker: JevAsker = { ask: async (state, questions) => {
      receivedState = state;
      receivedQuestions = questions;
      const candidates = (state as { candidates: Array<{ callId?: string }> }).candidates;
      const answers: Record<string, { type: 'noul'; noul: number }> = {};
      candidates.forEach((candidate, index) => {
        const general = candidate.callId === 'redundant-high-general' ? 1 : candidate.callId === 'redundant-lower-general' ? 0.9 : 0.1;
        answers[`evidence_${index}`] = { type: 'noul', noul: general };
        answers[`requirement_0_${index}`] = { type: 'noul', noul: candidate.callId === 'complementary' ? 0.1 : candidate.callId === 'redundant-high-general' ? 1 : 0.8 };
        answers[`requirement_1_${index}`] = { type: 'noul', noul: candidate.callId === 'complementary' ? 0.9 : 0.05 };
      });
      return { answers };
    } };
    const ranked = await rankArchiveSearch(local, query, asker, 2, {
      requirements: ['the first requested fact', 'the second requested fact'],
    });
    expect(ranked.mode).toBe('jev');
    expect(ranked.entries.map((entry) => entry.callId)).toEqual(['redundant-high-general', 'complementary']);
    const state = receivedState as { requirements: string[] };
    expect(state.requirements).toEqual(['the first requested fact', 'the second requested fact']);
    const questions = receivedQuestions as Record<string, { instructions: string; criteria?: { true?: string; false?: string } }>;
    expect(Object.keys(questions)).toHaveLength(9);
    expect(questions.evidence_0?.instructions).toMatch(/state\.candidates\[0\].*state\.query/i);
    expect(questions.evidence_0?.criteria).toEqual(expect.objectContaining({ true: expect.any(String), false: expect.any(String) }));
    expect(questions.requirement_0_0?.instructions).toMatch(/state\.candidates\[0\].*state\.requirements\[0\]/i);
    expect(questions.requirement_0_0?.criteria?.false).toMatch(/topic overlap/i);
  });

  it('rejects incomplete, duplicate, and overlong requirements without truncating them', async () => {
    const f = await fixture(pair('requirement-validation', 'REQUIREMENT-VALIDATION-FACT'));
    const local = await searchArchive(f.index, 'REQUIREMENT-VALIDATION-FACT');
    const asker: JevAsker = { ask: async () => ({ answers: {} }) };
    await expect(rankArchiveSearch(local, 'REQUIREMENT-VALIDATION-FACT', asker, 10, { requirements: [''] })).rejects.toThrow(/1 to 240/);
    await expect(rankArchiveSearch(local, 'REQUIREMENT-VALIDATION-FACT', asker, 10, { requirements: ['same', 'same'] })).rejects.toThrow(/unique/);
    await expect(rankArchiveSearch(local, 'REQUIREMENT-VALIDATION-FACT', asker, 10, { requirements: ['x'.repeat(241)] })).rejects.toThrow(/1 to 240/);
    await expect(rankArchiveSearch(local, 'REQUIREMENT-VALIDATION-FACT', asker, 10, { requirements: Array.from({ length: 7 }, (_, index) => `r${index}`) })).rejects.toThrow(/at most 6/);
  });

  it('falls back in local order when any general or requirement score is malformed', async () => {
    const query = 'REQUIREMENT-SCORE-FALLBACK';
    const f = await fixture([
      ...pair('fallback-first', `${query} one`),
      ...pair('fallback-second', `${query} two`),
    ]);
    const local = await searchArchive(f.index, query, { limit: 10 });
    const localIDs = local.entries.map((entry) => entry.id);
    const asker: JevAsker = { ask: async (state) => {
      const candidates = (state as { candidates: unknown[] }).candidates;
      return { answers: Object.fromEntries(candidates.flatMap((_, index) => [
        [`evidence_${index}`, { type: 'noul' as const, noul: 0.9 }],
        [`requirement_0_${index}`, { type: 'noul' as const, noul: index === 0 ? Number.NaN : 0.1 }],
      ])) };
    } };
    const ranked = await rankArchiveSearch(local, query, asker, 10, { requirements: ['the requested fact'] });
    expect(ranked.mode).toBe('local-fallback');
    expect(ranked.entries.map((entry) => entry.id)).toEqual(localIDs);
  });

  it('does not use an input-only raw match as the Jev outcome excerpt', async () => {
    const inputOnly = 'INPUT-ONLY-SEARCH-SECRET';
    const f = await fixture([
      ...pair('input-only', { ok: true }, `lookup ${inputOnly}`),
    ]);
    const local = await searchArchive(f.index, inputOnly, { limit: 10 });
    expect(local.entries[0]?.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'input' }),
    ]));
    let receivedState: unknown;
    const asker: JevAsker = {
      ask: async (state) => {
        receivedState = state;
        const candidates = (state as { candidates?: unknown }).candidates;
        if (!Array.isArray(candidates)) throw new Error('missing Jev candidates');
        return {
          answers: Object.fromEntries(candidates.map((_, index) => [
            `evidence_${index}`,
            { type: 'noul' as const, noul: 0.5 },
          ])),
        };
      },
    };
    await rankArchiveSearch(local, inputOnly, asker, 1);
    const candidates = (receivedState as { candidates: Array<{ outcome?: unknown }> }).candidates;
    expect(candidates.every((candidate) => !String(candidate.outcome ?? '').includes(inputOnly))).toBe(true);
  });

  it('keeps the original local order on invalid Jev scores, including Unicode queries', async () => {
    const f = await fixture([
      ...pair('unicode-old', 'Café δelta older fact'),
      ...pair('unicode-new', 'Café δelta newer fact'),
    ]);
    const local = await searchArchive(f.index, 'CAFÉ ΔELTA', { limit: 10 });
    const originalIDs = local.entries.map((entry) => entry.id);
    const asker: JevAsker = { ask: async () => ({ answers: {} }) };
    const ranked = await rankArchiveSearch(local, 'CAFÉ ΔELTA', asker, 10);
    expect(ranked.mode).toBe('local-fallback');
    expect(ranked.entries.map((entry) => entry.id)).toEqual(originalIDs);
  });

  it('keeps local order for exact Jev ties and sends late correction context', async () => {
    const query = 'CORRECTION-QUERY-FACT';
    const correction = `${query} ${'historical context '.repeat(30)} CORRECTED: the earlier deployment failed and was superseded by the final revision.`;
    const f = await fixture([
      ...pair('correction-old', correction),
      ...pair('correction-new', `${query} newer supporting result`),
    ]);
    const local = await searchArchive(f.index, query, { limit: 10 });
    const localIDs = local.entries.map((entry) => entry.id);
    expect(local.entries.find((entry) => entry.callId === 'correction-old')?.rerankEvidence).toMatch(/CORRECTED|superseded/i);
    let receivedState: unknown;
    const asker: JevAsker = {
      ask: async (state, questions) => {
        receivedState = state;
        const candidates = (state as { candidates: Array<{ evidence?: string }> }).candidates;
        expect(Object.keys(questions)).toHaveLength(candidates.length);
        return { answers: Object.fromEntries(candidates.map((_, index) => [`evidence_${index}`, { type: 'noul' as const, noul: 0.5 }])) };
      },
    };
    const ranked = await rankArchiveSearch(local, query, asker, 10);
    expect(ranked.entries.map((entry) => entry.id)).toEqual(localIDs);
    expect(JSON.stringify(receivedState)).toMatch(/CORRECTED|superseded/i);
  });

  it('includes structured status and excludes protected reasoning from rerank evidence', async () => {
    const visible = 'STATUS-NEARBY-FACT';
    const protectedMarker = 'RERANK-PROTECTED-REASONING';
    const f = await fixture([
      ...pair('status-nearby', {
        details: `${visible} result body`,
        status: 'failed',
        correction: 'proposed fix was superseded by the current status',
        reasoning: protectedMarker,
        content: [{ type: 'reasoning', text: protectedMarker }, { type: 'text', text: visible }],
      }),
    ]);
    const local = await searchArchive(f.index, visible);
    expect(local.entries[0]?.rerankEvidence).toMatch(/status: failed/i);
    let sent: unknown;
    const asker: JevAsker = { ask: async (state) => {
      sent = state;
      const candidates = (state as { candidates: unknown[] }).candidates;
      return { answers: Object.fromEntries(candidates.map((_, index) => [`evidence_${index}`, { type: 'noul' as const, noul: 0.7 }])) };
    } };
    await rankArchiveSearch(local, visible, asker);
    expect(JSON.stringify(sent)).toContain('status: failed');
    expect(JSON.stringify(sent)).not.toContain(protectedMarker);
  });

  it('keeps approved numeric and timestamp siblings beside a long structured paragraph', async () => {
    const query = 'PAGE-SIZE-FACT';
    const f = await fixture([
      ...pair('structured-siblings', {
        paragraph: `${query} ${'long historical paragraph '.repeat(90)}`,
        status: 'approved',
        pageSize: 3,
        observedAt: '2026-09-18T12:34:56Z',
        note: 'current approved configuration',
      }),
    ]);
    const local = await searchArchive(f.index, query);
    const evidence = local.entries[0]?.rerankEvidence ?? '';
    expect(evidence.length).toBeLessThanOrEqual(1_800);
    expect(evidence).toMatch(/status: approved/i);
    expect(evidence).toContain('pageSize: 3');
    expect(evidence).toContain('observedAt: 2026-09-18T12:34:56Z');
  });

  it('bounds the full rerank request while retaining all twenty local candidates', async () => {
    const query = 'REQUEST-BOUND-FACT';
    const f = await fixture(Array.from({ length: 20 }, (_, index) => pair(
      `bound-${index}`,
      `${query} ${'visible result '.repeat(160)} status complete`,
    )).flat());
    const local = await searchArchive(f.index, query, { limit: 20 });
    let receivedState: unknown;
    let receivedQuestions: unknown;
    const asker: JevAsker = { ask: async (state, questions) => {
      receivedState = state;
      receivedQuestions = questions;
      const candidates = (state as { candidates: unknown[] }).candidates;
      return { answers: Object.fromEntries(candidates.map((_, index) => [`evidence_${index}`, { type: 'noul' as const, noul: index / candidates.length }])) };
    } };
    const longQuery = `${query}${'q'.repeat(1_200)}`;
    await rankArchiveSearch(local, longQuery, asker, 20, { taskContext: 'task context '.repeat(300) });
    const state = receivedState as { query: string; taskContext?: string; candidates: Array<{ evidence?: string }> };
    expect(state.query.length).toBeLessThanOrEqual(1_000);
    expect(state.taskContext?.length ?? 0).toBeLessThanOrEqual(2_000);
    expect(state.candidates).toHaveLength(20);
    expect(state.candidates.every((candidate) => (candidate.evidence?.length ?? 0) <= 1_800)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ state: receivedState, questions: receivedQuestions }), 'utf8')).toBeLessThanOrEqual(48 * 1024);
  });

  it('fits twenty candidates and three long requirements without dropping the pool or evidence', async () => {
    const query = 'REQUIREMENT-BUDGET-FACT';
    const f = await fixture(Array.from({ length: 20 }, (_, index) => pair(
      `requirement-budget-${index}`,
      { paragraph: `${query} ${'visible evidence '.repeat(120)}`, status: 'complete', pageSize: index + 1, note: 'current visible evidence' },
    )).flat());
    const local = await searchArchive(f.index, query, { limit: 20 });
    let receivedState: unknown;
    let receivedQuestions: unknown;
    const asker: JevAsker = { ask: async (state, questions) => {
      receivedState = state;
      receivedQuestions = questions;
      return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul' as const, noul: 0.5 }])) };
    } };
    const requirements = Array.from({ length: 3 }, (_, index) => `${String(index)} ${'requested fact '.repeat(16)}`.slice(0, 240));
    const ranked = await rankArchiveSearch(local, query, asker, 20, { requirements });
    expect(ranked.mode).toBe('jev');
    const state = receivedState as { candidates: Array<{ evidence?: string }>; requirements: string[] };
    expect(state.candidates).toHaveLength(20);
    expect(state.requirements).toEqual(requirements);
    expect(Math.max(...state.candidates.map((candidate) => candidate.evidence?.length ?? 0))).toBeGreaterThanOrEqual(580);
    expect(Object.keys(receivedQuestions as object)).toHaveLength(80);
    expect(Buffer.byteLength(JSON.stringify({ state: receivedState, questions: receivedQuestions }), 'utf8')).toBeLessThanOrEqual(48 * 1024);

    const sixRequirements = Array.from({ length: 6 }, (_, index) => `${String(index)} ${'long requested fact '.repeat(15)}`.slice(0, 240));
    const six = await rankArchiveSearch(local, query, asker, 20, { requirements: sixRequirements });
    if (six.mode === 'jev') {
      expect((receivedState as { candidates: unknown[] }).candidates).toHaveLength(20);
      expect((receivedState as { requirements: string[] }).requirements).toEqual(sixRequirements);
      expect(Buffer.byteLength(JSON.stringify({ state: receivedState, questions: receivedQuestions }), 'utf8')).toBeLessThanOrEqual(48 * 1024);
    } else {
      expect(six.mode).toBe('local-fallback');
      expect(six.requests).toBe(0);
    }
  });

  it('reports bounded text extraction when a structured result exceeds traversal limits', async () => {
    const tail = 'EXTRACTION-LIMIT-TAIL';
    const chunks = Array.from({ length: 20_500 }, () => 'ordinary structured text');
    chunks.push(tail);
    const f = await fixture(pair('node-limit', { chunks }));
    const result = await searchArchive(f.index, tail);
    expect(result.entries).toHaveLength(0);
    expect(result.scan.complete).toBe(false);
    expect(result.scan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'text-extraction-limit' }),
    ]));
  });
});
