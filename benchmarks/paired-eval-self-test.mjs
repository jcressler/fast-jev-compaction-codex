import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePairedCases } from './paired-fixtures.mjs';
import { armOrder, DEFAULT_PROTOCOL, evidencePacket, prepareCase, summarize } from './paired-eval.mjs';

const root = await mkdtemp(join(tmpdir(), 'fast-jev-paired-test-'));
try {
  const cases = makePairedCases();
  const positionCounts = Object.fromEntries(DEFAULT_PROTOCOL.arms.map(arm => [arm, [0, 0, 0, 0]]));
  for (const [caseIndex, testCase] of cases.entries()) {
    const prepared = await prepareCase(testCase, root);
    assert.equal(prepared.report.jev.calls, 0);
    assert.equal(prepared.report.candidateCount, 20);
    const rankings = prepared.report.rankings;
    assert.deepEqual([...rankings.local].sort(), [...rankings['candidate-order']].sort());
    assert.equal(prepared.report.targetRecords, testCase.relevantCallIds.length);
    assert(prepared.report.targetCandidates <= prepared.report.targetRecords, 'Candidate omissions must be measured, never repaired with gold labels');
    const sharedLines = new Map();
    for (const packet of Object.values(prepared.packets)) {
      assert(packet.chars <= DEFAULT_PROTOCOL.packetBudgetChars);
      for (const line of packet.text.split('\n').slice(1)) {
        assert(line.length <= DEFAULT_PROTOCOL.entryBudgetChars);
        const id = JSON.parse(line).id;
        if (sharedLines.has(id)) assert.equal(line, sharedLines.get(id), 'Arms must project identical record content');
        sharedLines.set(id, line);
      }
    }
    for (let repetition = 0; repetition < 2; repetition++) {
      armOrder(caseIndex, repetition).forEach((arm, position) => positionCounts[arm][position]++);
    }
  }
  for (const counts of Object.values(positionCounts)) assert.deepEqual(counts, [3, 3, 3, 3]);
  const preview = evidencePacket([{ id: 'x'.repeat(64), tool: 'test', summary: 's', outcome: 'o', matches: [], packetText: 'x'.repeat(10000) }]);
  assert(preview.text.length <= DEFAULT_PROTOCOL.packetBudgetChars);
  const empty = summarize([]);
  assert.equal(empty.jev.runs, 0);
  assert.equal(empty.jev.totalFields, 0);
  const testCase = cases[0];
  const summary = summarize([{ continuations: [
    { arm: 'local', score: testCase.score(testCase.expected), latencyMs: 10 },
    { arm: 'local', score: testCase.score({}), latencyMs: 20 },
  ] }]);
  assert.equal(summary.local.runs, 2);
  assert.equal(summary.local.fullyCorrect, 1);
  assert.equal(summary.local.correctFields, 3);
  assert.equal(summary.local.totalFields, 6);
  console.log('paired evaluation self-test passed');
} finally { await rm(root, { recursive: true, force: true }); }
