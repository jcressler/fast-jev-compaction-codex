#!/usr/bin/env node
/**
 * Offline coverage benchmark for the bounded archive search API.
 *
 * The fixture is generated from several independent batches.  Its facts are
 * intentionally placed in call input, output prefixes/middles/suffixes,
 * structured output, JSON-string arrays, failed results, and messages.  The
 * archive is the authority for expected parent IDs; this benchmark never
 * reaches Jev or any network service.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { captureArchive, readCatalog, retrieveEvidence } from '../dist/archive.js';
import { searchEvidence } from '../dist/evidence.js';

const args = process.argv.slice(2);

function valuesFor(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && typeof args[index + 1] === 'string') values.push(args[index + 1]);
  }
  return values;
}

function valueFor(name) {
  return valuesFor(name)[0];
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  // Benchmark output is aggregate telemetry. Do not echo archive paths,
  // private file names, or long tool content when an input archive is bad.
  return message.replace(/[A-Za-z]:\\[^\s"']+/g, '<path>').slice(0, 240);
}

function token(seed, batch, kind) {
  const value = (seed ^ Math.imul(batch + 1, 0x45d9f3b)) >>> 0;
  return `heldout-${value.toString(36)}-${kind}`;
}

function diagnostic(seed, batch) {
  const prefix = `diagnostic batch ${batch} seed ${seed.toString(36)}\n`;
  // Keep this over the regression threshold even after JSON escaping.
  return prefix + ('unrelated batched diagnostic output; no business fact; '.repeat(410)).slice(0, 17_200);
}

function pair(callId, input, output) {
  return [
    { type: 'function_call', call_id: callId, name: 'synthetic_receipt_lookup', arguments: JSON.stringify(input) },
    { type: 'function_call_output', call_id: callId, output },
  ];
}

/** Generate records and query descriptors without using a fixed receipt ID. */
function makeFixture(seed = 0x6d2b79f5, batchCount = 6) {
  const batches = [];
  const descriptors = [];
  for (let batch = 0; batch < batchCount; batch += 1) {
    const records = [];
    const base = `${seed.toString(36)}-${batch.toString(36)}`;
    const noise = diagnostic(seed, batch);
    const receipt = token(seed, batch, 'receipt');
    const quantity = 11 + ((seed + batch * 17) % 89);
    const inputMarker = token(seed, batch, 'input');
    const beginningMarker = token(seed, batch, 'beginning');
    const middleMarker = token(seed, batch, 'middle');
    const endMarker = token(seed, batch, 'end');
    const structuredMarker = token(seed, batch, 'structured');
    const jsonArrayMarker = token(seed, batch, 'json-array');
    const failedMarker = token(seed, batch, 'failed');
    const messageMarker = token(seed, batch, 'message');

    const userMessage = { type: 'message', role: 'user', content: `Review ${messageMarker} for batch ${base}.` };
    records.push(userMessage);
    descriptors.push({ query: messageMarker, kind: 'message', message: true, fact: messageMarker });

    const calls = [
      {
        kind: 'input',
        callId: `call-${base}-input`,
        input: { receiptId: receipt, lookupKey: inputMarker, quantity },
        output: { ok: true, receiptId: receipt, quantity },
        marker: inputMarker,
      },
      {
        kind: 'beginning',
        callId: `call-${base}-beginning`,
        input: { receiptId: receipt, section: 'beginning' },
        output: `${beginningMarker}\n${noise}`,
        marker: beginningMarker,
      },
      {
        kind: 'middle',
        callId: `call-${base}-middle`,
        input: { receiptId: receipt, section: 'middle' },
        output: `${noise}\n${middleMarker}\n${noise}`,
        marker: middleMarker,
      },
      {
        kind: 'end',
        callId: `call-${base}-end`,
        input: { receiptId: receipt, section: 'end' },
        output: `${noise}\n${endMarker}`,
        marker: endMarker,
      },
      {
        kind: 'structured',
        callId: `call-${base}-structured`,
        input: { receiptId: receipt, section: 'structured' },
        output: {
          structuredContent: { receiptId: receipt, fact: structuredMarker, quantity },
          content: [{ type: 'text', text: `structured content ${structuredMarker}` }],
        },
        marker: structuredMarker,
      },
      {
        kind: 'json-array',
        callId: `call-${base}-json-array`,
        input: { receiptId: receipt, section: 'json-array' },
        output: JSON.stringify([
          { kind: 'diagnostic', text: noise.slice(0, 1000) },
          { receiptId: receipt, fact: jsonArrayMarker, quantity },
        ]),
        marker: jsonArrayMarker,
      },
      {
        kind: 'failed',
        callId: `call-${base}-failed`,
        input: { receiptId: receipt, section: 'failed' },
        output: { isError: true, failed: true, error: { code: 'SYNTHETIC_LOOKUP_FAILED', marker: failedMarker } },
        marker: failedMarker,
      },
    ];
    for (const item of calls) {
      records.push(...pair(item.callId, item.input, item.output));
      descriptors.push({ query: item.marker, kind: item.kind, callId: item.callId, fact: item.marker });
    }
    batches.push(records);
  }
  return { batches, descriptors, seed, batchCount };
}

