import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHeldoutCases } from './heldout-fixtures.mjs';
import { PROTOCOL, armOrder, prepareCase, scoreCode, scoreAnswer, summarize, decision } from './heldout-eval.mjs';

const root = await mkdtemp(join(tmpdir(), 'fast-jev-heldout-test-'));
try {
  const cases = makeHeldoutCases();
  const positions = Object.fromEntries(PROTOCOL.arms.map(arm => [arm, [0, 0, 0]]));
  for (const [caseIndex, testCase] of cases.entries()) {
    const prepared = await prepareCase(testCase, root, { ask: async (state, questions) => {
      assert.equal(state.taskContext, testCase.taskContext.slice(0, 2000));
      assert(!('expectedFacts' in state));
      assert(!('expectedSource' in state));
      return { model: 'offline-control', answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.5 }])) };
    } });
    assert.equal(prepared.report.jev.calls, 1);
    assert.deepEqual(prepared.report.rankings.jev, prepared.report.rankings.local, 'Equal scores retain production local order');
    assert.equal(prepared.packets.local.text, prepared.packets.jev.text, 'Identical order yields identical content');
    assert(prepared.packets.local.chars <= PROTOCOL.packetBudgetChars);
    for (const line of prepared.packets.local.text.split('\n').slice(1)) {
      assert(line.length <= PROTOCOL.entryBudgetChars);
      assert(JSON.parse(line).id);
    }
    const answer = { source: testCase.expectedSource, facts: testCase.expectedFacts };
    assert(scoreAnswer(testCase, answer).fullyCorrect, `${testCase.id}: reference answer must pass`);
    assert(!scoreAnswer(testCase, { ...answer, source: testCase.source }).fullyCorrect);
    assert(!scoreAnswer(testCase, null).fullyCorrect);
    for (let repetition = 0; repetition < 2; repetition++) armOrder(caseIndex, repetition).forEach((arm, position) => positions[arm][position]++);
  }
  for (const counts of Object.values(positions)) {
    assert.equal(counts.reduce((a, b) => a + b), 8);
    assert(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  assert.equal(scoreCode('function solve(input) { while (true) {} }', [{ input: {}, expected: {} }]).passed, 0);
  assert.equal(scoreCode('function solve(input) { return process.env; }', [{ input: {}, expected: {} }]).passed, 0);
  assert.equal(scoreCode('function solve(input) { return input.constructor.constructor("return process")(); }', [{ input: {}, expected: {} }]).passed, 0);
  assert.equal(decision([]).outcome, 'incomplete');
  assert.equal(summarize([]).jev.runs, 0);
  const makeReports = (correct, calls = () => 2, latency = () => 100) => cases.map((testCase, index) => ({
    id: testCase.id, jev: { calls: 1, model: 'offline-control', latencyMs: 1 },
    checkpoints: Array.from({ length: 3 }, () => ({ toolCalls: 0 })),
    compactions: Array.from({ length: 3 }, () => ({ completed: true })),
    continuations: PROTOCOL.arms.flatMap(arm => [0, 1].map(repetition => ({ arm, repetition,
      score: { fullyCorrect: correct(arm, index, repetition), facts: { correctFields: 3, totalFields: 3 },
        code: { passed: correct(arm, index, repetition) ? 10 : 9, total: 10, regressionFailures: 0 } },
      tools: Array.from({ length: calls(arm, index) }, () => ({ duplicate: false })), latencyMs: latency(arm) }))) }));
  assert.equal(decision(makeReports(() => true)).outcome, 'shelve', 'A perfect tie is not added value');
  assert.equal(decision(makeReports((arm, index) => arm === 'jev' || index > 1)).outcome, 'pursue');
  assert.equal(decision(makeReports((arm, index) => arm === 'jev' || index !== 0)).outcome, 'shelve', 'One task is insufficient');
  assert.equal(decision(makeReports(() => true, arm => arm === 'jev' ? 1 : 2)).outcome, 'pursue');
  assert.equal(decision(makeReports(() => true, arm => arm === 'jev' ? 1 : 2, arm => arm === 'jev' ? 200 : 100)).outcome, 'shelve');
  const regression = makeReports((arm, index) => arm === 'jev' || index > 1);
  regression[0].continuations.find(run => run.arm === 'jev').score.code.regressionFailures = 1;
  assert.equal(decision(regression).outcome, 'shelve', 'Pair-specific regression blocks even a higher total score');
  const incomplete = makeReports(() => true);
  incomplete[0].compactions.pop();
  assert.equal(decision(incomplete).outcome, 'incomplete');
  console.log('held-out evaluation self-test passed');
} finally { await rm(root, { recursive: true, force: true }); }
