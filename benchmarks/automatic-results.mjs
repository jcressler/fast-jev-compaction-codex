#!/usr/bin/env node
/**
 * Privacy-preserving aggregator for the frozen automatic-hook evaluation.
 *
 * This module consumes completed arm reports and the thresholds frozen in the
 * manifest.  It does not read transcripts, workspaces, archives, or provider
 * output.  A report with invalid native integration is a technical result and
 * cannot become a Jev success through its evaluator score.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_THRESHOLDS = Object.freeze({
  localVsStock: { netWins: 3, distinctTasks: 2 },
  jevVsStock: { netWins: 2, distinctTasks: 2, medianLatencyRatio: 1.2 },
  jevVsLocal: { netWins: 2, distinctTasks: 2 },
  repeatedLossAllowed: false,
  hardConstraintRegressionAllowed: false,
});

const ARM_NAMES = ['stockCodex', 'pluginLocal', 'pluginJev'];
const COMPARISONS = [
  ['localVsStock', 'pluginLocal', 'stockCodex'],
  ['jevVsStock', 'pluginJev', 'stockCodex'],
  ['jevVsLocal', 'pluginJev', 'pluginLocal'],
];

function finiteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function integerCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function median(values) {
  const measured = values.filter((value) => finiteNonnegative(value) !== null).sort((a, b) => a - b);
  if (!measured.length) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[middle] : (measured[middle - 1] + measured[middle]) / 2;
}

function addNumericLeaves(target, value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) target[name] = (target[name] ?? 0) + item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) addNumericLeaves(target, item, name);
  }
}

function hardViolations(report) {
  const values = report?.quality?.hardConstraintViolations;
  if (!Array.isArray(values)) return 0;
  return values.length;
}

function hardViolationNames(report) {
  const values = report?.quality?.hardConstraintViolations;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => {
    if (typeof value === 'string') return value.slice(0, 160);
    if (value && typeof value === 'object') return String(value.name ?? value.code ?? value.id ?? '').slice(0, 160);
    return '';
  }).filter(Boolean))].sort();
}

function fallbackInvalid(report, mode) {
  if (mode !== 'pluginJev' || !Array.isArray(report?.selection)) return false;
  return report.selection.some((selection) => selection?.mode !== 'jev');
}

/** Returns true only when the native host integration was accepted for scoring. */
export function scoringIntegrationValid(report, mode = report?.mode) {
  return report?.status === 'completed' && report?.integrationValid === true && !fallbackInvalid(report, mode);
}

function taskSuccess(report, mode) {
  return scoringIntegrationValid(report, mode) && report?.quality?.passed === true;
}

function rawQualityPassed(report) {
  return report?.quality?.passed === true;
}

function qualityCategory(report) {
  return typeof report?.quality?.category === 'string' ? report.quality.category : null;
}

function reportKey(report) {
  return `${report?.taskIndex}:${report?.repetition}`;
}

function selectionUsage(report) {
  const usage = {};
  let requests = 0;
  for (const selection of Array.isArray(report?.selection) ? report.selection : []) {
    if (Number.isSafeInteger(selection?.requests) && selection.requests >= 0) requests += selection.requests;
    addNumericLeaves(usage, selection?.usage);
  }
  return { requests, usage };
}

function nativeCounters(report) {
  const counts = report?.hookEvents?.counts ?? {};
  const telemetry = report?.commandTelemetry ?? {};
  const tools = report?.toolCounts ?? {};
  return {
    commandExecution: integerCount(counts.commandExecution ?? tools.commandExecution),
    fileChange: integerCount(counts.fileChange ?? tools.fileChange),
    contextCompaction: integerCount(counts.contextCompaction),
    hookEvents: integerCount(counts.hookEvents),
    acceptedContexts: integerCount(counts.acceptedContexts),
    commandCompleted: integerCount(telemetry.completed),
    commandFailed: integerCount(telemetry.failed),
    duplicateCompleted: integerCount(telemetry.duplicateCompleted),
  };
}

