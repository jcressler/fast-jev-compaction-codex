#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v1 from './automatic-fixtures.mjs';
import * as v3 from './automatic-fixtures-v3.mjs';

assert.equal(v3.taskCount(), 6);

const requiredText = {
  'ledger-idempotency': ['exactly { state, applied, duplicate }', 'processedIds', 'entries', 'duplicate no-op', '.code', 'ERR_INVALID_ID', 'ERR_INVALID_TYPE', 'ERR_NON_INTEGER_AMOUNT', 'ERR_NEGATIVE_AMOUNT', 'ERR_INSUFFICIENT_BALANCE'],
  'config-migration': ['{ config, targetVersion?, preserveUnknown? }', 'defaults to 4', 'canonical key', 'warnings exactly []', "['downgrade-blocked']", 'changed'],
  'sku-index': ['exactly { order, bySku }', 'nonnegative integer', '__proto__', 'exactly { sku, variantIds, totalQuantity }', '.code', 'ERR_INVALID_ROWS', 'ERR_INVALID_SKU', 'ERR_INVALID_VARIANT', 'ERR_INVALID_QUANTITY'],
  'config-precedence': ['defaults, file, environment, and cli', 'timeoutMs', 'retries', 'dryRun', 'false and zero', 'sources'],
  'correction-ledger': ['appliedCorrectionIds', 'defaults to 0', 'duplicate before conflict', 'append only successfully applied ids', 'invalid, duplicate, or conflict'],
  'receipt-reconciliation': ['receipts string array', 'duplicate no-op', 'validate the whole receipt', '.code', 'ERR_INVALID_RECEIPT_ID', 'ERR_INVALID_LINES', 'ERR_INVALID_SKU', 'ERR_NON_INTEGER_QUANTITY', 'ERR_NEGATIVE_QUANTITY', 'ERR_RESERVED_SKU', 'exactly { inventory, applied, duplicate }']
};

const withoutVisibleContract = (task) => {
  const copy = JSON.parse(JSON.stringify(task));
  delete copy.contract;
  delete copy.files['README.md'];
  return copy;
};

for (let index = 0; index < v1.taskCount(); index += 1) {
  for (const repetition of [1, 2]) {
    const oldTask = v1.createTask(index, repetition);
    const newTask = v3.createTask(index, repetition);
    assert.equal(newTask.id, oldTask.id, `${oldTask.baseId}: task id changed`);
    assert.equal(newTask.baseId, oldTask.baseId, `${oldTask.baseId}: base id changed`);
    assert.equal(newTask.repetition, oldTask.repetition, `${oldTask.baseId}: repetition changed`);
    assert.notEqual(newTask.contract, oldTask.contract, `${oldTask.baseId}: contract was not clarified`);
    assert.deepEqual(withoutVisibleContract(newTask), withoutVisibleContract(oldTask), `${oldTask.baseId}: task changed beyond contract and README`);
    for (const phrase of requiredText[oldTask.baseId]) assert.match(newTask.contract, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${oldTask.baseId}: missing visible contract text ${phrase}`);

    const oldFiles = { ...oldTask.files };
    const newFiles = { ...newTask.files };
    assert.deepEqual(Object.keys(newFiles).sort(), Object.keys(oldFiles).sort(), `${oldTask.baseId}: file set changed`);
    delete oldFiles['README.md'];
    delete newFiles['README.md'];
    assert.deepEqual(newFiles, oldFiles, `${oldTask.baseId}: files other than README changed`);
    assert.deepEqual(newTask.cases, oldTask.cases, `${oldTask.baseId}: hidden cases changed`);
    assert.deepEqual(newTask.invalid, oldTask.invalid, `${oldTask.baseId}: hidden invalid cases changed`);
    assert.deepEqual(newTask.referenceFiles, oldTask.referenceFiles, `${oldTask.baseId}: reference files changed`);
    assert.deepEqual(newTask.stages, oldTask.stages, `${oldTask.baseId}: stages changed`);
    assert.deepEqual(newTask.immutableHashes, oldTask.immutableHashes, `${oldTask.baseId}: immutable hashes changed`);
    assert.equal(newTask.entry, oldTask.entry, `${oldTask.baseId}: entry changed`);
    assert.equal(newTask.exportName, oldTask.exportName, `${oldTask.baseId}: export changed`);
    assert.equal(newTask.publicEntry, oldTask.publicEntry, `${oldTask.baseId}: public entry changed`);
    assert.equal(newTask.manualCompactions, oldTask.manualCompactions, `${oldTask.baseId}: compaction count changed`);
    assert.deepEqual(newTask.compactionBoundaries, oldTask.compactionBoundaries, `${oldTask.baseId}: compaction boundaries changed`);
    assert.equal(newTask.files['README.md'].includes(newTask.contract), true, `${oldTask.baseId}: README omits clarified contract`);
  }
}

// The v1 reference implementations must still pass, while each frozen
// starter must still fail, under the v3 wrapper's unchanged grader.
for (let index = 0; index < v3.taskCount(); index += 1) {
  const task = v3.createTask(index, 1);
  const dir = mkdtempSync(join(tmpdir(), `automatic-v3-${index}-`));
  try {
    v3.materializeTask(task, dir);
    const starter = await v3.scoreTask(task, dir);
    assert.equal(starter.passed, false, `${task.baseId}: frozen starter unexpectedly passed`);
    for (const [path, content] of Object.entries(task.referenceFiles)) writeFileSync(join(dir, path), content, 'utf8');
    const reference = await v3.scoreTask(task, dir);
    assert.equal(reference.passed, true, `${task.baseId}: frozen reference failed`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('automatic fixtures v3 explicit-contract self-test passed');
