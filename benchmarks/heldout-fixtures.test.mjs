#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeHeldoutCases } from './heldout-fixtures.mjs';

function callsFor(items) {
  return items.filter((item) => item.type === 'function_call');
}

function outputsFor(items) {
  return items.filter((item) => item.type === 'function_call_output');
}

function runSource(source, input) {
  const context = {};
  vm.runInNewContext(`${source}\nthis.__solve = solve;`, context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.__solve(input)));
}

function run() {
  const first = makeHeldoutCases();
  const second = makeHeldoutCases();
  assert.equal(first.length, 6, 'held-out set should contain six cases');
  assert.deepEqual(first.map((item) => item.id), [
    'cursor-window', 'retry-key', 'local-window', 'cent-rounding', 'reservation-ledger', 'csv-identifiers',
  ]);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));

  for (let index = 0; index < first.length; index += 1) {
    const fixture = first[index];
    assert.deepEqual(fixture.stages, second[index].stages, `${fixture.id} stages should be deterministic`);
    assert.deepEqual(fixture.tests, second[index].tests, `${fixture.id} tests should be deterministic`);
    assert.equal(fixture.stages.length, 3, `${fixture.id} should have three evidence stages`);
    assert.ok(fixture.query.length < 4000, `${fixture.id} query should fit the search prompt budget`);
    assert.ok(fixture.taskContext.includes(fixture.source), `${fixture.id} must show source in task context`);
    assert.notEqual(fixture.source, fixture.expectedSource, `${fixture.id} baseline must differ from expected source`);
    assert.deepEqual(fixture.answerSchema.required, ['source', 'facts']);
    assert.equal(fixture.answerSchema.additionalProperties, false);
    assert.equal(fixture.answerSchema.properties.facts.additionalProperties, false);
    assert.ok(fixture.tests.some((test) => test.regression), `${fixture.id} should mark historical regression checks`);
    assert.deepEqual(fixture.scoreFacts({ facts: fixture.expectedFacts }), {
      correctFields: Object.keys(fixture.expectedFacts).length,
      totalFields: Object.keys(fixture.expectedFacts).length,
      fullyCorrect: true,
    });
    assert.deepEqual(fixture.scoreFacts(fixture.expectedFacts), fixture.scoreFacts({ facts: fixture.expectedFacts }));
    assert.deepEqual(fixture.scoreFacts({ facts: {} }), {
      correctFields: 0,
      totalFields: Object.keys(fixture.expectedFacts).length,
      fullyCorrect: false,
    });

    const allCalls = fixture.stages.flatMap(callsFor);
    const allOutputs = fixture.stages.flatMap(outputsFor);
    assert.equal(allCalls.length, 72, `${fixture.id} should have 72 calls`);
    assert.equal(allOutputs.length, 72, `${fixture.id} should have 72 outputs`);
    assert.ok(fixture.stages.every((stage) => callsFor(stage).length === 24));
    assert.ok(fixture.stages.every((stage) => outputsFor(stage).length === 24));
    assert.equal(new Set(allCalls.map((item) => item.call_id)).size, 72, `${fixture.id} call IDs should be unique`);
    assert.ok(allCalls.every((item) => /^q[0-9a-f]{8}$/.test(item.call_id)), `${fixture.id} call IDs should be opaque`);
    const outputIds = new Set(allOutputs.map((item) => item.call_id));
    assert.ok(allCalls.every((item) => outputIds.has(item.call_id)), `${fixture.id} calls must be paired`);
    assert.equal(fixture.relevantCallIds.length, 4);
    assert.ok(fixture.relevantCallIds.every((id) => outputIds.has(id)));
    const relevantOutputs = allOutputs.filter((item) => fixture.relevantCallIds.includes(item.call_id));
    assert.equal(new Set(relevantOutputs.map((item) => JSON.parse(item.output).fact)).size, 4);
    assert.ok(allOutputs.every((item) => item.output.length >= 400), `${fixture.id} outputs should carry realistic evidence`);

    let baselineFailures = 0;
    for (const test of fixture.tests) {
      const expected = runSource(fixture.expectedSource, test.input);
      assert.deepEqual(expected, test.expected, `${fixture.id}/${test.name} expected source`);
      try {
        assert.deepEqual(runSource(fixture.source, test.input), test.expected);
      } catch {
        baselineFailures += 1;
      }
    }
    assert.ok(baselineFailures >= 1, `${fixture.id} baseline must fail at least one regression test`);
  }
  process.stdout.write('held-out fixtures self-test passed\n');
}

run();