function addCounters(target, counters) {
  for (const [key, value] of Object.entries(counters)) target[key] = (target[key] ?? 0) + integerCount(value);
}

function armSummary(mode, reports) {
  const rows = reports.filter((report) => report?.mode === mode);
  const successes = rows.map((report) => taskSuccess(report, mode));
  const raw = rows.map(rawQualityPassed);
  const valid = rows.filter((report) => scoringIntegrationValid(report, mode));
  const technical = rows.filter((report) => !scoringIntegrationValid(report, mode) || report?.status !== 'completed');
  const counters = {};
  const nativeUsage = {};
  let jevRequests = 0;
  const jevUsage = {};
  for (const report of rows) {
    addCounters(counters, nativeCounters(report));
    addNumericLeaves(nativeUsage, report?.nativeUsage);
    const selection = selectionUsage(report);
    jevRequests += selection.requests;
    for (const [key, value] of Object.entries(selection.usage)) jevUsage[key] = (jevUsage[key] ?? 0) + value;
  }
  return {
    mode,
    runs: rows.length,
    completed: rows.filter((report) => report?.status === 'completed').length,
    integrationValid: valid.length,
    technicalFailures: technical.length,
    taskSuccess: { passed: successes.filter(Boolean).length, total: rows.length, rate: rows.length ? successes.filter(Boolean).length / rows.length : null },
    rawQualityPassed: { passed: raw.filter(Boolean).length, total: rows.length, rate: rows.length ? raw.filter(Boolean).length / rows.length : null },
    hardConstraintViolations: rows.reduce((sum, report) => sum + hardViolations(report), 0),
    hardConstraintViolationNames: [...new Set(rows.flatMap(hardViolationNames))].sort(),
    latencyMs: { median: median(rows.map((report) => report?.latencyMs)), measured: rows.filter((report) => finiteNonnegative(report?.latencyMs) !== null).length, total: rows.length },
    nativeCounters: counters,
    nativeUsage,
    nativeUsageCumulative: { counters: nativeUsage, billing: false, note: 'Summed native counters across arm runs; not a bill.' },
    jev: { requests: jevRequests, usage: jevUsage, usageCumulative: { counters: jevUsage, billing: false, note: 'Summed provider usage across arm runs; not a bill.' } },
    byTask: taskMatrix(rows, mode),
    categories: rows.reduce((result, report) => {
      const category = qualityCategory(report);
      if (category) result[category] = (result[category] ?? 0) + 1;
      return result;
    }, {}),
  };
}

function taskMatrix(rows, mode) {
  const matrix = {};
  for (const report of rows) {
    const task = String(report?.taskIndex);
    const repetition = String(report?.repetition);
    matrix[task] ??= {};
    matrix[task][repetition] = {
      taskSuccess: taskSuccess(report, mode),
      rawQualityPassed: rawQualityPassed(report),
      integrationValid: scoringIntegrationValid(report, mode),
      status: report?.status ?? null,
      hardConstraintViolations: hardViolations(report),
      hardConstraintViolationNames: hardViolationNames(report),
      latencyMs: finiteNonnegative(report?.latencyMs),
    };
  }
  return matrix;
}

function thresholdFor(thresholds, name) {
  const candidate = thresholds?.[name] ?? DEFAULT_THRESHOLDS[name];
  return { ...DEFAULT_THRESHOLDS[name], ...(candidate && typeof candidate === 'object' ? candidate : {}) };
}

