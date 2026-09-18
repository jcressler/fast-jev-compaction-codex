#!/usr/bin/env node
/**
 * Held-out continuation fixtures.  Each case is deliberately a small,
 * ordinary maintenance task with three chronological evidence windows.  The
 * source and expectedSource strings are evaluator material; a runner exposes
 * only taskContext, query, and stages to the model.
 */

const STAGE_COUNT = 3;
const CALLS_PER_STAGE = 24;
const SEED = 918204;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function json(value) {
  return JSON.stringify(value);
}

function pair(callId, input, output) {
  return [
    { type: 'function_call', call_id: callId, name: 'workspace_lookup', arguments: json(input) },
    { type: 'function_call_output', call_id: callId, output: json(output) },
  ];
}

function opaqueId(caseIndex, stage, index) {
  // Stable, opaque identifiers keep ranking from benefiting from task labels.
  const n = (SEED + caseIndex * 7919 + stage * 241 + index * 37) >>> 0;
  return `q${n.toString(16).padStart(8, '0')}`;
}

function asType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'string';
  return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
}

function schemaFor(expectedFacts) {
  const factProperties = {};
  for (const [key, value] of Object.entries(expectedFacts)) {
    factProperties[key] = { type: [asType(value), 'null'] };
    if (Array.isArray(value)) factProperties[key].items = { type: 'string' };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'facts'],
    properties: {
      source: { type: 'string', minLength: 1 },
      facts: {
        type: 'object', additionalProperties: false, required: Object.keys(expectedFacts), properties: factProperties,
      },
    },
  };
}

function scoreFactory(expectedFacts) {
  const fields = Object.keys(expectedFacts);
  return (answer) => {
    const facts = answer && typeof answer === 'object' && answer.facts && typeof answer.facts === 'object'
      ? answer.facts : answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
    let correctFields = 0;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(facts, field)
        && json(facts[field]) === json(expectedFacts[field])) correctFields += 1;
    }
    return { correctFields, totalFields: fields.length, fullyCorrect: correctFields === fields.length };
  };
}

function filler(caseIndex, stage, index) {
  const topics = [
    'The read-only catalog snapshot was refreshed for the neighboring workspace.',
    'A historical test artifact is retained for audit and does not change runtime behavior.',
    'The maintainer compared lockfiles, generated types, and the local check output.',
    'An adjacent endpoint reports the same schema with a different retention window.',
    'The review found no write request, credential use, or dependency installation.',
    'The staging sample uses a different label set while retaining the same parser version.',
    'An obsolete plan failed its preflight check and was retired; no irreversible action was repeated.',
  ];
  return {
    workspace: `maintenance-sandbox-${caseIndex + 1}`,
    stage: stage + 1,
    sequence: index,
    status: index % 5 === 0 ? 'warning' : 'observed',
    observedAt: `2026-09-${String(10 + stage).padStart(2, '0')}T${String(8 + (index % 9)).padStart(2, '0')}:2${index % 10}:00Z`,
    summary: topics[(index + stage + caseIndex) % topics.length],
    details: `The bounded lookup returned a stable read-only result for sample ${caseIndex + 1}-${stage + 1}-${index + 1}; the maintainer recorded it with the surrounding checks for later audit.`,
    checks: ['format', 'typecheck', index % 3 === 0 ? 'stale-cache-review' : 'unit-test-index'],
  };
}

function buildStages(spec, caseIndex) {
  const stages = [];
  const relevantCallIds = [];
  const targetByStage = new Map();
  for (const target of spec.targets) {
    targetByStage.set(`${target.stage}:${target.index}`, target);
  }
  for (let stage = 0; stage < STAGE_COUNT; stage += 1) {
    const items = [];
    for (let index = 0; index < CALLS_PER_STAGE; index += 1) {
      const callId = opaqueId(caseIndex, stage, index);
      const target = targetByStage.get(`${stage}:${index}`);
      const input = {
        path: ['src', 'tests', 'docs', 'config'][index % 4] + `/sample-${(index % 7) + 1}.json`,
        query: spec.topic,
        stage: stage + 1,
        sequence: index,
        seed: SEED + caseIndex,
      };
      const output = target ? {
        workspace: `maintenance-sandbox-${caseIndex + 1}`,
        stage: stage + 1,
        sequence: index,
        recordedAt: target.recordedAt,
        status: target.status,
        subject: target.subject,
        fact: target.fact,
        value: clone(target.value),
        correction: target.correction || null,
        failedPlan: target.failedPlan || null,
        attemptedAction: 'read-only observation',
        doNotRepeat: true,
        note: target.note,
        verification: `Read-only evidence for the ${spec.topic} contract; later records supersede earlier observations only when they say so explicitly.`,
      } : filler(caseIndex, stage, index);
      items.push(...pair(callId, input, output));
      if (target) relevantCallIds.push(callId);
    }
    stages.push(items);
  }
  return { stages, relevantCallIds };
}

