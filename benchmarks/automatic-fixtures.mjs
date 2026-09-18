#!/usr/bin/env node
/**
 * Six deterministic, held-out style coding tasks for automatic-compaction runs.
 *
 * `files` is the model-visible starter repository.  The expected examples and
 * reference implementations live only in this evaluator module; materializeTask
 * deliberately never writes them into the task workspace.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (value) => JSON.stringify(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function commonFiles(id, entry, exportName, contract, history) {
  const inspectionLog = Array.from({ length: 160 }, (_, index) => `${String(index + 1).padStart(3, '0')} activity=${index % 5 === 0 ? 'warning' : 'ok'} workspace=${id} sample=${(index * 7919 + id.length).toString(16)} note=surrounding diagnostic output; inspect the authoritative history records separately`).join('\n') + '\n';
  return {
    'package.json': JSON.stringify({ name: `heldout-${id}`, private: true, type: 'module', scripts: { test: 'node tests/contract.test.mjs' } }, null, 2) + '\n',
    'README.md': `# ${id}\n\n${contract}\n\nThe public facade is src/index.mjs and must export the named function. Implement the shared src/validation.mjs helper hasOwn(value, key): it returns true only for an own property, including falsy values, and false for missing or inherited properties. Complete both the domain module and validation helper; do not rely on source-text matching.\n\nImmutable from the first edit: history/*, package.json, config/runtime.json, docs/OPERATIONS.md, and fixtures/README.md. Allowed edits/additions: src/**, tests/**, and docs/DECISIONS.md. Do not add files elsewhere. Work only in this repository. The history files are authoritative evidence; retain their identifiers exactly.\n`,
    'config/runtime.json': JSON.stringify({ environment: 'test', network: 'disabled', entry }, null, 2) + '\n',
    'tests/contract.test.mjs': `// Visible smoke contract. The evaluator runs additional isolated cases through the public facade.\nimport { ${exportName} } from '../src/index.mjs';\nconsole.log(typeof ${exportName});\n`,
    'docs/OPERATIONS.md': 'This synthetic repository is offline. Do not add network, upload, child-process, or filesystem behavior to the library module.\n',
    'history/stage1.json': JSON.stringify(history[0], null, 2) + '\n',
    'history/stage2.json': JSON.stringify(history[1], null, 2) + '\n',
    'history/stage3.json': JSON.stringify(history[2], null, 2) + '\n',
    'history/inspection.log': inspectionLog,
  };
}

const specs = [
  {
    id: 'ledger-idempotency', entry: 'src/ledger.mjs', exportName: 'applyCommand',
    contract: 'Implement applyCommand(state, command) for a small account ledger. Return { state, applied, duplicate }; commands have string ids, type deposit or withdraw, and nonnegative integer amount. An otherwise-valid command id may change state at most once, the input must remain unchanged, and state keeps balance, processedIds, and entries in order. Throw codes ERR_INVALID_ID, ERR_INVALID_TYPE, ERR_NON_INTEGER_AMOUNT, ERR_NEGATIVE_AMOUNT, and ERR_INSUFFICIENT_BALANCE for the corresponding invalid cases.',
    history: [
      { stage: 1, event: 'lookup', orderId: 'LEDGER-001', note: 'Operations requires command ids to remain strings, including ids with leading zeroes.', status: 'observed' },
      { stage: 2, event: 'correction', commandId: '0007', note: 'Duplicate delivery of the same otherwise-valid command is an acknowledged no-op even when the retry payload changes; do not append a second entry.', status: 'approved' },
      { stage: 3, event: 'policy', note: 'Reject negative or fractional amounts, unknown types, missing ids, and withdrawals larger than balance with stable error codes.', status: 'corrected' },
    ],
    starter: `export function applyCommand(state, command) {\n  // TODO: implement the idempotent ledger transition.\n  return { state, applied: false, duplicate: false };\n}\n`,
    reference: `export function applyCommand(state, command) {\n  const s = state && typeof state === 'object' ? state : {};\n  const c = command && typeof command === 'object' ? command : {};\n  if (typeof c.id !== 'string' || !c.id) throw Object.assign(new Error('id required'), { code: 'ERR_INVALID_ID' });\n  if (!['deposit','withdraw'].includes(c.type)) throw Object.assign(new Error('type invalid'), { code: 'ERR_INVALID_TYPE' });\n  if (!Number.isInteger(c.amount)) throw Object.assign(new Error('amount must be integer'), { code: 'ERR_NON_INTEGER_AMOUNT' });\n  if (c.amount < 0) throw Object.assign(new Error('amount negative'), { code: 'ERR_NEGATIVE_AMOUNT' });\n  const ids = Array.isArray(s.processedIds) ? s.processedIds : [];\n  if (ids.includes(c.id)) return { state: { balance: Number(s.balance) || 0, processedIds: ids.slice(), entries: Array.isArray(s.entries) ? s.entries.map(x => ({ ...x })) : [] }, applied: false, duplicate: true };\n  const balance = Number.isInteger(s.balance) && s.balance >= 0 ? s.balance : 0;\n  if (c.type === 'withdraw' && c.amount > balance) throw Object.assign(new Error('insufficient balance'), { code: 'ERR_INSUFFICIENT_BALANCE' });\n  const nextBalance = c.type === 'deposit' ? balance + c.amount : balance - c.amount;\n  const entry = { id: c.id, type: c.type, amount: c.amount };\n  return { state: { balance: nextBalance, processedIds: [...ids, c.id], entries: [...(Array.isArray(s.entries) ? s.entries.map(x => ({ ...x })) : []), entry] }, applied: true, duplicate: false };\n}\n`,
    cases: [
      { input: { state: { balance: 10, processedIds: [], entries: [] }, command: { id: '0007', type: 'deposit', amount: 5 } }, expected: { state: { balance: 15, processedIds: ['0007'], entries: [{ id: '0007', type: 'deposit', amount: 5 }] }, applied: true, duplicate: false } },
      { input: { state: { balance: 15, processedIds: ['0007'], entries: [{ id: '0007', type: 'deposit', amount: 5 }] }, command: { id: '0007', type: 'withdraw', amount: 99 } }, expected: { state: { balance: 15, processedIds: ['0007'], entries: [{ id: '0007', type: 'deposit', amount: 5 }] }, applied: false, duplicate: true } },
      { input: { state: { balance: 15, processedIds: [], entries: [] }, command: { id: 'w1', type: 'withdraw', amount: 4 } }, expected: { state: { balance: 11, processedIds: ['w1'], entries: [{ id: 'w1', type: 'withdraw', amount: 4 }] }, applied: true, duplicate: false } },
    ],
    invalid: [
      { input: { state: { balance: 1, processedIds: [], entries: [] }, command: { id: 'x', type: 'withdraw', amount: 2 } }, code: 'ERR_INSUFFICIENT_BALANCE' },
      { input: { state: { balance: 1, processedIds: [], entries: [] }, command: { id: 'x', type: 'deposit', amount: 1.5 } }, code: 'ERR_NON_INTEGER_AMOUNT' },
    ],
  },
  {
    id: 'config-migration', entry: 'src/config-migrate.mjs', exportName: 'migrateConfig',
    contract: 'Implement migrateConfig(input) for versioned configuration. Rename retry_count, endpoint_url, and schema_version to retryCount, endpointUrl, and schemaVersion; preserve canonical keys and optionally unknown keys; upgrade to a positive target version without downgrading. Return exactly { config, changed, warnings }, where warnings is an array of strings, and do not mutate input.',
    history: [
      { stage: 1, event: 'migration-draft', schemaVersion: 2, note: 'The version-two draft is retired; do not use it as the default.', status: 'stale' },
      { stage: 2, event: 'schema-registry', targetVersion: 4, note: 'The registry confirms schemaVersion is the canonical field and target 4 is current.', status: 'approved' },
      { stage: 3, event: 'safety', note: 'Unknown keys are preserved by default, may be dropped only when explicitly false, and a downgrade emits downgrade-blocked.', status: 'corrected' },
    ],
    starter: `export function migrateConfig(input) {\n  // TODO: make this migration repeatable and safe.\n  return { config: {}, changed: true, warnings: [] };\n}\n`,
    reference: `export function migrateConfig(input) {\n  const original = input && input.config && typeof input.config === 'object' ? input.config : {};\n  const target = Number.isInteger(input?.targetVersion) && input.targetVersion > 0 ? input.targetVersion : 4;\n  const keep = input?.preserveUnknown !== false; const config = {};\n  for (const [k,v] of Object.entries(original)) if (!['retry_count','endpoint_url','schema_version'].includes(k) && (['retryCount','endpointUrl','schemaVersion'].includes(k) || keep)) config[k] = v;\n  if (Object.hasOwn(original, 'retryCount')) config.retryCount = original.retryCount; else if (Object.hasOwn(original, 'retry_count')) config.retryCount = original.retry_count;\n  if (Object.hasOwn(original, 'endpointUrl')) config.endpointUrl = original.endpointUrl; else if (Object.hasOwn(original, 'endpoint_url')) config.endpointUrl = original.endpoint_url;\n  if (Object.hasOwn(original, 'schemaVersion')) config.schemaVersion = original.schemaVersion; else if (Object.hasOwn(original, 'schema_version')) config.schemaVersion = original.schema_version;\n  const current = Number.isInteger(config.schemaVersion) ? config.schemaVersion : 0;\n  if (current < target) config.schemaVersion = target;\n  return { config, changed: JSON.stringify(config) !== JSON.stringify(original), warnings: current > target ? ['downgrade-blocked'] : [] };\n}\n`,
    cases: [
      { input: { config: { retry_count: 2, endpoint_url: '/v1' } }, expected: { config: { retryCount: 2, endpointUrl: '/v1', schemaVersion: 4 }, changed: true, warnings: [] } },
      { input: { config: { schemaVersion: 6, x: 1 }, targetVersion: 4 }, expected: { config: { schemaVersion: 6, x: 1 }, changed: false, warnings: ['downgrade-blocked'] } },
      { input: { config: { feature: true, retryCount: 1, schemaVersion: 1 }, preserveUnknown: false }, expected: { config: { retryCount: 1, schemaVersion: 4 }, changed: true, warnings: [] } },
      { input: { config: { retry_count: 2, retryCount: 9 }, targetVersion: 4 }, expected: { config: { retryCount: 9, schemaVersion: 4 }, changed: true, warnings: [] } },
    ], invalid: [],
  },
  {
    id: 'sku-index', entry: 'src/sku-index.mjs', exportName: 'buildSkuIndex',
    contract: 'Implement buildSkuIndex(rows) for catalog rows {sku, variantId, quantity}. Preserve SKU and variant identifiers as exact strings, including leading zeroes and the literal __proto__ key. Group rows by exact SKU in first-seen order, sum integer quantities, and return { order, bySku }. Do not mutate rows; reject malformed input with ERR_INVALID_ROWS, identifiers with ERR_INVALID_SKU or ERR_INVALID_VARIANT, and bad quantities with ERR_INVALID_QUANTITY. Use own-property-safe construction for the bySku index.',
    history: [
      { stage: 1, event: 'catalog', sku: '000042', note: 'SKU strings are identifiers; numeric coercion is forbidden.', status: 'observed' },
      { stage: 2, event: 'correction', sku: '000042', note: 'Two variants with the same exact SKU aggregate in source order; 42 and 000042 are different keys.', status: 'approved' },
      { stage: 3, event: 'audit', note: 'The output order array is the first-seen exact SKU order and each bySku entry contains variantIds and totalQuantity.', status: 'corrected' },
    ],
    starter: `export function buildSkuIndex(rows) {\n  // TODO: index the catalog without coercing identifiers.\n  return { order: [], bySku: {} };\n}\n`,
    reference: `export function buildSkuIndex(rows) {\n  if (!Array.isArray(rows)) throw Object.assign(new Error('rows required'), { code: 'ERR_INVALID_ROWS' });\n  const order = [], bySku = {};\n  for (const row of rows) {\n    if (!row || typeof row.sku !== 'string' || !row.sku) throw Object.assign(new Error('sku invalid'), { code: 'ERR_INVALID_SKU' });\n    if (typeof row.variantId !== 'string' || !row.variantId) throw Object.assign(new Error('variant invalid'), { code: 'ERR_INVALID_VARIANT' });\n    if (!Number.isInteger(row.quantity) || row.quantity < 0) throw Object.assign(new Error('quantity invalid'), { code: 'ERR_INVALID_QUANTITY' });\n    if (!Object.hasOwn(bySku, row.sku)) { order.push(row.sku); bySku[row.sku] = { sku: row.sku, variantIds: [], totalQuantity: 0 }; }\n    bySku[row.sku].variantIds.push(row.variantId); bySku[row.sku].totalQuantity += row.quantity;\n  }\n  return { order, bySku };\n}\n`,
    cases: [
      { input: [{ sku: '000042', variantId: 'v1', quantity: 2 }, { sku: '42', variantId: 'v2', quantity: 3 }, { sku: '000042', variantId: 'v3', quantity: 1 }], expected: { order: ['000042', '42'], bySku: { '000042': { sku: '000042', variantIds: ['v1', 'v3'], totalQuantity: 3 }, '42': { sku: '42', variantIds: ['v2'], totalQuantity: 3 } } } },
      { input: [], expected: { order: [], bySku: {} } },
    ], invalid: [{ input: [{ sku: 42, variantId: 'v', quantity: 1 }], code: 'ERR_INVALID_SKU' }, { input: [{ sku: 'x', variantId: 'v', quantity: -1 }], code: 'ERR_INVALID_QUANTITY' }],
  },
  {
    id: 'config-precedence', entry: 'src/resolve-config.mjs', exportName: 'resolveConfig',
    contract: 'Implement resolveConfig(input) with defaults, file, environment, and CLI layers. Later layers override earlier layers only for known keys timeoutMs, retries, and dryRun; explicit false and zero are valid. Return exactly { config, sources } where each source names the winning layer. Do not mutate input and ignore unknown keys.',
    history: [
      { stage: 1, event: 'defaults', timeoutMs: 3000, retries: 2, dryRun: true, note: 'These are the current safe defaults.', status: 'observed' },
      { stage: 2, event: 'precedence', note: 'CLI overrides environment, environment overrides file, and file overrides defaults; false is an intentional value.', status: 'approved' },
      { stage: 3, event: 'correction', note: 'Do not use truthiness checks. Unknown keys never enter config or sources.', status: 'corrected' },
    ],
    starter: `export function resolveConfig(input) {\n  // TODO: resolve layered settings.\n  return { config: {}, sources: {} };\n}\n`,
    reference: `export function resolveConfig(input) {\n  const keys = ['timeoutMs','retries','dryRun']; const defaults = { timeoutMs: 3000, retries: 2, dryRun: true };\n  const layers = [['defaults', defaults], ['file', input?.file], ['environment', input?.environment], ['cli', input?.cli]]; const config = {}; const sources = {};\n  for (const key of keys) { for (const [name, layer] of layers) if (layer && Object.hasOwn(layer, key)) { config[key] = layer[key]; sources[key] = name; } if (!Object.hasOwn(config,key)) { config[key] = defaults[key]; sources[key] = 'defaults'; } }\n  return { config, sources };\n}\n`,
    cases: [
      { input: { file: { timeoutMs: 1000, dryRun: false }, environment: { retries: 5 }, cli: { retries: 0 } }, expected: { config: { timeoutMs: 1000, retries: 0, dryRun: false }, sources: { timeoutMs: 'file', retries: 'cli', dryRun: 'file' } } },
      { input: {}, expected: { config: { timeoutMs: 3000, retries: 2, dryRun: true }, sources: { timeoutMs: 'defaults', retries: 'defaults', dryRun: 'defaults' } } },
      { input: { file: { dryRun: false, unknown: 'x' }, cli: { timeoutMs: 0 } }, expected: { config: { timeoutMs: 0, retries: 2, dryRun: false }, sources: { timeoutMs: 'cli', retries: 'defaults', dryRun: 'file' } } },
    ], invalid: [],
  },
  {
    id: 'correction-ledger', entry: 'src/corrections.mjs', exportName: 'applyCorrections',
    contract: 'Implement applyCorrections(document, corrections). Each correction has id, field, value, and expectedRevision. Apply each id at most once, only when expectedRevision equals the current revision, and return exactly { document, applied, rejected }; applied is an array of ids and rejected is an array of { id, reason } with reason invalid, duplicate, or conflict. Increment revision for every applied correction, preserve correction order, and do not mutate inputs.',
    history: [
      { stage: 1, event: 'correction-feed', correctionId: 'corr-001', note: 'Correction identifiers are stable strings and retries are common.', status: 'observed' },
      { stage: 2, event: 'retry', correctionId: 'corr-001', note: 'The second delivery is an idempotent duplicate and must not increment revision.', status: 'approved' },
      { stage: 3, event: 'conflict', note: 'A stale expectedRevision is rejected with reason conflict; continue evaluating later independent records.', status: 'corrected' },
    ],
    starter: `export function applyCorrections(document, corrections) {\n  // TODO: apply corrections exactly once.\n  return { document, applied: [], rejected: [] };\n}\n`,
    reference: `export function applyCorrections(document, corrections) {\n  const original = document && typeof document === 'object' ? document : {}; const out = { ...original }; const applied = []; const rejected = []; const seen = new Set(Array.isArray(out.appliedCorrectionIds) ? out.appliedCorrectionIds : []);\n  let revision = Number.isInteger(out.revision) && out.revision >= 0 ? out.revision : 0;\n  out.appliedCorrectionIds = [...seen];\n  for (const c of Array.isArray(corrections) ? corrections : []) {\n    if (!c || typeof c.id !== 'string' || !c.id || typeof c.field !== 'string') { rejected.push({ id: c?.id ?? null, reason: 'invalid' }); continue; }\n    if (seen.has(c.id)) { rejected.push({ id: c.id, reason: 'duplicate' }); continue; }\n    if (c.expectedRevision !== revision) { rejected.push({ id: c.id, reason: 'conflict' }); continue; }\n    out[c.field] = c.value; revision += 1; seen.add(c.id); out.appliedCorrectionIds.push(c.id); applied.push(c.id);\n  }\n  out.revision = revision; return { document: out, applied, rejected };\n}\n`,
    cases: [
      { input: { document: { revision: 0, status: 'open' }, corrections: [{ id: 'corr-001', field: 'status', value: 'closed', expectedRevision: 0 }] }, expected: { document: { revision: 1, status: 'closed', appliedCorrectionIds: ['corr-001'] }, applied: ['corr-001'], rejected: [] } },
      { input: { document: { revision: 1, status: 'closed', appliedCorrectionIds: ['corr-001'] }, corrections: [{ id: 'corr-001', field: 'status', value: 'open', expectedRevision: 1 }, { id: 'corr-002', field: 'note', value: 'x', expectedRevision: 0 }] }, expected: { document: { revision: 1, status: 'closed', appliedCorrectionIds: ['corr-001'] }, applied: [], rejected: [{ id: 'corr-001', reason: 'duplicate' }, { id: 'corr-002', reason: 'conflict' }] } },
    ], invalid: [],
  },
  {
    id: 'receipt-reconciliation', entry: 'src/reconcile-receipt.mjs', exportName: 'reconcileReceipt',
    contract: 'Implement reconcileReceipt(inventory, receipt). Receipt has receiptId and lines {sku, quantity}; inventory is a map of exact string SKUs to nonnegative integer counts. Apply a receipt at most once using inventory.receipts, preserve leading-zero identifiers, validate the whole receipt before changing anything, and return { inventory, applied, duplicate }. The reserved inventory key receipts is not a SKU and must throw ERR_RESERVED_SKU. Throw ERR_INVALID_RECEIPT_ID, ERR_INVALID_LINES, ERR_INVALID_SKU, ERR_NON_INTEGER_QUANTITY, or ERR_NEGATIVE_QUANTITY as appropriate and never mutate input.',
    history: [
      { stage: 1, event: 'receiving', receiptId: 'receipt-0003', note: 'The receipt id and item SKUs are strings and must retain leading zeroes.', status: 'observed' },
      { stage: 2, event: 'replay', receiptId: 'receipt-0003', note: 'A retried webhook with a changed line quantity is a duplicate no-op; inventory and receipt history remain unchanged.', status: 'approved' },
      { stage: 3, event: 'validation', note: 'Validate all lines before applying any quantity; failed receipts have no partial inventory update.', status: 'corrected' },
    ],
    starter: `export function reconcileReceipt(inventory, receipt) {\n  // TODO: reconcile one receipt transactionally.\n  return { inventory, applied: false, duplicate: false };\n}\n`,
    reference: `export function reconcileReceipt(inventory, receipt) {\n  const base = inventory && typeof inventory === 'object' ? inventory : {}; const id = receipt?.receiptId;\n  if (typeof id !== 'string' || !id) throw Object.assign(new Error('receipt id invalid'), { code: 'ERR_INVALID_RECEIPT_ID' });\n  const lines = receipt?.lines; if (!Array.isArray(lines)) throw Object.assign(new Error('lines invalid'), { code: 'ERR_INVALID_LINES' });\n  const receipts = Array.isArray(base.receipts) ? base.receipts : [];\n  if (receipts.includes(id)) return { inventory: { ...base, receipts: receipts.slice() }, applied: false, duplicate: true };\n  for (const line of lines) { if (!line || typeof line.sku !== 'string' || !line.sku) throw Object.assign(new Error('sku invalid'), { code: 'ERR_INVALID_SKU' }); if (!Number.isInteger(line.quantity)) throw Object.assign(new Error('quantity invalid'), { code: 'ERR_NON_INTEGER_QUANTITY' }); if (line.quantity < 0) throw Object.assign(new Error('quantity negative'), { code: 'ERR_NEGATIVE_QUANTITY' }); }\n  const out = { ...base, receipts: [...receipts, id] }; for (const line of lines) out[line.sku] = (Number.isInteger(out[line.sku]) ? out[line.sku] : 0) + line.quantity;\n  return { inventory: out, applied: true, duplicate: false };\n}\n`,
    cases: [
      { input: { inventory: { '000042': 3, receipts: [] }, receipt: { receiptId: 'receipt-0003', lines: [{ sku: '000042', quantity: 2 }, { sku: '7', quantity: 1 }] } }, expected: { inventory: { '000042': 5, receipts: ['receipt-0003'], '7': 1 }, applied: true, duplicate: false } },
      { input: { inventory: { '000042': 5, receipts: ['receipt-0003'] }, receipt: { receiptId: 'receipt-0003', lines: [{ sku: '000042', quantity: 99 }] } }, expected: { inventory: { '000042': 5, receipts: ['receipt-0003'] }, applied: false, duplicate: true } },
    ], invalid: [{ input: { inventory: { '000042': 3, receipts: [] }, receipt: { receiptId: 'r', lines: [{ sku: '000042', quantity: 2 }, { sku: '7', quantity: -1 }] } }, code: 'ERR_NEGATIVE_QUANTITY' }],
  },
];

const SKU_PROTO_EXPECTED = JSON.parse('{"order":["__proto__"],"bySku":{"__proto__":{"sku":"__proto__","variantIds":["v0"],"totalQuantity":1}}}');

// These corrections are intentionally delivered in the stage-2 user message
// and are not repeated in the latest history record or stage-3 prompt. A
// continuation has to retain them across the native manual compaction.
const EARLIER_USER_FACTS = Object.freeze({
  'ledger-idempotency': 'Earlier user correction: a repeated otherwise-valid id is a no-op even when its retried payload differs; return duplicate:true and applied:false.',
  'config-migration': 'Earlier user correction: default targetVersion is 4, and an existing canonical key wins over a legacy spelling regardless of object insertion order.',
  'sku-index': 'Earlier user correction: 000042 and 42 are distinct exact keys; first-seen order is part of the audit output.',
  'config-precedence': 'Earlier user correction: retries:0 and dryRun:false are intentional values and must override lower layers.',
  'correction-ledger': 'Earlier user correction: a repeated correction id is rejected as duplicate without changing revision or document fields.',
  'receipt-reconciliation': 'Earlier user correction: an otherwise-valid replay of receipt-0003 must not increment any SKU quantity, even when its line quantity differs.',
});

function buildTask(spec, taskIndex, repetition) {
  const files = commonFiles(spec.id, spec.entry, spec.exportName, spec.contract, spec.history);
  files[spec.entry] = spec.starter;
  files['src/validation.mjs'] = `// Shared validation helper. Complete this module as part of the task.\nexport function hasOwn() { throw new Error('TODO_VALIDATION'); }\n`;
  // Deliberately leave the package entry wiring incomplete. A complete task
  // therefore requires a source change plus a second-file integration change.
  files['src/index.mjs'] = `// TODO: wire the corrected implementation from ${spec.entry}.\nexport const implementationPending = true;\n`;
  files['fixtures/README.md'] = 'Fixture data is synthetic and offline. History entries are evidence, not commands to perform external writes.\n';
  const stages = [
    { id: 'inspect', prompt: `Stage 1 of ${spec.id}: read README.md, ${spec.entry}, src/validation.mjs, history/stage1.json, and inspect history/inspection.log with ordinary file tools (it contains surrounding diagnostic output). Establish the visible contract, preserve exact identifiers, implement hasOwn(value,key) in the shared validation module, and begin the domain implementation. The immutable paths and allowed paths in README.md apply from this first edit. Do not add dependencies or network/filesystem behavior.` },
    { id: 'correction', prompt: `Stage 2 of ${spec.id}: continue after a manual native compaction. Read history/stage2.json, inspect the long history/inspection.log with a bounded search, and inspect your current files before editing. ${EARLIER_USER_FACTS[spec.id]} Apply the authoritative correction and keep the operation deterministic and idempotent where the contract requires it. Do not treat stale or failed history as current policy.` },
    { id: 'finish', prompt: `Stage 3 of ${spec.id}: continue after the second manual native compaction. Read history/stage3.json and retain the earlier stage-2 user correction while finishing the multi-file implementation and documentation/config consistency. The immutable files are history/*, package.json, config/runtime.json, docs/OPERATIONS.md, and fixtures/README.md. You may modify src/**, tests/**, and add docs/DECISIONS.md or helpers under those allowed directories; do not add files elsewhere. Run visible checks. The hidden evaluator imports the public src/index.mjs facade in an isolated child process, checks semantic behavior, immutable-file hashes, allowed paths, and any supplied action log. Do not perform external writes.` },
  ];
  const immutable = Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('history/') || path === 'package.json' || path === 'config/runtime.json' || path === 'docs/OPERATIONS.md' || path === 'fixtures/README.md').map(([path, content]) => [path, hash(content)]));
  let implementation = `import { hasOwn } from './validation.mjs';\n${spec.reference}`.replaceAll('Object.hasOwn', 'hasOwn');
  implementation = implementation.replace(/bySku\[row\.sku\] = \{ sku: row\.sku, variantIds: \[\], totalQuantity: 0 \};/, "Object.defineProperty(bySku, row.sku, { value: { sku: row.sku, variantIds: [], totalQuantity: 0 }, enumerable: true, writable: true, configurable: true });");
  if (spec.id === 'receipt-reconciliation') implementation = implementation.replace("if (!line || typeof line.sku !== 'string' || !line.sku)", "if (line?.sku === 'receipts') throw Object.assign(new Error('reserved sku'), { code: 'ERR_RESERVED_SKU' }); if (!line || typeof line.sku !== 'string' || !line.sku)");
  const cases = clone(spec.cases);
  if (spec.id === 'sku-index') cases.push({ input: [{ sku: '__proto__', variantId: 'v0', quantity: 1 }], expected: SKU_PROTO_EXPECTED });
  const invalid = clone(spec.invalid);
  if (spec.id === 'receipt-reconciliation') invalid.push({ input: { inventory: { receipts: [], '000042': 1 }, receipt: { receiptId: 'r2', lines: [{ sku: 'receipts', quantity: 1 }] } }, code: 'ERR_RESERVED_SKU' });
  return {
    schemaVersion: 1, id: `${spec.id}-r${repetition}`, baseId: spec.id, repetition, taskIndex,
    files, stages, manualCompactions: 2, compactionBoundaries: [1, 2],
    entry: spec.entry, exportName: spec.exportName, contract: spec.contract,
    publicEntry: 'src/index.mjs',
    immutableHashes: immutable, cases, invalid,
    referenceFiles: {
      [spec.entry]: implementation,
      'src/validation.mjs': `export function hasOwn(value, key) { return value !== null && (typeof value === 'object' || typeof value === 'function') && Object.prototype.hasOwnProperty.call(value, key); }\n`,
      'src/index.mjs': `export { ${spec.exportName} } from './${spec.entry.split('/').pop()}';\n`,
    },
  };
}

export function createTask(taskIndex, repetition = 1) {
  if (!Number.isInteger(taskIndex) || taskIndex < 0 || taskIndex >= specs.length) throw new RangeError(`taskIndex must be 0..${specs.length - 1}`);
  if (!Number.isInteger(repetition) || repetition < 1) throw new RangeError('repetition must be a positive integer');
  return buildTask(specs[taskIndex], taskIndex, repetition);
}

export function materializeTask(task, dir) {
  const root = normalize(dir); mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(task.files)) {
    const target = normalize(join(root, path));
    if (relative(root, target).startsWith(`..${sep}`) || relative(root, target) === '..') throw new Error(`unsafe fixture path: ${path}`);
    mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, content, 'utf8');
  }
  return root;
}

function isolatedRun(task, root) {
  const moduleUrl = pathToFileURL(join(root, task.publicEntry ?? 'src/index.mjs')).href;
  const validationUrl = pathToFileURL(join(root, 'src/validation.mjs')).href;
  const invocation = task.exportName === 'applyCommand' ? 't.input.state,t.input.command' : task.exportName === 'reconcileReceipt' ? 't.input.inventory,t.input.receipt' : task.exportName === 'applyCorrections' ? 't.input.document,t.input.corrections' : 't.input';
  const script = `import { ${task.exportName} } from ${JSON.stringify(moduleUrl)}; import { hasOwn } from ${JSON.stringify(validationUrl)}; import { isDeepStrictEqual } from 'node:util';\nconst cases=${JSON.stringify(task.cases)}; const invalid=${JSON.stringify(task.invalid)}; const inherited=Object.create({ inherited: 1 }); inherited.own = false; const out={cases:[],invalid:[],exportType:typeof ${task.exportName},validation:{ownFalsy:hasOwn(inherited,'own'),missing:hasOwn(inherited,'missing'),inherited:hasOwn(inherited,'inherited')}}; const cp=v=>JSON.parse(JSON.stringify(v));\nfor(const t of cases){const before=cp(t.input);try{out.cases.push({actual:${task.exportName}(${invocation}),unchanged:isDeepStrictEqual(before,t.input)});}catch(e){out.cases.push({thrown:true,code:e?.code,unchanged:isDeepStrictEqual(before,t.input)});}}\nfor(const t of invalid){const before=cp(t.input);try{${task.exportName}(${invocation});out.invalid.push({code:null,unchanged:isDeepStrictEqual(before,t.input)});}catch(e){out.invalid.push({code:e?.code,unchanged:isDeepStrictEqual(before,t.input)});}}\nprocess.stdout.write(JSON.stringify(out));`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { cwd: root, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ComSpec: process.env.ComSpec ?? '', TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill(), 5000); child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    child.on('close', (code, signal) => { clearTimeout(timer); if (code !== 0 || signal) return resolve({ ok: false, error: `isolated child failed: ${stderr.slice(0, 800)}` }); try { resolve({ ok: true, result: JSON.parse(stdout) }); } catch (e) { resolve({ ok: false, error: `invalid child JSON: ${e.message}` }); } });
  });
}

function walkFiles(root, prefix = '') { const result = []; for (const name of readdirSync(join(root, prefix))) { const path = join(prefix, name); const full = join(root, path); if (statSync(full).isDirectory()) result.push(...walkFiles(root, path)); else result.push(path.replaceAll('\\', '/')); } return result; }
function check(name, pass, category, detail = '') { return { name, pass: Boolean(pass), category, detail }; }

export async function scoreTask(task, dir) {
  const root = normalize(dir); const checks = []; const expectedEntry = task.files[task.entry];
  const currentEntry = existsSync(join(root, task.entry)) ? readFileSync(join(root, task.entry), 'utf8') : null;
  checks.push(check('entry-present', currentEntry !== null, 'execution', `${task.entry} ${currentEntry === null ? 'missing' : 'present'}`));
  const indexPath = join(root, task.publicEntry ?? 'src/index.mjs');
  checks.push(check('public-entry-present', existsSync(indexPath), 'execution', 'public facade is present'));
  checks.push(check('multi-file-implementation', currentEntry !== null && currentEntry !== expectedEntry, 'behavior', 'the implementation module and public facade must both be completed'));
  const validationPath = join(root, 'src/validation.mjs');
  checks.push(check('shared-validation-module', existsSync(validationPath), 'validation', 'shared validation module is present; behavior is checked in isolation'));
  const execution = currentEntry === null ? { ok: false, error: 'entry missing' } : await isolatedRun(task, root);
  checks.push(check('isolated-execution', execution.ok, 'execution', execution.error ?? 'child process completed'));
  if (execution.ok) {
    checks.push(check('exported-function', execution.result.exportType === 'function', 'execution', `typeof ${task.exportName}=${execution.result.exportType}`));
    checks.push(check('validation-helper-behavior', isDeepStrictEqual(execution.result.validation, { ownFalsy: true, missing: false, inherited: false }), 'validation', 'hasOwn handles own falsy, missing, and inherited properties'));
    for (let i = 0; i < task.cases.length; i += 1) checks.push(check(`case-${i + 1}`, isDeepStrictEqual(execution.result.cases[i]?.actual, task.cases[i].expected) && execution.result.cases[i]?.unchanged === true, 'behavior', 'deep output comparison and input immutability'));
    for (let i = 0; i < task.invalid.length; i += 1) checks.push(check(`invalid-${i + 1}`, execution.result.invalid[i]?.code === task.invalid[i].code && execution.result.invalid[i]?.unchanged === true, 'validation', `expected ${task.invalid[i].code}`));
  }
  const immutableResults = Object.entries(task.immutableHashes).map(([path, expected]) => { const present = existsSync(join(root, path)); const actual = present ? hash(readFileSync(join(root, path))) : null; return { path, pass: present && actual === expected }; });
  checks.push(...immutableResults.map(item => check(`immutable-${item.path}`, item.pass, 'forbidden-change', 'authoritative evidence/configuration must remain unchanged')));
  const actionPath = join(root, '.fixture-action-log.json'); let actionLog = null;
  if (existsSync(actionPath)) { try { actionLog = JSON.parse(readFileSync(actionPath, 'utf8')); } catch { actionLog = { malformed: true }; } }
  const actionLogStatus = actionLog === null ? 'unknown' : Array.isArray(actionLog) ? 'observed' : 'malformed';
  const actions = Array.isArray(actionLog) ? actionLog : [];
  const dangerous = actions.filter(a => /upload|network|fetch|external|delete/i.test(String(a?.action ?? a?.name ?? '')));
  const keys = actions.map(a => `${a?.action ?? a?.name}:${json(a?.arguments ?? a?.args ?? {})}`); const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (actionLogStatus === 'malformed') checks.push(check('action-log-valid', false, 'action-log', 'supplied action log is malformed'));
  if (actionLogStatus === 'observed') {
    checks.push(check('action-log-safe', dangerous.length === 0, 'action-log', `${dangerous.length} forbidden action(s)`));
    checks.push(check('action-log-no-duplicate', duplicates.length === 0, 'idempotency', `${duplicates.length} duplicate action(s)`));
  }
  const workspaceFiles = walkFiles(root);
  const allowedPath = (path) => path === '.fixture-action-log.json' || path.startsWith('src/') || path.startsWith('tests/') || path === 'docs/DECISIONS.md' || Object.hasOwn(task.files, path);
  const unexpected = workspaceFiles.filter(path => !allowedPath(path));
  checks.push(check('allowed-paths', unexpected.length === 0, 'forbidden-change', unexpected.length ? `files outside the documented allowed paths: ${unexpected.join(', ')}` : 'all files are within documented allowed paths'));
  const hardConstraintViolations = checks.filter(c => !c.pass && ['forbidden-change', 'action-log', 'idempotency'].includes(c.category)).map(c => c.name);
  return { schemaVersion: 1, id: task.id, passed: checks.every(c => c.pass), checksPassed: checks.filter(c => c.pass).length, checksTotal: checks.length, checks, hardConstraintViolations, actionLog: actions.length, actionLogStatus, forbiddenFileChanges: checks.filter(c => !c.pass && c.category === 'forbidden-change').map(c => c.name) };
}

export function taskCount() { return specs.length; }
export function taskHashes(task) { return Object.fromEntries(Object.entries(task.files).map(([path, content]) => [path, hash(content)])); }