function comparison(name, candidate, baseline, reports, thresholds) {
  const keys = [...new Set(reports.filter((report) => report?.mode === candidate || report?.mode === baseline).map(reportKey))].sort();
  const cells = [];
  for (const key of keys) {
    const left = reports.find((report) => reportKey(report) === key && report?.mode === candidate);
    const right = reports.find((report) => reportKey(report) === key && report?.mode === baseline);
    const leftValid = scoringIntegrationValid(left, candidate);
    const rightValid = scoringIntegrationValid(right, baseline);
    const technical = !left || !right || !leftValid || !rightValid;
    const leftSuccess = taskSuccess(left, candidate);
    const rightSuccess = taskSuccess(right, baseline);
    cells.push({ taskIndex: left?.taskIndex ?? right?.taskIndex ?? null, repetition: left?.repetition ?? right?.repetition ?? null, candidateSuccess: leftSuccess, baselineSuccess: rightSuccess, candidateHardConstraints: hardViolations(left), baselineHardConstraints: hardViolations(right), candidateHardConstraintNames: hardViolationNames(left), baselineHardConstraintNames: hardViolationNames(right), candidateIntegrationValid: leftValid, baselineIntegrationValid: rightValid, technical, outcome: technical ? 'technical' : leftSuccess === rightSuccess ? 'tie' : leftSuccess ? 'win' : 'loss' });
  }
  const validCells = cells.filter((cell) => !cell.technical);
  const wins = validCells.filter((cell) => cell.outcome === 'win').length;
  const losses = validCells.filter((cell) => cell.outcome === 'loss').length;
  const taskGains = new Set(validCells.filter((cell) => cell.outcome === 'win').map((cell) => cell.taskIndex));
  const repeatedLossTasks = [];
  for (const taskIndex of [...new Set(validCells.map((cell) => cell.taskIndex))].sort((a, b) => a - b)) {
    const taskCells = validCells.filter((cell) => cell.taskIndex === taskIndex);
    if (taskCells.length >= 2 && taskCells.every((cell) => cell.candidateSuccess === false && cell.baselineSuccess === true)) repeatedLossTasks.push(taskIndex);
  }
  const hardConstraintRegressionCells = validCells.filter((cell) => {
    const baselineNames = new Set(cell.baselineHardConstraintNames);
    const newNames = cell.candidateHardConstraintNames.filter((name) => !baselineNames.has(name));
    return newNames.length > 0 || (cell.candidateHardConstraintNames.length === 0 && cell.candidateHardConstraints > cell.baselineHardConstraints);
  }).map((cell) => ({ taskIndex: cell.taskIndex, repetition: cell.repetition, newViolationNames: cell.candidateHardConstraintNames.filter((name) => !cell.baselineHardConstraintNames.includes(name)) }));
  const candidateLatency = median(reports.filter((report) => report?.mode === candidate).map((report) => report?.latencyMs));
  const baselineLatency = median(reports.filter((report) => report?.mode === baseline).map((report) => report?.latencyMs));
  const threshold = thresholdFor(thresholds, name);
  const repeatedLossAllowed = thresholds?.repeatedLossAllowed === true || DEFAULT_THRESHOLDS.repeatedLossAllowed === true;
  const hardConstraintRegressionAllowed = thresholds?.hardConstraintRegressionAllowed === true || DEFAULT_THRESHOLDS.hardConstraintRegressionAllowed === true;
  const latencyRatio = candidateLatency !== null && baselineLatency !== null && baselineLatency > 0 ? candidateLatency / baselineLatency : null;
  const latencyPass = name !== 'jevVsStock' || (latencyRatio !== null && latencyRatio <= threshold.medianLatencyRatio);
  const technicalInconclusive = cells.some((cell) => cell.technical);
  const repeatedLossPass = repeatedLossAllowed || repeatedLossTasks.length === 0;
  const hardConstraintPass = hardConstraintRegressionAllowed || hardConstraintRegressionCells.length === 0;
  const thresholdPass = wins - losses >= threshold.netWins && taskGains.size >= threshold.distinctTasks && repeatedLossPass && hardConstraintPass && latencyPass;
  return {
    name, candidate, baseline, cells, validCells: validCells.length, technicalCells: cells.length - validCells.length, wins, losses, ties: validCells.filter((cell) => cell.outcome === 'tie').length, netWins: wins - losses, distinctTaskGains: taskGains.size, repeatedLossTasks, hardConstraintRegressionCells, latencyMs: { candidateMedian: candidateLatency, baselineMedian: baselineLatency, ratio: latencyRatio, pass: latencyPass }, thresholds: { ...threshold, repeatedLossAllowed, hardConstraintRegressionAllowed },
    decision: technicalInconclusive ? 'inconclusive-technical' : thresholdPass ? 'pass' : 'no-demonstrated-downstream-benefit',
  };
}