const PAGINATION_SOURCE = `function solve(input) {
  const pages = Array.isArray(input && input.pages) ? input.pages : [];
  const ids = [];
  for (const page of pages) {
    for (const item of (page && Array.isArray(page.items) ? page.items : [])) {
      if (item && item.id != null) ids.push(String(item.id));
    }
  }
  return { ids, nextCursor: pages.length ? pages[pages.length - 1].nextCursor || null : null, pagesRead: pages.length };
}`;

const PAGINATION_EXPECTED = `function solve(input) {
  const pages = Array.isArray(input && input.pages) ? input.pages : [];
  const wanted = input && input.startCursor != null ? String(input.startCursor) : null;
  const ids = [], seen = new Set();
  let cursor = wanted, started = wanted == null, pagesRead = 0;
  for (const page of pages) {
    if (!page || (!started && String(page.cursor) !== cursor)) continue;
    started = true;
    for (const item of (Array.isArray(page.items) ? page.items : [])) {
      const id = item && item.id != null ? String(item.id).trim() : '';
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
    pagesRead += 1;
    cursor = page.nextCursor == null ? null : String(page.nextCursor);
    if (cursor == null) break;
  }
  return { ids, nextCursor: cursor, pagesRead };
}`;

const RETRY_SOURCE = `function solve(input) {
  const events = Array.isArray(input && input.events) ? input.events : [];
  const last = events[events.length - 1] || {};
  return { action: last.status === 'ok' ? 'skip' : 'retry', delayMs: Number(input && input.baseDelayMs) || 0, key: input && input.idempotencyKey || null };
}`;

const RETRY_EXPECTED = `function solve(input) {
  const events = Array.isArray(input && input.events) ? input.events : [];
  const key = input && input.idempotencyKey != null ? String(input.idempotencyKey) : null;
  const relevant = events.filter((event) => event && (key == null || String(event.key) === key));
  const max = Number.isInteger(input && input.maxAttempts) && input.maxAttempts > 0 ? input.maxAttempts : 4;
  const base = Number.isFinite(input && input.baseDelayMs) && input.baseDelayMs >= 0 ? input.baseDelayMs : 250;
  if (relevant.some((event) => event.status === 'succeeded')) return { action: 'skip', delayMs: 0, key };
  const attempts = relevant.length;
  if (attempts >= max) return { action: 'dead-letter', delayMs: 0, key };
  const last = relevant[relevant.length - 1] || {};
  if (last.status && !['failed', 'timeout', 'rate_limited'].includes(last.status)) return { action: 'fail', delayMs: 0, key };
  const retryAfter = Number.isFinite(last.retryAfterMs) && last.retryAfterMs >= 0 ? last.retryAfterMs : 0;
  const delayMs = Math.max(retryAfter, base * (2 ** attempts));
  return { action: 'retry', delayMs, key };
}`;

const WINDOW_SOURCE = `function solve(input) {
  const date = new Date(input && input.timestamp);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return { within: minute >= Number(input.startMinute) && minute <= Number(input.endMinute), localMinute: minute };
}`;

const WINDOW_EXPECTED = `function solve(input) {
  const date = new Date(input && input.timestamp);
  if (Number.isNaN(date.getTime())) return { within: false, localMinute: null };
  const offset = Number.isFinite(input && input.offsetMinutes) ? input.offsetMinutes : 0;
  const utc = date.getUTCHours() * 60 + date.getUTCMinutes();
  const localMinute = ((utc + offset) % 1440 + 1440) % 1440;
  const start = Number(input && input.startMinute), end = Number(input && input.endMinute);
  const within = start === end ? true : start < end ? localMinute >= start && localMinute < end : localMinute >= start || localMinute < end;
  return { within, localMinute };
}`;

const MONEY_SOURCE = `function solve(input) {
  const subtotal = Number(input && input.subtotalCents) || 0;
  const discount = subtotal * (Number(input && input.discountBps) || 0) / 10000;
  const tax = (subtotal - discount) * (Number(input && input.taxBps) || 0) / 10000;
  return { discountCents: Math.floor(discount), taxableCents: subtotal - Math.floor(discount), taxCents: Math.floor(tax), totalCents: subtotal - Math.floor(discount) + Math.floor(tax) };
}`;

