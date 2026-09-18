#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask, materializeTask, scoreTask, taskCount, taskHashes } from './automatic-fixtures.mjs';

assert.equal(taskCount(), 6);
const ids = new Set();
for (let index = 0; index < taskCount(); index += 1) {
  const task = createTask(index, 2);
  ids.add(task.baseId);
  assert.equal(task.stages.length, 3);
  assert.equal(task.manualCompactions, 2);
  assert.deepEqual(task.compactionBoundaries, [1, 2]);
  assert(Object.keys(task.files).length >= 8 && Object.keys(task.files).length <= 20);
  assert.equal(Object.keys(taskHashes(task)).length, Object.keys(task.files).length);
  assert(task.stages.every(stage => stage.prompt.includes('history/')));

  const starterDir = mkdtempSync(join(tmpdir(), `automatic-${index}-starter-`));
  materializeTask(task, starterDir);
  const starter = await scoreTask(task, starterDir);
  assert.equal(starter.passed, false, `${task.id}: broken starter unexpectedly passed`);
  assert(starter.checks.some(check => check.category === 'behavior' && !check.pass) || starter.checks.some(check => check.category === 'execution' && !check.pass));

  for (const [path, content] of Object.entries(task.referenceFiles)) writeFileSync(join(starterDir, path), content, 'utf8');
  const reference = await scoreTask(task, starterDir);
  assert.equal(reference.passed, true, `${task.id}: reference failed: ${JSON.stringify(reference.checks.filter(check => !check.pass))}`);
  assert.equal(reference.hardConstraintViolations.length, 0);
  assert.equal(readFileSync(join(starterDir, 'history/stage1.json'), 'utf8'), task.files['history/stage1.json']);
  rmSync(starterDir, { recursive: true, force: true });
  console.log(JSON.stringify({ task: task.baseId, files: Object.keys(task.files).length, starterPassed: starter.passed, referencePassed: reference.passed, checks: reference.checksTotal }));
}
assert.equal(ids.size, 6);

const a = createTask(0, 1);
const b = createTask(0, 1);
assert.deepEqual(a.files, b.files, 'same task/repetition must be deterministic');
assert.deepEqual(a.immutableHashes, b.immutableHashes);
console.log('automatic fixtures self-test passed');
