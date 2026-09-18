#!/usr/bin/env node
/**
 * Outcome-blind merger for the SKU contract amendment.
 *
 * The original experiment remains a separately labelled no-go record.  This
 * helper replaces exactly the six SKU cells with the six fresh SKU cells and
 * then delegates scoring to automatic-results.mjs.  It never selects cells by
 * quality, latency, or integration outcome.
 */
import { aggregateAutomaticResults } from './automatic-results.mjs';

const MODES = ['stockCodex', 'pluginLocal', 'pluginJev'];
const SKU_TASK_INDEX = 2;
const TASK_COUNT = 6;
const REPETITIONS = 2;

function clone(value) {
  return structuredClone(value);
}

function reportList(value, label) {
  const reports = Array.isArray(value) ? value : value?.reports;
  if (!Array.isArray(reports)) throw new Error(`${label} must contain a reports array`);
  return reports;
}

function key(taskIndex, repetition, mode) {
  return `${taskIndex}:${repetition}:${mode}`;
}

function expectedKeys(taskIndices) {
  return new Set(taskIndices.flatMap((taskIndex) => Array.from({ length: REPETITIONS }, (_, repetition) => MODES.map((mode) => key(taskIndex, repetition, mode))).flat()));
}

function validateSlots(reports, label, taskIndices) {
  const expected = expectedKeys(taskIndices);
  const seen = new Set();
  const duplicates = [];
  const extra = [];
  for (const report of reports) {
    const reportKey = key(report?.taskIndex, report?.repetition, report?.mode);
    if (!expected.has(reportKey)) extra.push(reportKey);
    else if (seen.has(reportKey)) duplicates.push(reportKey);
    else seen.add(reportKey);
  }
  const missing = [...expected].filter((item) => !seen.has(item)).sort();
  if (reports.length !== expected.size || missing.length || duplicates.length || extra.length) {
    throw new Error(`${label} slots invalid: expected ${expected.size}, received ${reports.length}; missing=${missing.join(',')}; duplicates=${duplicates.join(',')}; extra=${extra.join(',')}`);
  }
  return new Map(reports.map((report) => [key(report.taskIndex, report.repetition, report.mode), report]));
}

function stableJson(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => stableValue(item)));
  if (value && typeof value === 'object') return JSON.stringify(stableValue(value));
  return JSON.stringify(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((name) => [name, stableValue(value[name])]));
  return value;
}

function requireSame(original, amended, path) {
  if (original === undefined || amended === undefined) throw new Error(`Missing frozen ${path}`);
  if (stableJson(original) !== stableJson(amended)) throw new Error(`Amendment changed frozen ${path}`);
}

function manifestProtocol(manifest, label) {
  if (!manifest || typeof manifest !== 'object') throw new Error(`${label} manifest is required`);
  return manifest;
}

function validateSharedManifest(originalManifest, skuManifest) {
  const original = manifestProtocol(originalManifest, 'original');
  const amended = manifestProtocol(skuManifest, 'SKU');
  requireSame(original.thresholds, amended.thresholds, 'thresholds');
  requireSame(original.baseInstructions, amended.baseInstructions, 'base instructions');
  requireSame(original.dynamicTools, amended.dynamicTools, 'dynamic tools');
  requireSame(original.sandbox, amended.sandbox, 'sandbox');
  requireSame(original.approvalPolicy, amended.approvalPolicy, 'approval policy');
  const originalProtocol = original.protocol ?? {};
  const amendedProtocol = amended.protocol ?? {};
  requireSame(originalProtocol.model, amendedProtocol.model, 'model');
  requireSame(originalProtocol.effort, amendedProtocol.effort, 'effort');
  for (const field of ['stages', 'maxCompactions', 'maxTurnsPerStage', 'maxToolCalls', 'maxWallTimeMs', 'maxJevRequestsPerBoundary', 'maxContextChars']) {
    requireSame(originalProtocol[field], amendedProtocol[field], `budget ${field}`);
  }
  requireSame(original.protocol, amended.protocol, 'protocol');
  for (const field of ['pathHash', 'binaryHash', 'version']) requireSame(original.codex?.[field], amended.codex?.[field], `Codex ${field}`);
  requireSame(original.installedHashes, amended.installedHashes, 'installed plugin hashes');
  for (const field of ['protocolHash', 'clientHash', 'distHash', 'bundledHookConfigHash', 'bundledSmokeHash', 'profileConfigHashes', 'configHash', 'configHashes', 'configurationHash', 'sourceHashes']) {
    if (original[field] !== undefined || amended[field] !== undefined) requireSame(original[field], amended[field], field);
  }
  if (typeof original.evaluatorHash !== 'string' || !original.evaluatorHash || typeof amended.evaluatorHash !== 'string' || !amended.evaluatorHash) throw new Error('Both evaluator hashes are required');
  if (original.evaluatorHash === amended.evaluatorHash) throw new Error('SKU evaluator hash must differ after the wording correction');
  return { original, amended };
}

function taskEntries(manifest, label) {
  if (!Array.isArray(manifest.tasks)) throw new Error(`${label} manifest tasks are required`);
  return manifest.tasks;
}

function taskIdentity(entries, taskIndex, repetition) {
  return entries.find((task) => task?.taskIndex === taskIndex && task?.repetition === repetition) ?? null;
}