async function objectSnapshot(directory) {
  const objects = join(directory, 'objects');
  const names = (await readdir(objects)).sort();
  const snapshot = {};
  for (const name of names) {
    const path = join(objects, name);
    const info = await stat(path);
    snapshot[name] = `${info.size}:${digest(await readFile(path))}`;
  }
  return snapshot;
}

function indexPathFor(input) {
  const absolute = resolve(input);
  return absolute.toLowerCase().endsWith('.json') ? absolute : join(absolute, 'index.json');
}

function parseManifest(value) {
  const raw = Array.isArray(value) ? value : value?.queries;
  if (!Array.isArray(raw)) throw new Error('queries manifest must contain an array');
  return raw.filter((item) => typeof item === 'string' || (item && typeof item.query === 'string')).map((item) => {
    if (typeof item === 'string') return { query: item };
    return {
      query: item.query,
    entryId: typeof item.entryId === 'string' ? item.entryId : typeof item.id === 'string' ? item.id : undefined,
    callId: typeof item.callId === 'string' ? item.callId : undefined,
    field: typeof item.field === 'string' ? item.field : undefined,
    recordIndex: Number.isInteger(item.recordIndex) ? item.recordIndex : undefined,
    fact: typeof item.fact === 'string' ? item.fact : undefined,
    exact: item.exact === true,
    };
  });
}

