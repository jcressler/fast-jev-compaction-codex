#!/usr/bin/env node
/**
 * Synthetic Jev recovery-selection trial.
 *
 * This is a small retrieval comparison, not a Codex or end-to-end accuracy
 * evaluation. The fixture is intentionally synthetic and the report contains
 * counts and coverage only; it never includes transcript or Jev response text.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BUDGET = 6_000;
const MAX_LIVE_REQUESTS = 3;

const TRIALS = [
  {
    id: 'receipt-and-failed-patch',
    goal: 'Recover the earlier work needed to continue the greenhouse order task, then state the next safe action.',
    targetCalls: ['write-greenhouse-receipt', 'failed-greenhouse-patch'],
    targetMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE'],
    pinnedMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE'],
  },
  {
    id: 'latest-instruction-correction',
    goal: 'Continue the greenhouse order using the latest approved instruction and preserve the work already completed.',
    targetCalls: ['write-greenhouse-receipt', 'failed-greenhouse-patch'],
    targetMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP'],
    pinnedMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP'],
  },
  {
    id: 'safe-summary',
    goal: 'Recover the approved pickup window from the earlier order read and summarize the next action without repeating side effects.',
    targetCalls: ['read-greenhouse-invoice'],
    targetMarkers: ['HIDDEN-INVOICE-APPROVED-PICKUP'],
    pinnedMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP'],
  },
];

function noise(prefix, count) {
  return Array.from({ length: count }, (_, index) => [
    { type: 'function_call', call_id: `${prefix}-noise-${index}`, name: 'read_file', arguments: { path: `scratch/${prefix}-${index}.txt` } },
    { type: 'function_call_output', call_id: `${prefix}-noise-${index}`, output: `unrelated ${prefix} output ${index}; cache refreshed` },
  ]).flat();
}

/** Synthetic transcript with earlier useful work, failures, writes, noise, and a later correction. */
export function fixtureItems(goal) {
  const earlier = [
    { type: 'message', role: 'user', content: 'Prepare the greenhouse order and retain any evidence needed after compaction.' },
    { type: 'message', role: 'assistant', content: 'I will inspect the order records before making a bounded change.' },
    { type: 'function_call', call_id: 'failed-greenhouse-patch', name: 'apply_patch', arguments: { path: 'greenhouse/order.json', operation: 'replace' } },
    { type: 'function_call_output', call_id: 'failed-greenhouse-patch', output: 'ERROR EACCES: permission denied; patch was not applied; retry requires approval.' },
    { type: 'function_call', call_id: 'write-greenhouse-receipt', name: 'write_receipt', arguments: { order: 'greenhouse-17', quantity: 48 } },
    { type: 'function_call_output', call_id: 'write-greenhouse-receipt', output: 'SUCCESS receipt saved for greenhouse order; write completed once; retain receipt and do not repeat.' },
    { type: 'function_call', call_id: 'read-greenhouse-invoice', name: 'read_file', arguments: { path: 'greenhouse/invoice-status.json' } },
    { type: 'function_call_output', call_id: 'read-greenhouse-invoice', output: 'HIDDEN-INVOICE-APPROVED-PICKUP: invoice approved; pickup window is 2026-09-22 09:00.' },
    { type: 'message', role: 'user', content: 'PIN-CONSTRAINT-LOCAL-STORAGE: Keep supplier documents local for this release. Do not upload them.' },
    { type: 'message', role: 'assistant', content: 'The supplier-document upload remains disabled.' },
    ...noise('earlier', 26),
  ];
  const later = [
    { type: 'message', role: 'user', content: 'The previous vendor-code instruction is superseded. LATEST-CORRECTION-LOCAL-PICKUP: use approved local pickup for fulfillment.' },
    { type: 'function_call', call_id: 'read-latest-order', name: 'read_file', arguments: { path: 'greenhouse/order-status.json' } },
    { type: 'function_call_output', call_id: 'read-latest-order', output: 'status read successfully; unrelated shipping dashboard also refreshed' },
    ...noise('recent', 42),
    { type: 'message', role: 'user', content: 'Continue from the latest approved instruction. Do not rerun the failed patch or duplicate the successful write.' },
  ];
  return [...earlier, ...later, ...(goal ? [{ type: 'message', role: 'user', content: goal }] : [])];
}

