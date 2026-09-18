import assert from 'node:assert/strict';
import { makeCorrectedCases } from './corrected-fixtures.mjs';
import { scoreCode, taskInputs } from './corrected-eval.mjs';

const cases = makeCorrectedCases();
assert.equal(cases.length, 4);
assert.equal(new Set(cases.map(item => item.id)).size, 4);
assert.deepEqual(cases.map(item => item.stages), makeCorrectedCases().map(item => item.stages));
for (const item of cases) {
  assert.equal(item.tests.length, 8);
  assert.equal(item.stages.length, 3);
  assert.equal(item.requirements.length, 3);
  assert(item.taskContext.includes(item.source));
  const inputs = taskInputs(item);
  assert(inputs.taskContext.length <= 2000 && inputs.query.length <= 1000);
  const outputs = item.stages.flat().filter(record => record.type === 'function_call_output');
  const calls = item.stages.flat().filter(record => record.type === 'function_call');
  assert.equal(calls.length, 72);
  assert.equal(outputs.length, 72);
  assert.equal(new Set(calls.map(record => record.call_id)).size, 72);
  assert(calls.every(record => outputs.some(output => output.call_id === record.call_id)));
  assert(item.stages.every(stage => stage.length === 48));
  const values = outputs.map(record => JSON.parse(record.output));
  assert(values.some(value => value.status === 'failed'));
  assert(values.some(value => value.status === 'stale'));
  assert(values.some(value => value.status === 'corrected'));
  assert.deepEqual(Object.keys(item.answerSchema.properties.facts.properties), Object.keys(item.expectedFacts));
  for (const [field, expected] of Object.entries(item.expectedFacts)) {
    assert(item.requirements.some(requirement => requirement.includes(field)), `${item.id}: required field ${field}`);
    const current = values.filter(value => value.fact === field).at(-1);
    assert(current, `${item.id}: ${field} needs a source record`);
    assert.deepEqual(current.value, expected, `${item.id}: current evidence must support the expected fact`);
    assert(!('const' in item.answerSchema.properties.facts.properties[field]));
    assert(!('enum' in item.answerSchema.properties.facts.properties[field]));
  }
  assert(item.scoreFacts(item.expectedFacts).fullyCorrect);
  assert.equal(item.scoreFacts({}).correctFields, 0);
  const reference = scoreCode(item.expectedSource, item.tests);
  assert(reference.allPassed, `${item.id}: reference fails ${reference.failedTests}`);
  const original = scoreCode(item.source, item.tests);
  assert(original.total - original.passed >= 2, `${item.id}: buggy code must fail at least two checks`);
  console.log(JSON.stringify({ fixture: item.id, reference: reference.passed, buggy: original.passed, contextChars: inputs.taskContext.length }));
}
console.log('corrected fixtures self-test passed');
