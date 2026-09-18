#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v1 from './automatic-fixtures.mjs';
import * as v2 from './automatic-fixtures-v2.mjs';

assert.equal(v2.taskCount(), 6);
for (let index = 0; index < v1.taskCount(); index += 1) {
  const oldTask = v1.createTask(index, 1);
  const newTask = v2.createTask(index, 1);
  assert.equal(newTask.id, oldTask.id, `${oldTask.baseId}: paired task id changed`);
  if (oldTask.baseId !== 'sku-index') {
    assert.deepEqual(newTask, oldTask, `${oldTask.baseId}: v2 changed an unaffected task`);
    continue;
  }
  assert.equal(newTask.contract, oldTask.contract.replace('sum integer quantities', 'sum nonnegative integer quantities'));
  assert.equal(newTask.files['README.md'], oldTask.files['README.md'].replace('sum integer quantities', 'sum nonnegative integer quantities'));
  const oldFiles = { ...oldTask.files }; const newFiles = { ...newTask.files };
  delete oldFiles['README.md']; delete newFiles['README.md'];
  assert.deepEqual(newFiles, oldFiles, 'sku-index: files other than README changed');
  assert.deepEqual(newTask.cases, oldTask.cases, 'sku-index: hidden cases changed');
  assert.deepEqual(newTask.invalid, oldTask.invalid, 'sku-index: hidden invalid cases changed');
  assert.deepEqual(newTask.referenceFiles, oldTask.referenceFiles, 'sku-index: reference files changed');
  assert.deepEqual(newTask.stages, oldTask.stages, 'sku-index: stage prompts changed');
  assert.deepEqual(newTask.immutableHashes, oldTask.immutableHashes, 'sku-index: immutable hashes changed');
}

// Preserve the original reference/starter proof for all six frozen tasks.
for (let index = 0; index < v1.taskCount(); index += 1) {
  const task = v1.createTask(index, 1);
  const dir = mkdtempSync(join(tmpdir(), `automatic-v2-${index}-`));
  try {
    v1.materializeTask(task, dir);
    const starter = await v1.scoreTask(task, dir);
    assert.equal(starter.passed, false, `${task.baseId}: frozen starter unexpectedly passed`);
    for (const [path, content] of Object.entries(task.referenceFiles)) writeFileSync(join(dir, path), content, 'utf8');
    const reference = await v1.scoreTask(task, dir);
    assert.equal(reference.passed, true, `${task.baseId}: frozen reference no longer passes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The clarified v2 SKU task retains the same executable hidden grader data.
const sku = v2.createTask(2, 1);
assert.deepEqual(sku.cases, v1.createTask(2, 1).cases);
assert.deepEqual(sku.invalid, v1.createTask(2, 1).invalid);
console.log('automatic fixtures v2 paired self-test passed');