async function loadManifest(index, explicitQueries, explicitManifestPath) {
  if (explicitQueries.length > 0) return explicitQueries.map((query) => ({ query }));
  const sidecar = explicitManifestPath ? resolve(explicitManifestPath) : join(dirname(index), 'queries.json');
  try { return parseManifest(JSON.parse(await readFile(sidecar, 'utf8'))); }
  catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function entryForDescriptor(catalog, descriptor) {
  if (descriptor.entryId) return catalog.entries.find((entry) => entry.id === descriptor.entryId);
  if (descriptor.callId) return catalog.entries.find((entry) => entry.callId === descriptor.callId);
  return undefined;
}

async function deriveQueries(catalog, explicitQueries) {
  const manifest = await loadManifest(valueFor('--archive') ? indexPathFor(valueFor('--archive')) : '', explicitQueries, valueFor('--queries'));
  if (manifest.length > 0) return manifest;
  throw new Error('no synthetic queries supplied; use --query or --queries');
}

function mergePage(found, page) {
  for (const entry of page.entries ?? []) {
    if (!entry || typeof entry.id !== 'string') continue;
    const current = found.get(entry.id) ?? { ...entry, matches: [] };
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    const seen = new Set(current.matches.map((match) => JSON.stringify(match)));
    for (const match of matches) {
      const key = JSON.stringify(match);
      if (!seen.has(key)) current.matches.push(match);
      seen.add(key);
    }
    found.set(entry.id, current);
  }
}

async function searchAll(searchArchive, index, query, limit = 10) {
  const found = new Map();
  let offset = 0;
  let pages = 0;
  let complete = false;
  const skipped = [];
  const seenOffsets = new Set();
  while (pages < 256) {
    if (seenOffsets.has(offset)) throw new Error('search pagination did not advance');
    seenOffsets.add(offset);
    const page = await searchArchive(index, query, { limit, offset });
    if (!page || !Array.isArray(page.entries) || !page.scan || typeof page.scan.complete !== 'boolean') {
      throw new Error('searchArchive returned an invalid bounded-search result');
    }
    mergePage(found, page);
    if (Array.isArray(page.scan.skipped)) skipped.push(...page.scan.skipped);
    pages += 1;
    complete = page.scan.complete;
    if (complete) {
      if (page.scan.nextOffset !== null) throw new Error('complete search page returned a nextOffset');
      break;
    }
    if (page.scan.nextOffset === null) {
      throw new Error(`search ended before completion${skipped.length ? ` after ${skipped.length} skipped entries` : ''}`);
    }
    if (!Number.isInteger(page.scan.nextOffset) || page.scan.nextOffset < 0) throw new Error('search pagination returned an invalid nextOffset');
    offset = page.scan.nextOffset;
  }
  if (!complete) throw new Error(`search did not complete within the bounded page budget${skipped.length ? ` after ${skipped.length} skipped entries` : ''}`);
  if (skipped.length) throw new Error(`search skipped ${skipped.length} entries across its pages`);
  return { entries: [...found.values()], pages, skipped };
}

function returnedIDs(result) {
  return result.entries.map((entry) => entry.id).sort();
}

function assertMatches(result, descriptor, catalog, rawById) {
  const expected = entryForDescriptor(catalog, descriptor);
  const ids = returnedIDs(result);
  if (expected && !ids.includes(expected.id)) return 'expected parent ID was not recovered';
  if (expected && descriptor.exact && ids.join('\n') !== [expected.id].sort().join('\n')) return 'unexpected parent IDs';
  if ((descriptor.entryId || descriptor.callId) && !expected) return 'expected parent entry is missing';
  if (!expected && result.entries.length === 0) return 'query returned no entries';
  // A call-ID-only external query can be satisfied by catalog metadata. Such a
  // query has no raw fact or field contract, so it must not require a snippet.
  if (!descriptor.fact && !descriptor.field) return undefined;
  for (const entry of result.entries) {
    if (!Array.isArray(entry.matches) || entry.matches.length === 0) return 'entry has no record matches';
    for (const match of entry.matches) {
      if (!Number.isInteger(match.recordIndex) || !['input', 'output', 'message'].includes(match.field) || typeof match.text !== 'string') return 'invalid match shape';
      const records = rawById.get(entry.id) ?? [];
      if (records.length === 0) return 'match points at an unavailable raw record';
      if (!records[match.recordIndex] || !JSON.stringify(records[match.recordIndex]).toLowerCase().includes(descriptor.query.toLowerCase())) return 'match points at unrelated raw record';
    }
  }
  const relevant = expected ? result.entries.filter(entry => entry.id === expected.id) : result.entries;
  if (descriptor.field && !relevant.some((entry) => entry.matches.some((match) => match.field === descriptor.field))) return 'expected field was not indexed';
  if (descriptor.recordIndex !== undefined && !relevant.some(entry => entry.matches.some(match => match.recordIndex === descriptor.recordIndex))) return 'expected record was not indexed';
  return undefined;
}

async function runFixture(searchArchive) {
  const root = await mkdtemp(join(tmpdir(), 'fast-jev-batched-search-'));
  try {
    const archiveDir = join(root, 'archive');
    const identity = { session: `synthetic-${Date.now()}`, transcript: join(root, 'transcript.jsonl'), cwd: root };
    const fixture = makeFixture(0x6d2b79f5, 6);
    for (let batch = 0; batch < fixture.batches.length; batch += 1) {
      await captureArchive(fixture.batches[batch], archiveDir, identity, 1_700_000_000_000 + batch);
    }
    const index = join(archiveDir, 'index.json');
    const catalog = await readCatalog(index);
    const byCall = new Map(catalog.entries.filter((entry) => entry.callId).map((entry) => [entry.callId, entry]));
    for (const descriptor of fixture.descriptors) {
      if (descriptor.callId) descriptor.entryId = byCall.get(descriptor.callId)?.id;
      if (descriptor.kind === 'message') descriptor.entryId = catalog.entries.find((entry) => entry.kind === 'message' && entry.summary.includes(descriptor.query))?.id;
      descriptor.field = descriptor.kind === 'input' ? 'input' : descriptor.kind === 'message' ? 'message' : 'output';
      descriptor.exact = true;
    }
    const before = await objectSnapshot(archiveDir);
    const rawById = new Map();
    for (const entry of catalog.entries.filter((candidate) => candidate.kind !== 'opaque')) {
      rawById.set(entry.id, (await retrieveEvidence(index, entry.id)).records);
    }
    const metrics = { queries: fixture.descriptors.length, baselineHits: 0, archiveHits: 0, baselineEntries: 0, archiveEntries: 0, recovered: 0, targetTop1: 0, pages: 0, scanSkipped: 0, fieldMatches: 0 };
    const failures = [];
    for (const descriptor of fixture.descriptors) {
      const baseline = searchEvidence(catalog.entries, descriptor.query, 10);
      const result = await searchAll(searchArchive, index, descriptor.query);
      const target = entryForDescriptor(catalog, descriptor);
      metrics.baselineEntries += baseline.length;
      metrics.archiveEntries += result.entries.length;
      if (target && baseline.some((entry) => entry.id === target.id)) metrics.baselineHits += 1;
      if (target && result.entries.some((entry) => entry.id === target.id)) metrics.archiveHits += 1;
      if (target && result.entries[0]?.id === target.id) metrics.targetTop1 += 1;
      metrics.pages += result.pages;
      metrics.scanSkipped += result.skipped.length;
      const failure = assertMatches(result, descriptor, catalog, rawById);
      if (failure) failures.push(failure);
      else {
        metrics.recovered += 1;
        if (result.entries.some((entry) => entry.matches.some((match) => match.field === descriptor.field))) metrics.fieldMatches += 1;
      }
      if (target) {
        if (!JSON.stringify(rawById.get(target.id)).toLowerCase().includes(descriptor.fact.toLowerCase())) failures.push('retrieval did not contain expected raw fact');
      }
    }
    const after = await objectSnapshot(archiveDir);
    const objectsPreserved = JSON.stringify(before) === JSON.stringify(after);
    if (!objectsPreserved) failures.push('archive object hashes changed');
    return {
      schemaVersion: 1, benchmark: 'batched-search', mode: 'offline-fixture', batches: fixture.batchCount,
      records: fixture.batches.reduce((total, batch) => total + batch.length, 0),
      diagnosticBytes: diagnostic(fixture.seed, 0).length, metrics, objectsPreserved,
      passed: failures.length === 0, regressions: [...new Set(failures)],
    };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function runArchive(searchArchive, archiveInput) {
  const index = indexPathFor(archiveInput);
  const catalog = await readCatalog(index);
  const explicitQueries = valuesFor('--query');
  const descriptors = await deriveQueries(catalog, explicitQueries);
  if (descriptors.length === 0) throw new Error('no synthetic queries supplied; use --query or provide queries.json');
  const before = await objectSnapshot(dirname(index));
  const rawById = new Map();
  for (const entry of catalog.entries.filter((candidate) => candidate.kind !== 'opaque')) {
    rawById.set(entry.id, (await retrieveEvidence(index, entry.id)).records);
  }
  const metrics = { queries: descriptors.length, baselineHits: 0, archiveHits: 0, baselineEntries: 0, archiveEntries: 0, recovered: 0, targetTop1: 0, pages: 0, scanSkipped: 0, fieldMatches: 0 };
  const failures = [];
  for (const descriptor of descriptors) {
    const baseline = searchEvidence(catalog.entries, descriptor.query, 10);
    const result = await searchAll(searchArchive, index, descriptor.query);
    const target = entryForDescriptor(catalog, descriptor);
    metrics.baselineEntries += baseline.length;
    metrics.archiveEntries += result.entries.length;
    if (target && baseline.some((entry) => entry.id === target.id)) metrics.baselineHits += 1;
    if (target && result.entries.some((entry) => entry.id === target.id)) metrics.archiveHits += 1;
    if (target && result.entries[0]?.id === target.id) metrics.targetTop1 += 1;
    metrics.pages += result.pages;
    metrics.scanSkipped += result.skipped.length;
    const failure = assertMatches(result, descriptor, catalog, rawById);
    if (failure) failures.push(failure);
    else {
      metrics.recovered += 1;
      const relevant = target ? result.entries.filter(entry => entry.id === target.id) : result.entries;
      if (descriptor.field && relevant.some(entry => entry.matches.some(match => match.field === descriptor.field))) metrics.fieldMatches += 1;
    }
    if (target) {
      if (descriptor.fact && !JSON.stringify(rawById.get(target.id)).toLowerCase().includes(descriptor.fact.toLowerCase())) failures.push('retrieval did not contain expected raw fact');
    }
  }
  const after = await objectSnapshot(dirname(index));
  const objectsPreserved = JSON.stringify(before) === JSON.stringify(after);
  if (!objectsPreserved) failures.push('archive object hashes changed');
  return { schemaVersion: 1, benchmark: 'batched-search', mode: 'archive', entries: catalog.entries.length, metrics, objectsPreserved, passed: failures.length === 0, regressions: [...new Set(failures)] };
}

async function main() {
  const module = await import('../dist/search.js');
  if (typeof module.searchArchive !== 'function') throw new Error('dist/search.js does not export searchArchive');
  const archive = valueFor('--archive');
  return archive ? runArchive(module.searchArchive, archive) : runFixture(module.searchArchive);
}

try {
  const report = await main();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, benchmark: 'batched-search', passed: false, regressions: [safeError(error)] })}\n`);
  process.exitCode = 1;
}
