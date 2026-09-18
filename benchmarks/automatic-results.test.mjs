import assert from 'node:assert/strict';
import { aggregateAutomaticResults, DEFAULT_THRESHOLDS } from './automatic-results.mjs';

function report(taskIndex, repetition, mode, { passed = false, integrationValid = true, latencyMs = 100, hard = [], status = 'completed', selectionModes = null, requests = 0 } = {}) {
  return {
    taskIndex, repetition, mode, status, integrationValid, latencyMs,
    quality: { passed, category: passed ? 'passed' : 'constraint-failure', hardConstraintViolations: hard },
    selection: selectionModes?.map((selectionMode) => ({ mode: selectionMode, requests, usage: { input: 10, output: 2 } })),
    toolCounts: { commandExecution: 2, fileChange: 1 },
    hookEvents: { counts: { commandExecution: 2, fileChange: 1, contextCompaction: 2, hookEvents: mode === 'stockCodex' ? 0 : 4, acceptedContexts: mode === 'stockCodex' ? 0 : 2 } },
    commandTelemetry: { completed: 3, failed: 1, duplicateCompleted: 1 },
    nativeUsage: { inputTokens: 100, outputTokens: 20 },
  };
}

const reports = [];
for (let task = 0; task < 6; task += 1) {
  for (let repetition = 0; repetition < 2; repetition += 1) {
    // Stock succeeds on tasks 0 and 1; local gains tasks 2 and 3, and Jev gains
    // tasks 2 and 4.  The remaining cells make ties/losses observable.
    const stockPassed = task < 2;
    const localPassed = task < 4;
    const jevPassed = task === 0 || task === 1 || task === 2 || task === 4;
    reports.push(report(task, repetition, 'stockCodex', { passed: stockPassed, latencyMs: 100 }));
    reports.push(report(task, repetition, 'pluginLocal', { passed: localPassed, latencyMs: 110, selectionModes: ['local', 'local'] }));
    reports.push(report(task, repetition, 'pluginJev', { passed: jevPassed, latencyMs: 115, selectionModes: ['jev', 'jev'], requests: 1 }));
  }
}

const aggregate = aggregateAutomaticResults({ reports, manifest: { thresholds: DEFAULT_THRESHOLDS } });
assert.equal(Object.keys(aggregate.taskUnits).length, 6);
assert.equal(Object.keys(aggregate.taskUnits['0'].repetitions).length, 2);
assert.equal(aggregate.arms.pluginLocal.taskSuccess.passed, 8);
assert.equal(aggregate.arms.pluginLocal.rawQualityPassed.passed, 8);
assert.equal(aggregate.arms.pluginLocal.nativeCounters.commandExecution, 24);
assert.equal(aggregate.arms.pluginJev.jev.requests, 24);
assert.equal(aggregate.comparisons.localVsStock.decision, 'pass');
assert.equal(aggregate.comparisons.jevVsStock.decision, 'pass');
assert.equal(aggregate.comparisons.jevVsLocal.decision, 'no-demonstrated-downstream-benefit');
assert.equal(aggregate.comparisons.jevVsStock.latencyMs.ratio, 1.15);

// A Jev fallback is a technical result, even when its evaluator score passed.
const fallback = aggregateAutomaticResults({ reports: [
  report(0, 1, 'stockCodex', { passed: true }),
  report(0, 1, 'pluginJev', { passed: true, selectionModes: ['local'], requests: 0 }),
] });
assert.equal(fallback.arms.pluginJev.taskSuccess.passed, 0);
assert.equal(fallback.arms.pluginJev.rawQualityPassed.passed, 1);
assert.equal(fallback.comparisons.jevVsStock.decision, 'inconclusive-technical');

// Invalid integration anywhere makes the paired decision inconclusive.
const invalid = aggregateAutomaticResults({ reports: [
  report(0, 1, 'stockCodex', { passed: true }),
  report(0, 1, 'pluginLocal', { passed: true, integrationValid: false, selectionModes: ['local'] }),
] });
assert.equal(invalid.comparisons.localVsStock.technicalCells, 1);
assert.equal(invalid.comparisons.localVsStock.decision, 'inconclusive-technical');

// A latency cutoff rejects an otherwise winning Jev comparison.
const slow = aggregateAutomaticResults({ reports: [
  ...reports.map((item) => item.mode === 'pluginJev' ? { ...item, latencyMs: 121 } : item),
] });
assert.equal(slow.comparisons.jevVsStock.latencyMs.pass, false);
assert.equal(slow.comparisons.jevVsStock.decision, 'no-demonstrated-downstream-benefit');

// Hard-constraint regression and repeated loss remain visible in the paired cell.
const regression = aggregateAutomaticResults({ reports: [
  report(0, 0, 'stockCodex', { passed: true, hard: ['old-constraint'] }), report(0, 1, 'stockCodex', { passed: true }),
  report(0, 0, 'pluginLocal', { passed: false, hard: ['new-constraint'] }), report(0, 1, 'pluginLocal', { passed: false, hard: ['no-network'] }),
] });
assert.deepEqual(regression.comparisons.localVsStock.repeatedLossTasks, [0]);
assert.equal(regression.comparisons.localVsStock.hardConstraintRegressionCells.length, 2);
assert.equal(regression.comparisons.localVsStock.decision, 'inconclusive-technical');

const missing = aggregateAutomaticResults({ reports: reports.slice(1) });
assert.equal(missing.completeness.complete, false);
assert.equal(missing.completeness.missing.length, 1);
assert.equal(missing.decisions.jevVsLocal, 'inconclusive-technical');
const duplicated = aggregateAutomaticResults({ reports: [...reports.slice(1), reports[1]] });
assert.equal(duplicated.completeness.duplicates.length, 1);
assert.equal(duplicated.decisions.localVsStock, 'inconclusive-technical');
const inconsistentStatus = aggregateAutomaticResults({ reports: reports.map((item, i) => i === 2 ? { ...item, status: 'failed' } : item) });
assert.equal(inconsistentStatus.arms.pluginJev.integrationValid, 11);
assert.equal(inconsistentStatus.decisions.jevVsStock, 'inconclusive-technical');
const exactCutoffs = aggregateAutomaticResults({ reports: reports.map(item => ({ ...item, latencyMs: 100, quality: { passed: item.mode === 'pluginLocal' ? item.taskIndex === 0 || (item.taskIndex === 1 && item.repetition === 0) : item.mode === 'pluginJev' ? item.taskIndex < 2 && item.repetition === 0 : false, hardConstraintViolations: [] } })) });
assert.equal(exactCutoffs.comparisons.localVsStock.netWins, 3);
assert.equal(exactCutoffs.decisions.localVsStock, 'pass');
assert.equal(exactCutoffs.comparisons.jevVsStock.netWins, 2);
assert.equal(exactCutoffs.decisions.jevVsStock, 'pass');

console.log('automatic results self-test passed');