const MONEY_EXPECTED = `function solve(input) {
  const subtotalCents = Number.isInteger(input && input.subtotalCents) && input.subtotalCents >= 0 ? input.subtotalCents : 0;
  const bps = Number.isFinite(input && input.discountBps) && input.discountBps >= 0 ? input.discountBps : 0;
  const rawDiscount = Math.floor((subtotalCents * bps + 5000) / 10000);
  const cap = Number.isInteger(input && input.discountCapCents) && input.discountCapCents >= 0 ? input.discountCapCents : rawDiscount;
  const discountCents = Math.min(rawDiscount, cap, subtotalCents);
  const taxableCents = subtotalCents - discountCents;
  const taxBps = Number.isFinite(input && input.taxBps) && input.taxBps >= 0 ? input.taxBps : 0;
  const taxCents = Math.floor((taxableCents * taxBps + 5000) / 10000);
  return { discountCents, taxableCents, taxCents, totalCents: taxableCents + taxCents };
}`;

const INVENTORY_SOURCE = `function solve(input) {
  const available = Number(input && input.available) || 0;
  const used = (input && input.reservations || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const qty = Number(input && input.request && input.request.qty) || 0;
  return { reservationId: input && input.request && input.request.id || null, status: qty <= available - used ? 'reserved' : 'rejected', reservedQty: qty, remaining: Math.max(0, available - used - qty) };
}`;

const INVENTORY_EXPECTED = `function solve(input) {
  const available = Number.isInteger(input && input.available) && input.available >= 0 ? input.available : 0;
  const reservations = Array.isArray(input && input.reservations) ? input.reservations : [];
  const request = input && input.request && typeof input.request === 'object' ? input.request : {};
  const id = request.id == null ? null : String(request.id);
  const existing = reservations.find((item) => item && String(item.id) === id && ['held', 'confirmed'].includes(item.status));
  const active = reservations.reduce((sum, item) => sum + (item && ['held', 'confirmed'].includes(item.status) && Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 0), 0);
  if (existing) return { reservationId: id, status: 'already-held', reservedQty: existing.qty, remaining: Math.max(0, available - active) };
  const qty = Number.isInteger(request.qty) && request.qty > 0 ? request.qty : 0;
  const remaining = Math.max(0, available - active);
  if (!qty || qty > remaining) return { reservationId: id, status: 'rejected', reservedQty: 0, remaining };
  return { reservationId: id, status: 'reserved', reservedQty: qty, remaining: remaining - qty };
}`;

const CSV_SOURCE = `function solve(input) {
  const lines = String(input && input.csv || '').split(/\\r?\\n/).filter(Boolean);
  const header = (lines.shift() || '').split(',');
  const at = header.indexOf(input && input.idColumn);
  const identifiers = [], seen = new Set();
  for (const line of lines) { const value = (line.split(',')[at] || '').trim().toLowerCase(); if (value && !seen.has(value)) { seen.add(value); identifiers.push(value); } }
  return { identifiers, rowsAccepted: identifiers.length, rejected: [] };
}`;

const CSV_EXPECTED = `function solve(input) {
  const text = String(input && input.csv || ''), rows = [], row = [], field = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { field.push('"'); i += 1; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(field.join('')); field.length = 0; }
    else if ((ch === '\\n' || ch === '\\r') && !quoted) { if (ch === '\\r' && text[i + 1] === '\\n') i += 1; row.push(field.join('')); field.length = 0; rows.push(row.splice(0)); }
    else field.push(ch);
  }
  if (field.length || row.length) { row.push(field.join('')); if (row.some((v) => v !== '')) rows.push(row.splice(0)); }
  const header = (rows.shift() || []).map((v) => v.trim().toLowerCase());
  const at = header.indexOf(String(input && input.idColumn || '').trim().toLowerCase());
  const identifiers = [], rejected = [], seen = new Set();
  if (at < 0) return { identifiers, rowsAccepted: 0, rejected: [{ line: 1, reason: 'missing-column' }] };
  rows.forEach((values, index) => {
    const line = index + 2, value = String(values[at] == null ? '' : values[at]).trim().toUpperCase();
    if (!value) rejected.push({ line, reason: 'blank' });
    else if (seen.has(value)) rejected.push({ line, reason: 'duplicate' });
    else { seen.add(value); identifiers.push(value); }
  });
  return { identifiers, rowsAccepted: identifiers.length, rejected };
}`;

