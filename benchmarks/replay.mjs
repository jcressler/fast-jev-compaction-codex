#!/usr/bin/env node
/**
 * Offline archive replay benchmark.
 *
 * This is a deterministic fixture benchmark, not a live model evaluation. It
 * measures the local archive path. The
 * optional --jev mode sends the same fixture to Jev and is only included when
 * the caller explicitly supplies TYPESAFE_API_KEY and --allow-network.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevClient } from '../dist/client.js';
import { captureArchive, readCatalog, retrieveEvidence } from '../dist/archive.js';
import { rankArchiveSearch, searchArchive } from '../dist/search.js';

const args = new Set(process.argv.slice(2));
const useJev = args.has('--jev');
if (useJev && !args.has('--allow-network')) {
  throw new Error('--jev requires --allow-network');
}
if (useJev && !process.env.TYPESAFE_API_KEY) {
  throw new Error('TYPESAFE_API_KEY is required for --jev');
}

const tasks = [
  { id: 'old-error', prompt: 'Recover the old failed lookup and report its code.', expected: ['EACCES', 'permission denied', 'hidden-error-note=retain-for-audit'] },
  { id: 'successful-write', prompt: 'Recover the successful receipt and do not repeat the write.', expected: ['receipt-042', 'quantity: 18', 'hidden-receipt-note=do-not-repeat'] },
  { id: 'second-compaction', prompt: 'Recover the new plan created after the second compaction.', expected: ['PLAN-043', 'approved'] },
];

function fixtures() {
  const noise = (prefix, count) => Array.from({ length: count }, (_, index) => [
    { type: 'function_call', call_id: `call-${prefix}-noise-${index}`, name: 'read_file', arguments: { path: `noise/${prefix}-${index}.txt` } },
    { type: 'function_call_output', call_id: `call-${prefix}-noise-${index}`, output: `routine ${prefix} lookup result ${index}` },
  ]).flat();
  const largeError = `failed lookup error: EACCES: permission denied reading missing-invoice.json\n${'historical detail '.repeat(900)}hidden-error-note=retain-for-audit`;
  const largeReceipt = `successful write receipt: receipt-042; quantity: 18\n${'receipt detail '.repeat(900)}hidden-receipt-note=do-not-repeat`;
  const first = [
    { type: 'message', role: 'user', content: 'Find the old invoice lookup failure and preserve the successful receipt.' },
    { type: 'function_call', call_id: 'call-old-error', name: 'read_file', arguments: { path: 'missing-invoice.json' } },
    { type: 'function_call_output', call_id: 'call-old-error', output: largeError },
    { type: 'function_call', call_id: 'call-write-receipt', name: 'write_receipt', arguments: { order: 'INV-042', quantity: 18 } },
    { type: 'function_call_output', call_id: 'call-write-receipt', output: largeReceipt },
    ...noise('first', 18),
  ];
  const second = [
    { type: 'message', role: 'user', content: 'After compaction, continue with the approved replacement plan.' },
    { type: 'function_call', call_id: 'call-plan-043', name: 'read_file', arguments: { path: 'plan-043.json' } },
    { type: 'function_call_output', call_id: 'call-plan-043', output: 'PLAN-043 approved for the next cycle.' },
    ...noise('second', 18),
  ];
  return { first, second, all: [...first, ...second] };
}

function jsonSize(records) {
  return Buffer.byteLength(JSON.stringify(records));
}

function evaluate(records) {
  const text = JSON.stringify(records);
  const callIds = records
    .filter((record) => record.type === 'function_call')
    .map((record) => record.call_id)
    .filter((id) => typeof id === 'string');
  const duplicateCalls = callIds.length - new Set(callIds).size;
  return {
    factualRecovery: tasks.every((task) => task.expected.every((fact) => text.includes(fact))),
    taskResults: tasks.map((task) => ({
      taskId: task.id,
      success: task.expected.every((fact) => text.includes(fact)),
      duplicateArchivedCallIds: duplicateCalls,
    })),
    duplicateArchivedCallIds: duplicateCalls,
    recordCount: records.length,
    bytes: jsonSize(records),
  };
}

function elapsed(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function retrieveMatches(catalogPath, entries) {
  const ids = [...new Set(entries.map((entry) => entry.id))];
  return (await Promise.all(ids.map((id) => retrieveEvidence(catalogPath, id)))).flatMap((result) => result.records);
}

async function archiveReplay(items, mode = 'archive') {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-replay-'));
  try {
    const start = process.hrtime.bigint();
    const catalogPath = join(root, 'index.json');
    const identity = {
      session: 'benchmark-session',
      transcript: join(root, 'synthetic-rollout.jsonl'),
      cwd: root,
    };
    const sourcePath = identity.transcript;
    await writeFile(sourcePath, `${items.first.map(JSON.stringify).join('\n')}\n${items.second.map(JSON.stringify).join('\n')}\n`, 'utf8');
    const sourceBefore = await readFile(sourcePath);
    await captureArchive(items.first, root, identity, Date.now());
    // The source transcript is a separate immutable fixture. A second local
    // capture merges its evidence into the same cumulative index.
    await captureArchive(items.second, root, identity, Date.now() + 1);
    if (!sourceBefore.equals(await readFile(sourcePath))) throw new Error('source fixture mutated');
    const catalog = await readCatalog(catalogPath);
    const selected = (await Promise.all(tasks.map(task => searchArchive(catalogPath, task.prompt, { limit: 3 })))).flatMap(result => result.entries);
    const recovered = await retrieveMatches(catalogPath, selected);
    return { mode, scoreKind: 'deterministic-fixture', latencyMs: elapsed(start), costUsd: 0,
      compactions: 2, entries: catalog.entries.length, ...evaluate(recovered) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function jevReplay(items) {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-replay-jev-'));
  try {
    const start = process.hrtime.bigint();
    const catalogPath = join(root, 'index.json');
    const identity = { session: 'benchmark-session', transcript: join(root, 'synthetic-rollout.jsonl'), cwd: root };
    await captureArchive(items.first, root, identity, Date.now());
    await captureArchive(items.second, root, identity, Date.now() + 1);
    const ranked = [];
    const ranking = [];
    for (const task of tasks) {
      const local = await searchArchive(catalogPath, task.prompt, { limit: 20 });
      const result = await rankArchiveSearch(local, task.prompt, new JevClient(), 3);
      ranking.push({ taskId: task.id, mode: result.mode, requests: result.requests, usage: result.usage ?? null });
      ranked.push(...(await retrieveMatches(catalogPath, result.entries)));
    }
    return {
      mode: 'jev-ranking', scoreKind: 'deterministic-fixture', latencyMs: elapsed(start),
      costUsd: null, ranking, ...evaluate(ranked),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const items = fixtures();
const results = [await archiveReplay(items)];
if (useJev) results.push(await jevReplay(items));
console.log(JSON.stringify({
  benchmark: 'fast-jev-compaction-codex synthetic recovery replay',
  schemaVersion: 1,
  scoreKind: 'deterministic-fixture',
  liveModelEvaluation: false,
  fixture: 'deterministic local records; no live Codex session',
  tasks,
  realModelRunSchema: {
    taskResults: 'array of {taskId,success,repeatedSideEffects,latencyMs,usage,costUsd}',
    unavailableValues: null,
    scorer: 'benchmarks/score.mjs',
  },
  realModelRuns: null,
  nativeProtocol: 'Run the same tasks in a real native Codex session and record taskResults; no native model is simulated here.',
  results,
}, null, 2));
