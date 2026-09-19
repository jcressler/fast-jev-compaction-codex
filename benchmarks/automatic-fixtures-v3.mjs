#!/usr/bin/env node
/**
 * Explicit-contract v3 fixture wrapper.
 *
 * The v1 fixture remains frozen.  This module changes only the visible
 * contract paragraph in each task and the matching README paragraph; all
 * executable grading data and reference material continue to come from v1.
 */
import * as v1 from './automatic-fixtures.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));

const contracts = {
  'ledger-idempotency': `Implement applyCommand(state, command) for a small account ledger. Return exactly { state, applied, duplicate } with no other top-level properties. A returned state has exactly { balance, processedIds, entries }: balance is a nonnegative integer, processedIds is an array of command-id strings in first-application order, and entries is an array of { id, type, amount } objects in that same order. Commands require a nonempty string id, type exactly deposit or withdraw, and a nonnegative integer amount. Validate id, type, and amount first; then an otherwise-valid id already in processedIds is a duplicate no-op with applied:false and duplicate:true, before checking withdrawal balance. A nonduplicate deposit or affordable withdrawal updates balance and appends one id and one entry; the input objects are never mutated. Throw an Error object whose .code is exactly ERR_INVALID_ID, ERR_INVALID_TYPE, ERR_NON_INTEGER_AMOUNT, ERR_NEGATIVE_AMOUNT, or ERR_INSUFFICIENT_BALANCE for the corresponding invalid cases; the error message alone is not the contract.`,
  'config-migration': `Implement migrateConfig(input) for versioned configuration. The input is an envelope { config, targetVersion?, preserveUnknown? }; a missing or non-object config is treated as empty, a targetVersion that is not a positive integer defaults to 4, and preserveUnknown defaults to true. Config keys retry_count, endpoint_url, and schema_version migrate to retryCount, endpointUrl, and schemaVersion. If a canonical key and its legacy spelling collide, keep the canonical value and emit no extra warning; legacy spellings are not retained. Preserve canonical keys and, when preserveUnknown is not false, unknown config keys; when it is false, drop unknown keys. Treat a missing or non-integer current schemaVersion as 0; if it is below target, set it to target, and never downgrade a higher current version. Return exactly { config, changed, warnings }, with changed true exactly when the resulting config fields or values differ from the input config, and warnings exactly [] except that a blocked downgrade returns exactly ['downgrade-blocked']. Do not mutate input.`,
  'sku-index': `Implement buildSkuIndex(rows) for catalog rows { sku, variantId, quantity }. Rows must be an array. Preserve sku and variantId as exact nonempty strings, including leading zeroes and the literal __proto__ key; do not coerce identifiers. Quantity must be a nonnegative integer. Group rows by exact sku in first-seen order and sum quantities. Return exactly { order, bySku }: order is the first-seen exact sku string array, and every own bySku value is exactly { sku, variantIds, totalQuantity }, with variantIds in source order. Construct bySku with own-property-safe behavior so __proto__ is ordinary data. Do not mutate rows. Throw an Error object whose .code is exactly ERR_INVALID_ROWS, ERR_INVALID_SKU, ERR_INVALID_VARIANT, or ERR_INVALID_QUANTITY for the corresponding invalid cases; the error message alone is not the contract.`,
  'config-precedence': `Implement resolveConfig(input) with four layers in order: defaults, file, environment, and cli. The defaults are exactly { timeoutMs: 3000, retries: 2, dryRun: true }. Later layers override earlier layers only when they have an own property for one of the known keys timeoutMs, retries, or dryRun; explicit false and zero are valid values. Unknown keys are ignored. Return exactly { config, sources }, where config contains exactly the three known keys and sources maps each known key to the winning layer name. Do not mutate input.`,
  'correction-ledger': `Implement applyCorrections(document, corrections). Return exactly { document, applied, rejected }, where applied is an array of successfully applied id strings and rejected is an array of exactly { id, reason } objects; reason is exactly invalid, duplicate, or conflict. Preserve unknown input document properties. document.appliedCorrectionIds is an optional string array: treat a missing value as [], persist a copied updated array even when it remains empty, and use existing ids for duplicate detection in first-seen order. document.revision defaults to 0 when it is not a nonnegative integer. Each correction requires a nonempty string id and a string field (the empty string is allowed), and carries value and expectedRevision. Process corrections in input order: reject malformed records, check duplicate before conflict (before expectedRevision conflict), reject a new id when expectedRevision differs from the current revision, and otherwise set the field, increment revision once, append the id to appliedCorrectionIds, and add it to applied. Continue after rejections and append only successfully applied ids. Do not mutate inputs.`,
  'receipt-reconciliation': `Implement reconcileReceipt(inventory, receipt). inventory is a map of exact nonempty string SKUs to nonnegative integer counts and may have an optional receipts string array; a missing receipts value defaults to []. receipt requires a nonempty string receiptId and a lines array of { sku, quantity } records. Apply each receipt id at most once: an id already in inventory.receipts is a duplicate no-op with applied:false and duplicate:true, leaves all counts unchanged, and appends no id. For a new receipt, validate the whole receipt before changing anything; each line sku is an exact nonempty string and quantity is a nonnegative integer. The reserved inventory key receipts is never a SKU and throws ERR_RESERVED_SKU. Preserve leading-zero identifiers, append a new receiptId once, and add each line quantity to its exact SKU count. Return exactly { inventory, applied, duplicate }; preserve unknown inventory properties and never mutate input. Throw an Error object whose .code is exactly ERR_INVALID_RECEIPT_ID, ERR_INVALID_LINES, ERR_INVALID_SKU, ERR_NON_INTEGER_QUANTITY, ERR_NEGATIVE_QUANTITY, or ERR_RESERVED_SKU as appropriate; the error message alone is not the contract.`
};

const clarifications = {
  'receipt-reconciliation': ' receipts is an array of exact nonempty receiptId strings kept in first-application order; validate receiptId, then lines-array shape, then duplicate short-circuit, and validate line contents only for a new receipt.',
};

export function createTask(taskIndex, repetition = 1) {
  const task = v1.createTask(taskIndex, repetition);
  const contract = `${contracts[task.baseId]}${clarifications[task.baseId] ?? ''}`;
  if (!contract) throw new Error(`Missing v3 contract for ${task.baseId}`);
  const updated = clone(task);
  updated.contract = contract;
  updated.files['README.md'] = updated.files['README.md'].replace(task.contract, contract);
  if (updated.files['README.md'] === task.files['README.md']) throw new Error(`README contract replacement failed for ${task.baseId}`);
  return updated;
}

export const materializeTask = v1.materializeTask;
export const scoreTask = v1.scoreTask;
export const taskCount = v1.taskCount;
export function taskHashes(task) { return v1.taskHashes(task); }