const CASE_DEFS = [
  {
    id: 'cursor-window', topic: 'cursor pagination helper',
    taskContext: 'Repair solve(input) in src/pagination.js. It must walk the supplied page snapshots from startCursor, preserve identifier text, deduplicate repeated records, stop at a null cursor, and return ids, nextCursor, and pagesRead without mutating input. The current implementation is shown below.\n\n',
    query: 'Repair the pagination helper shown in the task context. Return JSON {source,facts}; preserve cursor semantics, identifier text, deduplication, and the documented stopping rule. Use the historical records to state the contract facts.',
    source: PAGINATION_SOURCE, expectedSource: PAGINATION_EXPECTED,
    expectedFacts: { pageSize: 3, startCursor: 'cur-17', terminalCursor: null },
    targets: [
      { stage: 0, index: 6, fact: 'pageSize', value: 3, subject: 'page snapshot', recordedAt: '2026-09-10T09:12:00Z', status: 'observed', note: 'The service emits at most three records per page; an empty page is still a consumed page.' },
      { stage: 1, index: 8, fact: 'startCursor', value: 'cur-17', subject: 'cursor input', recordedAt: '2026-09-12T14:05:00Z', status: 'corrected', correction: 'A prior note used cur-16 for a neighboring tenant.', note: 'The bounded replay begins at cursor cur-17.' },
      { stage: 1, index: 18, fact: 'deduplicate', value: true, subject: 'identifier policy', recordedAt: '2026-09-13T10:22:00Z', status: 'approved', note: 'Convert non-null ids to strings and trim surrounding whitespace, preserving leading zeros. Ignore missing or blank ids. Emit repeated normalized ids only once, in first-occurrence order.' },
      { stage: 2, index: 14, fact: 'terminalCursor', value: null, subject: 'termination rule', recordedAt: '2026-09-15T16:40:00Z', status: 'verified', note: 'A null next cursor ends the walk; do not request another page.' },
    ],
    tests: [
      { name: 'first-page', input: { pages: [{ cursor: null, items: [{ id: 'A' }], nextCursor: null }] }, expected: { ids: ['A'], nextCursor: null, pagesRead: 1 } },
      { name: 'cursor-select', input: { startCursor: 'b', pages: [{ cursor: null, items: [{ id: 'old' }], nextCursor: 'b' }, { cursor: 'b', items: [{ id: 'B' }], nextCursor: null }] }, expected: { ids: ['B'], nextCursor: null, pagesRead: 1 } },
      { name: 'dedupe', input: { pages: [{ cursor: null, items: [{ id: 'x' }, { id: 'x' }], nextCursor: 'b' }, { cursor: 'b', items: [{ id: 'x' }, { id: ' y ' }], nextCursor: null }] }, expected: { ids: ['x', 'y'], nextCursor: null, pagesRead: 2 } },
      { name: 'empty-counts', input: { pages: [{ cursor: null, items: [], nextCursor: 'b' }, { cursor: 'b', items: [{ id: 'q' }], nextCursor: null }] }, expected: { ids: ['q'], nextCursor: null, pagesRead: 2 } },
      { name: 'missing-id', input: { pages: [{ cursor: null, items: [{ name: 'n' }, null, { id: 0 }], nextCursor: null }] }, expected: { ids: ['0'], nextCursor: null, pagesRead: 1 } },
      { name: 'unmatched-cursor', input: { startCursor: 'z', pages: [{ cursor: null, items: [{ id: 'A' }], nextCursor: null }] }, expected: { ids: [], nextCursor: 'z', pagesRead: 0 } },
      { name: 'early-stop', input: { pages: [{ cursor: null, items: [{ id: 'A' }], nextCursor: null }, { cursor: 'later', items: [{ id: 'B' }], nextCursor: null }] }, expected: { ids: ['A'], nextCursor: null, pagesRead: 1 } },
      { name: 'defaults', input: {}, expected: { ids: [], nextCursor: null, pagesRead: 0 } },
    ],
  },
  {
    id: 'retry-key', topic: 'idempotent retry planner',
    taskContext: 'Repair solve(input) in src/retry.js. It returns {action,delayMs,key} for a retry queue. Only the matching idempotency key counts; succeeded work is skipped, attempts at max are dead-lettered, retry-after wins over exponential backoff, and unknown terminal status fails.\n\n',
    query: 'Repair the retry planner shown in the task context. Return JSON {source,facts}; preserve idempotency, attempt limits, retry-after precedence, and terminal handling. Use the historical records to state the contract facts.',
    source: RETRY_SOURCE, expectedSource: RETRY_EXPECTED,
    expectedFacts: { maxAttempts: 4, baseDelayMs: 250, retryAfterMs: 900 },
    targets: [
      { stage: 0, index: 5, fact: 'maxAttempts', value: 4, subject: 'queue policy', recordedAt: '2026-09-10T08:30:00Z', status: 'observed', note: 'Four matching attempts are allowed before the job moves to dead-letter; absent maxAttempts defaults to 4.' },
      { stage: 1, index: 9, fact: 'baseDelayMs', value: 250, subject: 'backoff policy', recordedAt: '2026-09-12T11:15:00Z', status: 'corrected', correction: 'The old 100 ms value belonged to a test queue.', note: 'The production base delay is 250 milliseconds; absent baseDelayMs defaults to 250.' },
      { stage: 1, index: 17, fact: 'retryAfterMs', value: 900, subject: 'header mapping', recordedAt: '2026-09-13T13:45:00Z', status: 'approved', note: 'A numeric retry-after value is a lower bound for the computed delay.' },
      { stage: 2, index: 15, fact: 'successPolicy', value: 'skip matching key', subject: 'idempotency rule', recordedAt: '2026-09-15T15:05:00Z', status: 'verified', note: 'A prior success for the same key returns action skip; dead-letter is returned after the fourth matching attempt, and cancelled is terminal fail.' },
    ],
    tests: [
      { name: 'empty', input: { idempotencyKey: 'k', baseDelayMs: 250, maxAttempts: 4 }, expected: { action: 'retry', delayMs: 250, key: 'k' } },
      { name: 'backoff', input: { idempotencyKey: 'k', baseDelayMs: 250, events: [{ key: 'k', status: 'failed' }, { key: 'k', status: 'timeout' }] }, expected: { action: 'retry', delayMs: 1000, key: 'k' } },
      { name: 'retry-after', input: { idempotencyKey: 'k', baseDelayMs: 250, events: [{ key: 'k', status: 'failed', retryAfterMs: 900 }] }, expected: { action: 'retry', delayMs: 900, key: 'k' } },
      { name: 'success', input: { idempotencyKey: 'k', events: [{ key: 'k', status: 'succeeded' }] }, expected: { action: 'skip', delayMs: 0, key: 'k' } },
      { name: 'other-key', input: { idempotencyKey: 'k', events: [{ key: 'other', status: 'succeeded' }] }, expected: { action: 'retry', delayMs: 250, key: 'k' } },
      { name: 'dead-letter', input: { idempotencyKey: 'k', maxAttempts: 2, events: [{ key: 'k', status: 'failed' }, { key: 'k', status: 'failed' }] }, expected: { action: 'dead-letter', delayMs: 0, key: 'k' } },
      { name: 'terminal', input: { idempotencyKey: 'k', events: [{ key: 'k', status: 'cancelled' }] }, expected: { action: 'fail', delayMs: 0, key: 'k' } },
      { name: 'null-key', input: { events: [{ status: 'failed' }] }, expected: { action: 'retry', delayMs: 500, key: null } },
    ],
  },
  {
    id: 'local-window', topic: 'offset-aware time window',
    taskContext: 'Repair solve(input) in src/window.js. Input supplies an ISO timestamp, an explicit offset in minutes, and a start/end minute window. Return {within,localMinute}; windows may cross midnight, end is exclusive, and equal bounds mean the full day.\n\n',
    query: 'Repair the time-window helper shown in the task context. Return JSON {source,facts}; preserve explicit offsets, midnight crossing, inclusive start, exclusive end, and invalid-date behavior. Use historical records for contract facts.',
    source: WINDOW_SOURCE, expectedSource: WINDOW_EXPECTED,
    expectedFacts: { offsetMinutes: -300, windowStart: 1320, windowEnd: 120 },
    targets: [
      { stage: 0, index: 7, fact: 'offsetMinutes', value: -300, subject: 'regional offset', recordedAt: '2026-09-10T07:40:00Z', status: 'observed', note: 'The caller supplies the current offset; the helper must not consult the host timezone.' },
      { stage: 1, index: 6, fact: 'windowStart', value: 1320, subject: 'service window', recordedAt: '2026-09-12T09:10:00Z', status: 'corrected', correction: 'The prior 21:00 start was from an obsolete schedule.', note: 'The current window begins at local minute 1320.' },
      { stage: 1, index: 19, fact: 'windowEnd', value: 120, subject: 'service window', recordedAt: '2026-09-13T12:20:00Z', status: 'approved', note: 'The current window ends at local minute 120, exclusively; equal start and end bounds mean the full day.' },
      { stage: 2, index: 13, fact: 'endExclusive', value: true, subject: 'boundary behavior', recordedAt: '2026-09-15T18:00:00Z', status: 'verified', note: 'A timestamp exactly at the end boundary is outside a non-full-day window.' },
    ],
    tests: [
      { name: 'inside-crossing', input: { timestamp: '2026-01-01T03:30:00Z', offsetMinutes: -300, startMinute: 1320, endMinute: 120 }, expected: { within: true, localMinute: 1350 } },
      { name: 'end-boundary', input: { timestamp: '2026-01-01T07:00:00Z', offsetMinutes: -300, startMinute: 1320, endMinute: 120 }, expected: { within: false, localMinute: 120 } },
      { name: 'start-boundary', input: { timestamp: '2026-01-02T03:00:00Z', offsetMinutes: -300, startMinute: 1320, endMinute: 120 }, expected: { within: true, localMinute: 1320 } },
      { name: 'outside', input: { timestamp: '2026-01-01T15:00:00Z', offsetMinutes: -300, startMinute: 1320, endMinute: 120 }, expected: { within: false, localMinute: 600 } },
      { name: 'normal-window', input: { timestamp: '2026-01-01T15:00:00Z', offsetMinutes: 60, startMinute: 900, endMinute: 1100 }, expected: { within: true, localMinute: 960 } },
      { name: 'equal-full-day', input: { timestamp: '2026-01-01T15:00:00Z', offsetMinutes: 0, startMinute: 600, endMinute: 600 }, expected: { within: true, localMinute: 900 } },
      { name: 'negative-offset', input: { timestamp: '2026-01-01T00:15:00Z', offsetMinutes: -60, startMinute: 1380, endMinute: 60 }, expected: { within: true, localMinute: 1395 } },
      { name: 'invalid', input: { timestamp: 'bad', offsetMinutes: 0, startMinute: 0, endMinute: 1 }, expected: { within: false, localMinute: null } },
    ],
  },
  {
    id: 'cent-rounding', topic: 'discount and tax cents calculator',
    taskContext: 'Repair solve(input) in src/money.js. Amounts are integer cents. Discount and tax rates are basis points, each operation rounds half-up to cents, discount is capped, and totals must remain integer cents. Return discountCents, taxableCents, taxCents, totalCents.\n\n',
    query: 'Repair the cents calculator shown in the task context. Return JSON {source,facts}; preserve basis-point arithmetic, half-up rounding, the discount cap, nonnegative inputs, and integer totals. Use historical records for contract facts.',
    source: MONEY_SOURCE, expectedSource: MONEY_EXPECTED,
    expectedFacts: { rateBasis: 'basis points', rounding: 'half-up cents', discountCapCents: 1250 },
    targets: [
      { stage: 0, index: 4, fact: 'rateBasis', value: 'basis points', subject: 'pricing contract', recordedAt: '2026-09-10T10:10:00Z', status: 'observed', note: 'Rates arrive as basis points; the denominator is 10000.' },
      { stage: 1, index: 10, fact: 'rounding', value: 'half-up cents', subject: 'pricing contract', recordedAt: '2026-09-12T10:50:00Z', status: 'corrected', correction: 'A floor-only implementation undercharged tie values.', note: 'Every percentage result rounds half-up at the cent boundary.' },
      { stage: 1, index: 16, fact: 'discountCapCents', value: 1250, subject: 'promotion rule', recordedAt: '2026-09-13T14:30:00Z', status: 'approved', note: 'The promotion may remove no more than 1250 cents.' },
      { stage: 2, index: 12, fact: 'taxBps', value: 825, subject: 'tax configuration', recordedAt: '2026-09-15T17:20:00Z', status: 'verified', note: 'Tax is computed from taxable cents after discount at 825 basis points; invalid or negative money inputs clamp to zero.' },
    ],
    tests: [
      { name: 'ordinary', input: { subtotalCents: 10000, discountBps: 1000, discountCapCents: 1250, taxBps: 825 }, expected: { discountCents: 1000, taxableCents: 9000, taxCents: 743, totalCents: 9743 } },
      { name: 'cap', input: { subtotalCents: 20000, discountBps: 1000, discountCapCents: 1250, taxBps: 0 }, expected: { discountCents: 1250, taxableCents: 18750, taxCents: 0, totalCents: 18750 } },
      { name: 'half-up', input: { subtotalCents: 1, discountBps: 5000, discountCapCents: 99, taxBps: 0 }, expected: { discountCents: 1, taxableCents: 0, taxCents: 0, totalCents: 0 } },
      { name: 'tax-tie', input: { subtotalCents: 100, discountBps: 0, discountCapCents: 99, taxBps: 50 }, expected: { discountCents: 0, taxableCents: 100, taxCents: 1, totalCents: 101 } },
      { name: 'zero', input: { subtotalCents: 0, discountBps: 500, discountCapCents: 10, taxBps: 825 }, expected: { discountCents: 0, taxableCents: 0, taxCents: 0, totalCents: 0 } },
      { name: 'negative', input: { subtotalCents: -5, discountBps: 1000, discountCapCents: 10, taxBps: 825 }, expected: { discountCents: 0, taxableCents: 0, taxCents: 0, totalCents: 0 } },
      { name: 'no-cap', input: { subtotalCents: 1000, discountBps: 500, taxBps: 0 }, expected: { discountCents: 50, taxableCents: 950, taxCents: 0, totalCents: 950 } },
      { name: 'large-rate', input: { subtotalCents: 100, discountBps: 20000, discountCapCents: 9999, taxBps: 0 }, expected: { discountCents: 100, taxableCents: 0, taxCents: 0, totalCents: 0 } },
    ],
  },
  {
    id: 'reservation-ledger', topic: 'inventory reservation helper',
    taskContext: 'Repair solve(input) in src/reservations.js. Available units are reduced by held and confirmed reservations. A matching active reservation id is idempotent, invalid quantities reject, and a request may not partially reserve. Return reservationId, status, reservedQty, and remaining.\n\n',
    query: 'Repair the reservation helper shown in the task context. Return JSON {source,facts}; preserve active statuses, idempotent reservation ids, no partial holds, and remaining inventory. Use historical records for contract facts.',
    source: INVENTORY_SOURCE, expectedSource: INVENTORY_EXPECTED,
    expectedFacts: { activeStatuses: ['held', 'confirmed'], reservationTtlMinutes: 20, duplicatePolicy: 'return existing' },
    targets: [
      { stage: 0, index: 8, fact: 'activeStatuses', value: ['held', 'confirmed'], subject: 'stock policy', recordedAt: '2026-09-10T08:55:00Z', status: 'observed', note: 'Both held and confirmed rows consume available units when qty is a positive integer. Ignore other statuses and rows with invalid quantities. Requests must also have a positive integer qty.' },
      { stage: 1, index: 7, fact: 'reservationTtlMinutes', value: 20, subject: 'reservation policy', recordedAt: '2026-09-12T12:05:00Z', status: 'corrected', correction: 'The 30-minute draft belonged to an older channel.', note: 'New holds use a 20-minute TTL outside this pure helper.' },
      { stage: 1, index: 20, fact: 'duplicatePolicy', value: 'return existing', subject: 'idempotency policy', recordedAt: '2026-09-13T15:10:00Z', status: 'approved', note: 'A repeated active reservation id returns status already-held with its existing quantity and does not consume stock again.' },
      { stage: 2, index: 11, fact: 'partialReservations', value: false, subject: 'allocation policy', recordedAt: '2026-09-15T13:35:00Z', status: 'verified', note: 'Insufficient remaining stock rejects the whole request.' },
    ],
    tests: [
      { name: 'reserve', input: { available: 37, reservations: [], request: { id: 'r1', qty: 5 } }, expected: { reservationId: 'r1', status: 'reserved', reservedQty: 5, remaining: 32 } },
      { name: 'active-count', input: { available: 37, reservations: [{ id: 'a', qty: 4, status: 'held' }, { id: 'b', qty: 3, status: 'confirmed' }, { id: 'c', qty: 9, status: 'released' }], request: { id: 'r1', qty: 5 } }, expected: { reservationId: 'r1', status: 'reserved', reservedQty: 5, remaining: 25 } },
      { name: 'duplicate', input: { available: 37, reservations: [{ id: 'r1', qty: 8, status: 'held' }], request: { id: 'r1', qty: 99 } }, expected: { reservationId: 'r1', status: 'already-held', reservedQty: 8, remaining: 29 } },
      { name: 'reject-short', input: { available: 5, reservations: [{ id: 'a', qty: 4, status: 'confirmed' }], request: { id: 'r1', qty: 2 } }, expected: { reservationId: 'r1', status: 'rejected', reservedQty: 0, remaining: 1 } },
      { name: 'released-free', input: { available: 5, reservations: [{ id: 'a', qty: 4, status: 'released' }], request: { id: 'r1', qty: 2 } }, expected: { reservationId: 'r1', status: 'reserved', reservedQty: 2, remaining: 3 } },
      { name: 'zero', input: { available: 5, reservations: [], request: { id: 'r1', qty: 0 } }, expected: { reservationId: 'r1', status: 'rejected', reservedQty: 0, remaining: 5 } },
      { name: 'negative', input: { available: 5, reservations: [], request: { id: 'r1', qty: -1 } }, expected: { reservationId: 'r1', status: 'rejected', reservedQty: 0, remaining: 5 } },
      { name: 'invalid-rows', input: { available: 5, reservations: [{ id: 'a', qty: 3.5, status: 'held' }, { id: 'b', qty: 1, status: 'expired' }], request: { id: 'r1', qty: 2 } }, expected: { reservationId: 'r1', status: 'reserved', reservedQty: 2, remaining: 3 } },
    ],
  },
  {
    id: 'csv-identifiers', topic: 'quoted identifier import',
    taskContext: 'Repair solve(input) in src/import.js. Parse the supplied CSV, find idColumn case-insensitively, preserve leading zeroes while trimming and uppercasing identifiers, accept each identifier once, and report rejected row numbers for blanks and duplicates. Quoted commas and doubled quotes are valid.\n\n',
    query: 'Repair the CSV identifier importer shown in the task context. Return JSON {source,facts}; preserve quoted fields, header matching, leading zeroes, duplicate reporting, and blank reporting. Use historical records for contract facts.',
    source: CSV_SOURCE, expectedSource: CSV_EXPECTED,
    expectedFacts: { idHeader: 'vendor_id', normalization: 'trim-uppercase-preserve-leading-zero', duplicatePolicy: 'reject duplicate' },
    targets: [
      { stage: 0, index: 9, fact: 'idHeader', value: 'vendor_id', subject: 'import schema', recordedAt: '2026-09-10T09:50:00Z', status: 'observed', note: 'The identifier column is vendor_id and matching is case-insensitive; a missing column rejects line 1 with missing-column.' },
      { stage: 1, index: 5, fact: 'normalization', value: 'trim-uppercase-preserve-leading-zero', subject: 'identifier policy', recordedAt: '2026-09-12T13:25:00Z', status: 'corrected', correction: 'A lowercasing import lost the distinction required by downstream labels.', note: 'Trim and uppercase values but never parse them as numbers.' },
      { stage: 1, index: 21, fact: 'quotedFields', value: true, subject: 'CSV grammar', recordedAt: '2026-09-13T16:15:00Z', status: 'approved', note: 'Commas inside quoted fields and doubled quote escapes are part of the accepted input; blank values reject with reason blank.' },
      { stage: 2, index: 10, fact: 'duplicatePolicy', value: 'reject duplicate', subject: 'row policy', recordedAt: '2026-09-15T14:45:00Z', status: 'verified', note: 'The first normalized occurrence is accepted and later occurrences report duplicate.' },
    ],
    tests: [
      { name: 'basic', input: { idColumn: 'vendor_id', csv: 'vendor_id,name\n0012,A\nX-7,B\n' }, expected: { identifiers: ['0012', 'X-7'], rowsAccepted: 2, rejected: [] } },
      { name: 'quoted-comma', input: { idColumn: 'vendor_id', csv: 'name,vendor_id\n"A, Co", 0003 \nB,004\n' }, expected: { identifiers: ['0003', '004'], rowsAccepted: 2, rejected: [] } },
      { name: 'duplicate', input: { idColumn: 'vendor_id', csv: 'vendor_id\nabc\n ABC \n' }, expected: { identifiers: ['ABC'], rowsAccepted: 1, rejected: [{ line: 3, reason: 'duplicate' }] } },
      { name: 'blank', input: { idColumn: 'vendor_id', csv: 'vendor_id\n\n  \nA\n' }, expected: { identifiers: ['A'], rowsAccepted: 1, rejected: [{ line: 2, reason: 'blank' }, { line: 3, reason: 'blank' }] } },
      { name: 'doubled-quote', input: { idColumn: 'vendor_id', csv: 'vendor_id,note\nA,"say ""hi"""\n' }, expected: { identifiers: ['A'], rowsAccepted: 1, rejected: [] } },
      { name: 'header-case', input: { idColumn: 'VENDOR_ID', csv: 'Vendor_ID\nq1\n' }, expected: { identifiers: ['Q1'], rowsAccepted: 1, rejected: [] } },
      { name: 'missing-column', input: { idColumn: 'vendor_id', csv: 'sku\nA\n' }, expected: { identifiers: [], rowsAccepted: 0, rejected: [{ line: 1, reason: 'missing-column' }] } },
      { name: 'quoted-newline', input: { idColumn: 'vendor_id', csv: 'vendor_id,note\nA,"line one\nline two"\n' }, expected: { identifiers: ['A'], rowsAccepted: 1, rejected: [] } },
    ],
  },
];

