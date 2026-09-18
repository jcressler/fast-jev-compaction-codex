#!/usr/bin/env node
import assert from 'node:assert/strict';
import { makePairedCases } from './paired-fixtures.mjs';

function callsFor(items) {
  return items.filter((item) => item.type === 'function_call');
}

function outputsFor(items) {
  return items.filter((item) => item.type === 'function_call_output');
}

function parseOutput(item) {
  return typeof item.output === 'string' ? JSON.parse(item.output) : item.output;
}

function run() {
  const first = makePairedCases();
  const second = makePairedCases();
  assert.equal(first.length, 6, 'fixture should contain six cases');
  assert.deepEqual(first.map((item) => item.id), [
    'receipt-seed-1', 'receipt-seed-2', 'release-seed-1', 'release-seed-2', 'migration-seed-1', 'migration-seed-2',
  ]);
  for (let index = 0; index < first.length; index += 1) {
    const fixture = first[index];
    assert.equal(fixture.query, second[index].query, `${fixture.id} query should be deterministic`);
    assert.deepEqual(fixture.items, second[index].items, `${fixture.id} items should be deterministic`);
    assert.deepEqual(fixture.expected, second[index].expected, `${fixture.id} expected should be deterministic`);
    assert.deepEqual(fixture.relevantCallIds, second[index].relevantCallIds, `${fixture.id} target IDs should be deterministic`);
    assert.ok(fixture.items.length >= 50, `${fixture.id} should provide >=24 paired entries plus prompts`);
    assert.equal(callsFor(fixture.items).length, 24, `${fixture.id} should have 24 calls`);
    assert.equal(outputsFor(fixture.items).length, 24, `${fixture.id} should have 24 outputs`);
  }

  for (const fixture of first) {
    const calls = callsFor(fixture.items);
    const outputs = outputsFor(fixture.items);
    const outputById = new Map(outputs.map((item) => [item.call_id, item]));
    for (const call of calls) {
      assert.ok(outputById.has(call.call_id), `${fixture.id} call ${call.call_id} is unpaired`);
      assert.equal(typeof call.arguments, 'string');
      assert.match(call.call_id, /^call-(receipt|release|migration)-[12]-\d{2}$/);
    }
    const targetCalls = fixture.relevantCallIds.map((id) => calls.find((call) => call.call_id === id));
    assert.ok(targetCalls.every(Boolean), `${fixture.id} target calls must be present`);
    assert.deepEqual(targetCalls.map((call) => calls.indexOf(call)), [4, 12, 21], `${fixture.id} target calls should span early, middle, and late positions`);
    const targetOutputs = targetCalls.map((call) => parseOutput(outputById.get(call.call_id)));
    if (fixture.id.startsWith('receipt')) {
      assert.deepEqual(targetOutputs.map((item) => item.revision), [1, 2, 2], `${fixture.id} receipt revisions`);
    } else if (fixture.id.startsWith('release')) {
      assert.deepEqual(targetOutputs.map((item) => item.status), ['failed', 'failed', 'approved'], `${fixture.id} deployment statuses`);
      assert.ok(targetOutputs.every((item) => /^rev-[a-z0-9]+-[abc]\d$/.test(item.revision)), `${fixture.id} deployment revisions`);
    } else {
      assert.deepEqual(targetOutputs.map((item) => item.status), ['failed', 'failed', 'retry-approved'], `${fixture.id} migration statuses`);
    }
    const targetKey = fixture.id.startsWith('receipt') ? 'receiptId' : fixture.id.startsWith('release') ? 'releaseId' : 'migrationId';
    assert.equal(targetOutputs[1].supersedes, targetOutputs[0][targetKey], `${fixture.id} middle fact should supersede early fact`);
    assert.match(targetOutputs[2].instruction, /do not|no migration/i, `${fixture.id} late fact should include negation/current instruction`);
    assert.ok(new Date(targetOutputs[0].recordedAt) < new Date(targetOutputs[1].recordedAt));
    assert.ok(new Date(targetOutputs[1].recordedAt) < new Date(targetOutputs[2].recordedAt));
  }

  for (const fixture of first) {
    const query = fixture.query.toLowerCase();
    assert.ok(!query.includes(JSON.stringify(fixture.expected).toLowerCase()), `${fixture.id} query leaks expected object`);
    for (const [field, value] of Object.entries(fixture.expected)) {
      // The shared action vocabulary is intentionally in every query; all
      // other expected values remain hidden from the model task.
      if (field !== 'nextAction') assert.ok(!query.includes(String(value).toLowerCase()), `${fixture.id} query leaks expected value`);
    }
    for (const callId of fixture.relevantCallIds) assert.ok(!query.includes(callId.toLowerCase()), `${fixture.id} query leaks oracle call ID`);
    assert.match(fixture.query, /return exactly json/i);
    assert.equal(fixture.answerSchema.additionalProperties, false);
    for (const field of fixture.answerSchema.required) assert.deepEqual(fixture.answerSchema.properties[field].type.slice(-1), ['null']);
    assert.deepEqual(fixture.answerSchema.properties.nextAction.enum, [null, 'no-write', 'retry migration', 'rollback', 'apply receipt', 'retry deployment', 'inspect evidence']);
  }

  for (const fixture of first) {
    assert.deepEqual(fixture.score(fixture.expected), { correctFields: 3, totalFields: 3, fullyCorrect: true });
    assert.deepEqual(fixture.score({}), { correctFields: 0, totalFields: 3, fullyCorrect: false });
    const fields = fixture.answerSchema.required;
    const oneField = { [fields[0]]: fixture.expected[fields[0]] };
    assert.deepEqual(fixture.score(oneField), { correctFields: 1, totalFields: 3, fullyCorrect: false });
    const wrong = { ...fixture.expected, [fields[0]]: fields[0] === 'sideEffects' ? true : '__wrong__' };
    assert.deepEqual(fixture.score(wrong), { correctFields: 2, totalFields: 3, fullyCorrect: false });
    assert.deepEqual(fixture.score(null), { correctFields: 0, totalFields: 3, fullyCorrect: false });
  }

  for (const family of ['receipt', 'release', 'migration']) {
    const one = first.find((item) => item.id === `${family}-seed-1`);
    const two = first.find((item) => item.id === `${family}-seed-2`);
    assert.deepEqual(one.answerSchema, two.answerSchema);
    assert.equal(one.query, two.query);
    assert.deepEqual(one.items.map((item) => item.type), two.items.map((item) => item.type));
    assert.notDeepEqual(one.expected, two.expected);
  }
  process.stdout.write('paired fixtures self-test passed\n');
}

run();