function elapsed(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function parseArgs(argv) {
  const values = { live: false, allowNetwork: false, output: undefined, budget: DEFAULT_BUDGET };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') values.live = true;
    else if (arg === '--allow-network') values.allowNetwork = true;
    else if (arg === '--output') {
      values.output = argv[++index];
      if (!values.output) throw new Error('--output requires a path');
    } else if (arg === '--budget') {
      const parsed = Number(argv[++index]);
      if (!Number.isInteger(parsed) || parsed < 500) throw new Error('--budget must be an integer >= 500');
      values.budget = parsed;
    } else if (arg === '--help' || arg === '-h') {
      values.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (values.live && !values.allowNetwork) throw new Error('--live requires --allow-network');
  if (values.live && !process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required for --live');
  return values;
}

function help() {
  return [
    'Usage: node benchmarks/jev-trial.mjs [--live --allow-network] [--output PATH] [--budget CHARS]',
    '',
    'Default mode is local and offline. Live mode sends only this synthetic fixture to Jev,',
    'uses at most three requests, and fails if any selection falls back to local ranking.',
  ].join('\n');
}

function entryIds(catalog, callIds, markers) {
  const ids = [];
  for (const entry of catalog.entries) {
    if (callIds.includes(entry.callId)) ids.push(entry.id);
    const serialized = `${entry.summary ?? ''} ${entry.outcome ?? ''}`;
    if (markers.some((marker) => serialized.includes(marker))) ids.push(entry.id);
  }
  return unique(ids);
}

function selectedIdsFromContext(context) {
  const ids = [];
  for (const line of String(context).split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.id === 'string') ids.push(parsed.id);
    } catch {
      // Prefix and summary lines are intentionally not JSON records.
    }
  }
  return unique(ids);
}

function reportContext(context, archivePath) {
  return String(context).replaceAll(JSON.stringify(archivePath), '"<synthetic-archive>"');
}

function coverage(selected, target, pinned) {
  const selectedSet = new Set(selected);
  const targetSet = new Set(target);
  const pinnedSet = new Set(pinned);
  const hitCount = [...targetSet].filter((id) => selectedSet.has(id)).length;
  const pinnedHitCount = [...pinnedSet].filter((id) => selectedSet.has(id)).length;
  return {
    selectedCount: selectedSet.size,
    targetCount: targetSet.size,
    targetHitCount: hitCount,
    targetCoverage: targetSet.size ? hitCount / targetSet.size : 1,
    pinnedConstraintCount: pinnedSet.size,
    pinnedConstraintHitCount: pinnedHitCount,
    pinnedConstraintCoverage: pinnedSet.size ? pinnedHitCount / pinnedSet.size : 1,
  };
}

export function evaluateSelection(selected, catalog, trial) {
  const target = entryIds(catalog, trial.targetCalls, trial.targetMarkers);
  const pinned = entryIds(catalog, [], trial.pinnedMarkers);
  return coverage(selected, target, pinned);
}

function compactSelection(result, fallbackWallMs) {
  if (!result || typeof result !== 'object') throw new Error('selectRecovery returned no result');
  if (result.mode !== 'jev' && result.mode !== 'local-fallback') throw new Error('selectRecovery returned an invalid mode');
  if (!Array.isArray(result.selectedIds)) throw new Error('selectRecovery returned no selectedIds array');
  if (!Number.isInteger(result.requests) || result.requests < 0) throw new Error('selectRecovery returned invalid requests');
  if (!finite(result.latencyMs)) throw new Error('selectRecovery returned invalid latencyMs');
  return {
    mode: result.mode,
    selectedIds: unique(result.selectedIds),
    requests: result.requests,
    latencyMs: result.latencyMs,
    wallLatencyMs: fallbackWallMs,
    candidateCount: finite(result.candidateCount) ? result.candidateCount : null,
    requestChars: finite(result.requestChars) ? result.requestChars : null,
    model: typeof result.model === 'string' ? result.model : null,
    usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
    reason: typeof result.reason === 'string' ? result.reason : null,
  };
}

async function loadRuntime() {
  const [archive, hooks, recovery, client] = await Promise.all([
    import('../dist/archive.js'),
    import('../dist/hooks.js'),
    import('../dist/recovery.js'),
    import('../dist/client.js'),
  ]);
  if (typeof recovery.selectRecovery !== 'function') throw new Error('dist/recovery.js does not export selectRecovery');
  if (typeof hooks.recoveryContext !== 'function') throw new Error('dist/hooks.js does not export recoveryContext');
  return { archive, hooks, recovery, client };
}

async function makeArchive(runtime, root, trial) {
  const items = fixtureItems(trial.goal);
  const transcript = join(root, `synthetic-${trial.id}.jsonl`);
  await writeFile(transcript, `${items.map((item) => JSON.stringify(item)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  const archiveDir = join(root, `archive-${trial.id}`);
  const identity = { session: `synthetic-jev-trial-${trial.id}`, transcript, cwd: root };
  await runtime.archive.captureArchive(items, archiveDir, identity, Date.now());
  const catalogPath = join(archiveDir, 'index.json');
  const catalog = await runtime.archive.readCatalog(catalogPath);
  return { catalog, catalogPath, items, transcript };
}

function assertSyntheticArchive(items, catalog) {
  if (items.length < 100) throw new Error('fixture lost its rich/noisy shape');
  if (catalog.entries.length < 50) throw new Error('fixture did not produce enough evidence entries');
  for (const callId of ['write-greenhouse-receipt', 'failed-greenhouse-patch']) {
    if (!catalog.entries.some((entry) => entry.callId === callId)) throw new Error(`fixture missing ${callId}`);
  }
  const text = JSON.stringify(items);
  for (const marker of ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP', 'HIDDEN-INVOICE-APPROVED-PICKUP']) {
    if (!text.includes(marker)) throw new Error(`fixture missing ${marker}`);
  }
}

async function runLocal(runtime, archiveStates, budget) {
  const trials = [];
  const started = process.hrtime.bigint();
  for (const [index, trial] of TRIALS.entries()) {
    const archiveState = archiveStates[index];
    const trialStart = process.hrtime.bigint();
    const context = runtime.hooks.recoveryContext(archiveState.catalog, archiveState.catalogPath, budget);
    const selectedIds = selectedIdsFromContext(context);
    trials.push({
      trialId: trial.id,
      mode: 'local',
      requests: 0,
      latencyMs: elapsed(trialStart),
      selectedIds,
      contextChars: context.length,
      context: reportContext(context, archiveState.catalogPath),
      ...evaluateSelection(selectedIds, archiveState.catalog, trial),
    });
  }
  return { mode: 'local', requests: 0, latencyMs: elapsed(started), trials };
}

async function runLive(runtime, archiveStates, budget) {
  const asker = new runtime.client.JevClient();
  const trials = [];
  const started = process.hrtime.bigint();
  for (const [index, trial] of TRIALS.entries()) {
    const archiveState = archiveStates[index];
    const trialStart = process.hrtime.bigint();
    const selection = await runtime.recovery.selectRecovery(
      archiveState.catalog,
      archiveState.catalogPath,
      asker,
      // Keep the visible task goal separate from hidden fixture facts.
      { maxCandidates: 20 },
    );
    const compact = compactSelection(selection, elapsed(trialStart));
    if (compact.mode !== 'jev') throw new Error(`trial ${trial.id} fell back to ${compact.mode}`);
    if (compact.requests !== 1) throw new Error(`trial ${trial.id} used ${compact.requests} Jev requests; expected one`);
    const context = runtime.hooks.recoveryContext(archiveState.catalog, archiveState.catalogPath, budget, selection);
    const contextSelectedIds = selectedIdsFromContext(context);
    trials.push({
      trialId: trial.id,
      ...compact,
      rankedIds: compact.selectedIds,
      selectedIds: contextSelectedIds,
      contextChars: context.length,
      context: reportContext(context, archiveState.catalogPath),
      ...evaluateSelection(contextSelectedIds, archiveState.catalog, trial),
    });
  }
  const requests = trials.reduce((sum, trial) => sum + trial.requests, 0);
  if (requests > MAX_LIVE_REQUESTS) throw new Error(`live trial exceeded ${MAX_LIVE_REQUESTS} requests`);
  return { mode: 'jev', requests, latencyMs: elapsed(started), trials };
}

/**
 * Offline same-candidate-pool ablation. Equal scores preserve the selector's
 * candidate order, so this is not a fake live Jev result and makes no network
 * request. It isolates candidate ordering from model re-ranking.
 */
async function runCandidateOrder(runtime, archiveStates, budget) {
  const trials = [];
  const started = process.hrtime.bigint();
  const equalScoreAsker = {
    async ask(_state, questions) {
      return {
        answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])),
      };
    },
  };
  for (const [index, trial] of TRIALS.entries()) {
    const archiveState = archiveStates[index];
    const trialStart = process.hrtime.bigint();
    const selection = await runtime.recovery.selectRecovery(
      archiveState.catalog,
      archiveState.catalogPath,
      equalScoreAsker,
      { maxCandidates: 20 },
    );
    if (selection.mode !== 'jev' || selection.requests !== 1) {
      throw new Error(`candidate-order ablation did not use the expected injected selection path for ${trial.id}`);
    }
    const contextSelection = { mode: 'jev', selectedIds: selection.selectedIds };
    const context = runtime.hooks.recoveryContext(archiveState.catalog, archiveState.catalogPath, budget, contextSelection);
    const selectedIds = selectedIdsFromContext(context);
    trials.push({
      trialId: trial.id,
      mode: 'candidate-order',
      requests: 0,
      selectionRequests: selection.requests,
      latencyMs: elapsed(trialStart),
      selectionLatencyMs: selection.latencyMs,
      candidateCount: finite(selection.candidateCount) ? selection.candidateCount : null,
      requestChars: finite(selection.requestChars) ? selection.requestChars : null,
      model: null,
      usage: null,
      reason: 'equal-score injected asker; no network',
      rankedIds: unique(selection.selectedIds),
      selectedIds,
      contextChars: context.length,
      context: reportContext(context, archiveState.catalogPath),
      ...evaluateSelection(selectedIds, archiveState.catalog, trial),
    });
  }
  return { mode: 'candidate-order', requests: 0, latencyMs: elapsed(started), trials };
}

function reportFor(archiveStates, local, candidateOrder, live, budget) {
  const comparison = TRIALS.map((trial, index) => {
    const localTrial = local.trials[index];
    const liveTrial = live?.trials[index] ?? null;
    return {
      trialId: trial.id,
      local: { targetCoverage: localTrial.targetCoverage, pinnedConstraintCoverage: localTrial.pinnedConstraintCoverage, selectedCount: localTrial.selectedCount },
      candidateOrder: { targetCoverage: candidateOrder.trials[index].targetCoverage, pinnedConstraintCoverage: candidateOrder.trials[index].pinnedConstraintCoverage, selectedCount: candidateOrder.trials[index].selectedCount },
      jev: liveTrial ? { mode: liveTrial.mode, targetCoverage: liveTrial.targetCoverage, pinnedConstraintCoverage: liveTrial.pinnedConstraintCoverage, selectedCount: liveTrial.selectedCount } : null,
      delta: liveTrial ? {
        targetCoverage: liveTrial.targetCoverage - localTrial.targetCoverage,
        pinnedConstraintCoverage: liveTrial.pinnedConstraintCoverage - localTrial.pinnedConstraintCoverage,
      } : null,
      jevVsCandidateOrder: liveTrial ? {
        targetCoverage: liveTrial.targetCoverage - candidateOrder.trials[index].targetCoverage,
        pinnedConstraintCoverage: liveTrial.pinnedConstraintCoverage - candidateOrder.trials[index].pinnedConstraintCoverage,
      } : null,
    };
  });
  return {
    benchmark: 'fast-jev-compaction-codex synthetic live-Jev recovery trial',
    schemaVersion: 1,
    scoreKind: 'synthetic-recovery-selection',
    liveModelEvaluation: false,
    fixture: {
      synthetic: true,
      oneArchiveCapture: false,
      independentCaptures: archiveStates.length,
      records: archiveStates.reduce((sum, state) => sum + state.items.length, 0),
      entries: archiveStates.reduce((sum, state) => sum + state.catalog.entries.length, 0),
      trials: TRIALS.length,
      hiddenTargetsSentInQuery: false,
    },
    budgetChars: budget,
    local,
    candidateOrder,
    jev: live ?? { mode: 'disabled', requests: 0, latencyMs: 0, trials: null },
    comparison,
    limitations: [
      'Synthetic evidence selection only; this is not a full Codex or end-to-end accuracy evaluation.',
      'Coverage counts whether selected evidence records include fixture targets; it does not judge an agent response.',
      'No cost estimate is produced. Live usage and model are reported only when Jev returns them.',
      'Live mode sends this synthetic fixture metadata to Jev through selectRecovery and fails on local fallback.',
    ],
  };
}

async function writeExclusive(path, report) {
  const output = resolve(path);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return output;
}

export async function runTrial(options = {}) {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const runtime = await loadRuntime();
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-trial-'));
  try {
    const archiveStates = [];
    for (const trial of TRIALS) {
      const archiveState = await makeArchive(runtime, root, trial);
      assertSyntheticArchive(archiveState.items, archiveState.catalog);
      archiveStates.push(archiveState);
    }
    const local = await runLocal(runtime, archiveStates, budget);
    const candidateOrder = await runCandidateOrder(runtime, archiveStates, budget);
    const live = options.live ? await runLive(runtime, archiveStates, budget) : null;
    return reportFor(archiveStates, local, candidateOrder, live, budget);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }
  const report = await runTrial({ live: args.live, budget: args.budget });
  if (args.output) {
    const output = await writeExclusive(args.output, report);
    console.log(JSON.stringify({ benchmark: report.benchmark, output: basename(output), mode: report.jev.mode }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`jev-trial: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
