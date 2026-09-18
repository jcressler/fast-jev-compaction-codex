import assert from 'node:assert/strict';
import { combineAutomaticRuns } from './automatic-amended-results.mjs';

const modes = ['stockCodex', 'pluginLocal', 'pluginJev'];
const thresholds = {
  localVsStock: { netWins: 3, distinctTasks: 2 },
  jevVsStock: { netWins: 2, distinctTasks: 2, medianLatencyRatio: 1.2 },
  jevVsLocal: { netWins: 2, distinctTasks: 2 },
  repeatedLossAllowed: false,
  hardConstraintRegressionAllowed: false,
};
const protocol = { model: 'gpt-5.6-luna', effort: 'medium', stages: 3, maxCompactions: 2, maxTurnsPerStage: 8, maxToolCalls: 120, maxWallTimeMs: 900000, maxJevRequestsPerBoundary: 1, maxContextChars: 6000 };

function manifest() {
  return {
    thresholds, baseInstructions: 'same', dynamicTools: [], sandbox: 'workspace-write', approvalPolicy: 'never',
    protocol, protocolHash: 'protocol', clientHash: 'client', distHash: 'dist', bundledHookConfigHash: 'hooks', bundledSmokeHash: 'smoke', profileConfigHashes: { stockCodex: 'stock', pluginLocal: 'local', pluginJev: 'jev' }, configHash: 'config', codex: { pathHash: 'path', binaryHash: 'binary', version: 'codex' }, installedHashes: { stockCodex: null, pluginLocal: 'dist', pluginJev: 'dist' }, evaluatorHash: 'original-evaluator', sourceHashes: { src: 'original-source' },
    tasks: Array.from({ length: 6 }, (_, taskIndex) => Array.from({ length: 2 }, (_, repetition) => ({ taskIndex, repetition, id: `task-${taskIndex}`, hash: `hash-${taskIndex}` }))).flat(),
  };
}

function report(taskIndex, repetition, mode, passed) {
  return { taskIndex, repetition, mode, status: 'completed', integrationValid: true, quality: { passed, hardConstraintViolations: [] }, latencyMs: 100, selection: mode === 'pluginJev' ? [{ mode: 'jev', requests: 1 }] : mode === 'pluginLocal' ? [{ mode: 'local', requests: 0 }] : [] };
}

function fullReports(skuPassed = true) {
  const reports = [];
  for (let taskIndex = 0; taskIndex < 6; taskIndex += 1) for (let repetition = 0; repetition < 2; repetition += 1) for (const mode of modes) reports.push(report(taskIndex, repetition, mode, taskIndex !== 2 || skuPassed));
  return reports;
}

function skuReports(passed) {
  return Array.from({ length: 2 }, (_, repetition) => modes.map((mode) => report(2, repetition, mode, passed))).flat();
}

const originalManifest = manifest();
const skuManifest = { ...manifest(), evaluatorHash: 'sku-evaluator', tasks: originalManifest.tasks.filter((task) => task.taskIndex === 2).map((task) => ({ ...task, hash: `${task.hash}-corrected` })) };
const originalReport = { reports: fullReports(true) };
const skuReport = { reports: skuReports(false) };
const originalSnapshot = structuredClone(originalReport);
const merged = combineAutomaticRuns(originalReport, skuReport, originalManifest, skuManifest);
assert.equal(merged.corrected.runCount, 36);
assert.equal(merged.corrected.independentReplicateCount, 0);
assert.equal(merged.corrected.provenance.filter((cell) => cell.source === 'sku-replacement').length, 6);
assert.equal(merged.corrected.provenance.filter((cell) => cell.source === 'original-unaffected').length, 30);
assert.equal(merged.corrected.provenance.find((cell) => cell.taskIndex === 2 && cell.repetition === 0).originalTaskHash, 'hash-2');
assert.equal(merged.corrected.provenance.find((cell) => cell.taskIndex === 2 && cell.repetition === 0).replacementTaskHash, 'hash-2-corrected');
assert.equal(merged.corrected.aggregate.arms.stockCodex.taskSuccess.passed, 10);
assert.equal(merged.original.contractValidity, 'invalid');
assert.equal(merged.original.decision, 'no-go-contract');
assert.equal(merged.original.aggregate.contractValidity, 'invalid');
assert.equal(merged.original.aggregate.decisions.localVsStock, 'no-go-contract');
assert.deepEqual(originalReport, originalSnapshot);

// No score-based substitution: a failed replacement remains the corrected cell.
const replacedStock = merged.corrected.reports.find((item) => item.taskIndex === 2 && item.repetition === 0 && item.mode === 'stockCodex');
assert.equal(replacedStock.quality.passed, false);

assert.throws(() => combineAutomaticRuns(originalReport, { reports: [...skuReport.reports, skuReport.reports[0]] }, originalManifest, skuManifest), /SKU report slots invalid/);
assert.throws(() => combineAutomaticRuns({ reports: originalReport.reports.slice(1) }, skuReport, originalManifest, skuManifest), /original report slots invalid/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, protocol: { ...protocol, effort: 'high' } }), /effort/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, tasks: skuManifest.tasks.map((task) => task.taskIndex === 2 && task.repetition === 1 ? { ...task, id: 'changed' } : task) }), /SKU task identity/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, tasks: skuManifest.tasks.map((task) => ({ ...task, hash: 'hash-2' })) }), /SKU task hash did not change/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, protocolHash: 'changed' }), /protocolHash/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, thresholds: undefined }), /Missing frozen thresholds/);
assert.throws(() => combineAutomaticRuns(originalReport, skuReport, originalManifest, { ...skuManifest, evaluatorHash: undefined }), /Both evaluator hashes/);

console.log('automatic amended results self-test passed');