/** Aggregate a completed runner report without accessing its raw run artifacts. */
export function aggregateAutomaticResults(input, suppliedThresholds) {
  const reports = Array.isArray(input) ? input : input?.reports;
  if (!Array.isArray(reports)) throw new Error('Results input must contain a reports array');
  const thresholds = suppliedThresholds ?? input?.manifest?.thresholds ?? input?.thresholds ?? DEFAULT_THRESHOLDS;
  const expectedKeys = new Set();
  for (let taskIndex = 0; taskIndex < 6; taskIndex += 1) for (let repetition = 0; repetition < 2; repetition += 1) for (const mode of ARM_NAMES) expectedKeys.add(`${taskIndex}:${repetition}:${mode}`);
  const observed = new Map();
  const unknown = [];
  const duplicates = [];
  for (const report of reports) {
    const key = `${report?.taskIndex}:${report?.repetition}:${report?.mode}`;
    if (!expectedKeys.has(key)) unknown.push(key);
    else if (observed.has(key)) duplicates.push(key);
    else observed.set(key, report);
  }
  const missing = [...expectedKeys].filter((key) => !observed.has(key)).sort();
  const complete = reports.length === expectedKeys.size && unknown.length === 0 && duplicates.length === 0 && missing.length === 0;
  const completeness = { expected: expectedKeys.size, observed: reports.length, complete, missing, duplicates, unknown };
  const arms = Object.fromEntries(ARM_NAMES.map((mode) => [mode, armSummary(mode, reports)]));
  const taskUnits = {};
  for (const report of reports) {
    const task = String(report?.taskIndex);
    const repetition = String(report?.repetition);
    taskUnits[task] ??= { repetitions: {} };
    taskUnits[task].repetitions[repetition] ??= { arms: {} };
    taskUnits[task].repetitions[repetition].arms[report?.mode ?? 'unknown'] = { taskSuccess: taskSuccess(report, report?.mode), rawQualityPassed: rawQualityPassed(report), integrationValid: scoringIntegrationValid(report, report?.mode), status: report?.status ?? null };
  }
  const comparisons = Object.fromEntries(COMPARISONS.map(([name, candidate, baseline]) => {
    const result = comparison(name, candidate, baseline, reports, thresholds);
    if (!complete) result.decision = 'inconclusive-technical';
    return [name, result];
  }));
  return { schemaVersion: 1, runs: reports.length, completeness, taskUnits, arms, comparisons, decisions: Object.fromEntries(Object.entries(comparisons).map(([name, result]) => [name, result.decision])), costUsd: null, privacy: { rawTranscripts: false, reasoning: false, credentials: false } };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: node benchmarks/automatic-results.mjs completed-report.json [output.json]');
  const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  let thresholds = input?.manifest?.thresholds ?? input?.thresholds;
  if (typeof input?.manifest === 'string') {
    let manifest;
    try { manifest = JSON.parse(await readFile(resolve(input.manifest), 'utf8')); }
    catch (error) { throw new Error(`Cannot read supplied manifest ${input.manifest}: ${error.message}`); }
    thresholds = manifest?.thresholds;
    if (!thresholds) throw new Error(`Supplied manifest ${input.manifest} has no thresholds`);
  }
  const result = aggregateAutomaticResults(input, thresholds);
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : join(dirname(resolve(inputPath)), 'automatic-results.json');
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output: outputPath, decisions: result.decisions, runs: result.runs }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
