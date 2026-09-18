#!/usr/bin/env node
/** Score recorded real-model runs, separate from replay.mjs's deterministic fixture score. */
import { readFile } from 'node:fs/promises';

const input = process.argv[2];
if (!input) throw new Error('Usage: node benchmarks/score.mjs recorded-runs.json');
const document = JSON.parse(await readFile(input, 'utf8'));
const runs = Array.isArray(document) ? document : document.runs;
if (!Array.isArray(runs)) throw new Error('Input must be an array or {runs: []}');

function finiteNonnegative(value, label, allowNull = true) {
  if (value === null && allowNull) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number or null`);
  }
  return value;
}

function metric(values) {
  const measured = values.filter((value) => value !== null);
  if (measured.length === 0) return { value: null, measured: 0, total: values.length };
  return {
    value: measured.reduce((sum, value) => sum + value, 0) / measured.length,
    measured: measured.length,
    total: values.length,
  };
}

function summarize(mode, modeRuns) {
  const taskRows = modeRuns.flatMap((run) => Array.isArray(run.taskResults)
    ? run.taskResults.map((task) => ({ ...task, run })) : []);
  const successes = taskRows.map((task) => typeof task.success === 'boolean' ? task.success : null);
  const successMeasured = successes.filter((value) => value !== null);
  function counts(name) {
    const values = taskRows.map(task => task[name] === undefined ? null : finiteNonnegative(task[name], name));
    if (values.some(value => value !== null && !Number.isSafeInteger(value))) throw new Error(`${name} must be an integer count`);
    const measured = values.filter(value => value !== null);
    return {
      value: values.length && measured.length === values.length ? measured.reduce((a, b) => a + b, 0) : null,
      measured: measured.length, unknown: values.length - measured.length, total: values.length,
    };
  }
  const latencyValues = modeRuns.map((run) => run.latencyMs === undefined
    ? null : finiteNonnegative(run.latencyMs, 'latencyMs'));
  const costValues = modeRuns.map((run) => run.costUsd === undefined
    ? null : finiteNonnegative(run.costUsd, 'costUsd'));
  const usage = modeRuns.map((run) => run.usage ?? null);
  return {
    mode,
    runs: modeRuns.length,
    taskResults: taskRows.length,
    taskSuccess: {
      value: successMeasured.length
        ? successMeasured.filter(Boolean).length / successMeasured.length : null,
      measured: successMeasured.length,
      unknown: successes.length - successMeasured.length,
      total: successes.length,
    },
    repeatedSideEffects: counts('repeatedSideEffects'),
    repeatedMistakes: counts('repeatedMistakes'),
    latencyMs: metric(latencyValues),
    usage: usage.some((value) => value !== null) ? usage : null,
    costUsd: {
      ...metric(costValues),
      total: costValues.every((value) => value !== null)
        ? costValues.reduce((sum, value) => sum + value, 0) : null,
    },
  };
}

const grouped = new Map();
for (const [index, run] of runs.entries()) {
  if (!run || typeof run !== 'object') throw new Error(`Run ${index} must be an object`);
  const mode = typeof run.mode === 'string' && run.mode.trim() ? run.mode : 'unknown';
  const list = grouped.get(mode) ?? [];
  list.push(run);
  grouped.set(mode, list);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  source: 'recorded real-model runs',
  groups: [...grouped.entries()].map(([mode, modeRuns]) => summarize(mode, modeRuns)),
  unavailable: 'null means the run did not record that measurement; unknown task outcomes are excluded from success denominators.',
}, null, 2));