function validateTaskIdentity(originalManifest, skuManifest) {
  const originalTasks = taskEntries(originalManifest, 'original');
  const skuTasks = taskEntries(skuManifest, 'SKU');
  if ([...originalTasks, ...skuTasks].some(task => typeof task.id !== 'string' || !task.id || typeof task.hash !== 'string' || !task.hash)) throw new Error('Task IDs and hashes are required');
  if (originalTasks.length !== TASK_COUNT * REPETITIONS) throw new Error('Original manifest must contain exactly twelve task identities');
  if (skuTasks.length !== REPETITIONS) throw new Error('SKU manifest must contain exactly two task identities');
  const originalExpected = new Set(Array.from({ length: TASK_COUNT }, (_, taskIndex) => Array.from({ length: REPETITIONS }, (_, repetition) => `${taskIndex}:${repetition}`)).flat());
  const originalActual = new Set(originalTasks.map((task) => `${task?.taskIndex}:${task?.repetition}`));
  if (originalActual.size !== originalExpected.size || [...originalExpected].some((identity) => !originalActual.has(identity))) throw new Error('Original manifest task identities are missing or duplicated');
  if (skuTasks.some((task) => task?.taskIndex !== SKU_TASK_INDEX)) throw new Error('SKU manifest contains a non-SKU task identity');
  const originalSku = originalTasks.filter((task) => task?.taskIndex === SKU_TASK_INDEX);
  const replacementSku = skuTasks.filter((task) => task?.taskIndex === SKU_TASK_INDEX);
  if (originalSku.length !== REPETITIONS || replacementSku.length !== REPETITIONS) throw new Error('SKU manifest must contain exactly two repetitions');
  for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
    const before = taskIdentity(originalTasks, SKU_TASK_INDEX, repetition);
    const after = taskIdentity(skuTasks, SKU_TASK_INDEX, repetition);
    if (!before || !after || before.id !== after.id) throw new Error(`SKU task identity changed at repetition ${repetition}`);
    if (before.hash === after.hash) throw new Error(`SKU task hash did not change at repetition ${repetition}`);
  }
  const unaffected = originalTasks.filter((task) => task?.taskIndex !== SKU_TASK_INDEX);
  return { replaced: originalSku.map((task) => { const replacement = taskIdentity(skuTasks, task.taskIndex, task.repetition); return { taskIndex: task.taskIndex, repetition: task.repetition, id: task.id, hashBefore: task.hash, hashAfter: replacement.hash }; }), unaffected: unaffected.map((task) => ({ taskIndex: task.taskIndex, repetition: task.repetition, id: task.id, hash: task.hash })) };
}

/**
 * Merge a frozen original report with the later six-cell SKU replacement.
 * Every original non-SKU cell is retained, and every SKU cell comes from the
 * replacement report, regardless of quality or technical outcome.
 */
export function combineAutomaticRuns(originalReport, skuReport, originalManifest, skuManifest) {
  const originalReports = reportList(originalReport, 'original report');
  const skuReports = reportList(skuReport, 'SKU report');
  validateSharedManifest(originalManifest, skuManifest);
  const identities = validateTaskIdentity(originalManifest, skuManifest);
  const originalByKey = validateSlots(originalReports, 'original report', [0, 1, 2, 3, 4, 5]);
  const skuByKey = validateSlots(skuReports, 'SKU report', [SKU_TASK_INDEX]);
  const correctedReports = [];
  const provenance = [];
  for (let taskIndex = 0; taskIndex < TASK_COUNT; taskIndex += 1) {
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
      for (const mode of MODES) {
        const reportKey = key(taskIndex, repetition, mode);
        const source = taskIndex === SKU_TASK_INDEX ? skuByKey.get(reportKey) : originalByKey.get(reportKey);
        correctedReports.push(clone(source));
        const originalTask = taskIdentity(taskEntries(originalManifest, 'original'), taskIndex, repetition);
        const replacementTask = taskIndex === SKU_TASK_INDEX ? taskIdentity(taskEntries(skuManifest, 'SKU'), taskIndex, repetition) : null;
        provenance.push({ taskIndex, repetition, mode, source: taskIndex === SKU_TASK_INDEX ? 'sku-replacement' : 'original-unaffected', taskId: originalTask.id, originalTaskHash: originalTask.hash, replacementTaskHash: replacementTask?.hash ?? originalTask.hash });
      }
    }
  }
  const correctedAggregate = aggregateAutomaticResults({ reports: correctedReports, manifest: { thresholds: originalManifest.thresholds } });
  const originalAggregate = aggregateAutomaticResults({ reports: clone(originalReports), manifest: { thresholds: originalManifest.thresholds } });
  originalAggregate.contractValidity = 'invalid';
  originalAggregate.noGoReason = 'ambiguous SKU quantity contract';
  originalAggregate.decision = 'no-go-contract';
  for (const comparison of Object.values(originalAggregate.comparisons)) comparison.decision = 'no-go-contract';
  for (const name of Object.keys(originalAggregate.decisions)) originalAggregate.decisions[name] = 'no-go-contract';
  return {
    schemaVersion: 1,
    original: { contractValidity: 'invalid', decision: 'no-go-contract', noGoReason: 'ambiguous SKU quantity contract', aggregate: originalAggregate },
    corrected: { reports: correctedReports, aggregate: correctedAggregate, provenance, runCount: correctedReports.length, independentReplicateCount: 0 },
    replacement: { taskIndex: SKU_TASK_INDEX, cells: 6, identities },
  };
}