for (const spec of CASE_DEFS) spec.taskContext += spec.source;

const REGRESSION_NAMES = Object.freeze({
  'cursor-window': ['dedupe', 'early-stop'],
  'retry-key': ['success', 'dead-letter'],
  'local-window': ['end-boundary'],
  'cent-rounding': ['half-up', 'cap'],
  'reservation-ledger': ['duplicate', 'reject-short'],
  'csv-identifiers': ['quoted-comma', 'duplicate'],
});

export function makeHeldoutCases() {
  return CASE_DEFS.map((spec, caseIndex) => {
    const { stages, relevantCallIds } = buildStages(spec, caseIndex);
    const expectedFacts = clone(spec.expectedFacts);
    return {
      id: spec.id,
      taskContext: spec.taskContext,
      query: spec.query,
      stages,
      source: spec.source,
      expectedSource: spec.expectedSource,
      tests: clone(spec.tests).map((test) => REGRESSION_NAMES[spec.id].includes(test.name)
        ? { ...test, regression: true } : test),
      relevantCallIds,
      expectedFacts,
      answerSchema: schemaFor(expectedFacts),
      scoreFacts: scoreFactory(expectedFacts),
    };
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  process.stdout.write(`${json(makeHeldoutCases().map((item) => ({ id: item.id, query: item.query, stageSizes: item.stages.map((stage) => stage.length), relevantCallIds: item.relevantCallIds })))}\n`);
}
