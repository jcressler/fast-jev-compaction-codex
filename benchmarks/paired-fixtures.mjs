#!/usr/bin/env node
/**
 * Deterministic paired continuations for evaluating Jev against local raw
 * archive search. The six cases use the same standalone-pair evidence shape and answer task;
 * only the synthetic business record and seed change.
 *
 * `expected`, `relevantCallIds`, and `score` are evaluator material. A runner
 * should pass only `query` and `items` to the model/search implementation.
 */

const CALL_COUNT = 24;
const QUERY_FIELDS = Object.freeze({
  receipt: ['receiptId', 'quantity', 'nextAction'],
  release: ['releaseId', 'revision', 'nextAction'],
  migration: ['migrationId', 'sideEffects', 'nextAction'],
});

// Shared vocabulary keeps action scoring fair across all three families. It
// is intentionally broader than any one expected answer.
const ACTION_LABELS = Object.freeze([
  null,
  'no-write',
  'retry migration',
  'rollback',
  'apply receipt',
  'retry deployment',
  'inspect evidence',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function message(role, content) {
  return { type: 'message', role, content };
}

function pair(callId, input, output) {
  return [
    { type: 'function_call', call_id: callId, name: 'synthetic_record_lookup', arguments: JSON.stringify(input) },
    { type: 'function_call_output', call_id: callId, output },
  ];
}

function answerSchema(fields, family) {
  const properties = {};
  for (const field of fields) {
    const baseType = field === 'quantity' ? 'integer' : field === 'sideEffects' ? 'boolean' : 'string';
    properties[field] = { type: [baseType, 'null'] };
    if (field === 'nextAction') {
      properties[field].enum = ACTION_LABELS;
      properties[field].description = 'Use no-write when the evidence shows the current state is already applied; use null when the action is unknown.';
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: fields,
    properties,
    title: `Synthetic ${family} decision`,
  };
}

function strictScore(expected, fields, answer) {
  const candidate = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
  let correctFields = 0;
  for (const field of fields) {
    // Missing fields must remain incorrect; undefined is never a valid match.
    if (Object.prototype.hasOwnProperty.call(candidate, field)
      && JSON.stringify(candidate[field]) === JSON.stringify(expected[field])) correctFields += 1;
  }
  return { correctFields, totalFields: fields.length, fullyCorrect: correctFields === fields.length };
}

function distractorOutput(spec, seed, index) {
  const common = {
    entity: spec.entity,
    recordType: spec.recordType,
    observedAt: `2026-09-${String(3 + (index % 5)).padStart(2, '0')}T0${index % 8}:15:00Z`,
    status: index % 2 ? 'archived' : 'informational',
    note: spec.distractors[index % spec.distractors.length],
    seed,
  };
  if (spec.family === 'receipt') {
    return { ...common, orderRef: spec.orderRef, lineCount: 2 + (index % 4), quantity: 7 + index, receiptId: `unrelated-${seed}-${index}` };
  }
  if (spec.family === 'release') {
    return { ...common, service: spec.service, releaseId: `unrelated-${seed}-${index}`, revision: `test-${seed}-${index}`, rollback: false };
  }
  return { ...common, migrationId: `unrelated-${seed}-${index}`, rowsChecked: 18 + index, sideEffects: false, retryable: false };
}

function authoritativeRecords(spec, seed) {
  const suffix = seed === 1 ? 'a7' : 'b4';
  if (spec.family === 'receipt') {
    const first = `rcpt-${suffix}-r1`;
    const corrected = `rcpt-${suffix}-r2`;
    return {
      fields: QUERY_FIELDS.receipt,
      expected: { receiptId: corrected, quantity: 113 + seed, nextAction: 'no-write' },
      records: [
        {
          phase: 'early',
          callId: `call-${spec.family}-${seed}-early`,
          input: { entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', section: 'initial' },
          output: {
            entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', receiptId: first,
            revision: 1, quantity: 140 + seed, recordedAt: '2026-09-10T09:00:00Z', status: 'approved',
            supersedes: null, note: 'Initial receipt; later corrections may supersede this revision.',
          },
        },
        {
          phase: 'middle',
          callId: `call-${spec.family}-${seed}-middle`,
          input: { entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', section: 'correction' },
          output: {
            entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', receiptId: corrected,
            revision: 2, quantity: 113 + seed, recordedAt: '2026-09-14T14:30:00Z', status: 'corrected',
            supersedes: first, correctionReason: 'two damaged trays removed from the received quantity',
          },
        },
        {
          phase: 'late',
          callId: `call-${spec.family}-${seed}-late`,
          input: { entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', section: 'final-verification' },
          output: {
            entity: spec.entity, orderRef: spec.orderRef, recordType: 'receipt', receiptId: corrected,
            revision: 2, quantity: 113 + seed, recordedAt: '2026-09-15T08:10:00Z', status: 'applied',
            supersedes: first, correctionApplied: true,
            instruction: 'Do not create or apply another receipt; the correction is already applied.',
          },
        },
      ],
    };
  }
  if (spec.family === 'release') {
    const failed = `rel-${suffix}-r1`;
    const retried = `rel-${suffix}-r2`;
    const approved = `rel-${suffix}-r3`;
    return {
      fields: QUERY_FIELDS.release,
      expected: { releaseId: approved, revision: `rev-${suffix}-c3`, nextAction: 'no-write' },
      records: [
        {
          phase: 'early',
          callId: `call-${spec.family}-${seed}-early`,
          input: { entity: spec.entity, service: spec.service, recordType: 'deployment', section: 'initial' },
          output: {
            entity: spec.entity, service: spec.service, recordType: 'deployment', releaseId: failed,
            revision: `rev-${suffix}-a1`, status: 'failed', recordedAt: '2026-09-11T11:00:00Z',
            supersedes: null, nextAction: 'retry required', failure: 'health check timed out before promotion',
          },
        },
        {
          phase: 'middle',
          callId: `call-${spec.family}-${seed}-middle`,
          input: { entity: spec.entity, service: spec.service, recordType: 'deployment', section: 'retry' },
          output: {
            entity: spec.entity, service: spec.service, recordType: 'deployment', releaseId: retried,
            revision: `rev-${suffix}-b2`, status: 'failed', recordedAt: '2026-09-13T16:20:00Z',
            supersedes: failed, nextAction: 'retry required', failure: 'artifact check failed; no promotion occurred',
          },
        },
        {
          phase: 'late',
          callId: `call-${spec.family}-${seed}-late`,
          input: { entity: spec.entity, service: spec.service, recordType: 'deployment', section: 'release-approval' },
          output: {
            entity: spec.entity, service: spec.service, recordType: 'deployment', releaseId: approved,
            revision: `rev-${suffix}-c3`, status: 'approved', recordedAt: '2026-09-15T10:45:00Z',
            supersedes: retried, promoted: true, rollback: false,
            instruction: 'Do not roll back or redeploy; this approved release is the current state.',
          },
        },
      ],
    };
  }
  const first = `mig-${suffix}-r1`;
  const retry = `mig-${suffix}-r2`;
  return {
    fields: QUERY_FIELDS.migration,
    expected: { migrationId: retry, sideEffects: false, nextAction: 'retry migration' },
    records: [
      {
        phase: 'early',
        callId: `call-${spec.family}-${seed}-early`,
        input: { entity: spec.entity, migration: spec.migration, recordType: 'migration', section: 'initial' },
        output: {
          entity: spec.entity, migration: spec.migration, recordType: 'migration', migrationId: first,
          status: 'failed', recordedAt: '2026-09-09T07:30:00Z', supersedes: null,
          sideEffects: false, nextAction: 'retry migration', failure: 'source lock expired before any write',
        },
      },
      {
        phase: 'middle',
        callId: `call-${spec.family}-${seed}-middle`,
        input: { entity: spec.entity, migration: spec.migration, recordType: 'migration', section: 'retry' },
        output: {
          entity: spec.entity, migration: spec.migration, recordType: 'migration', migrationId: retry,
          status: 'failed', recordedAt: '2026-09-13T12:05:00Z', supersedes: first,
          sideEffects: false, retryable: true, nextAction: 'retry migration',
          failure: 'preflight failed; destination remains unchanged',
        },
      },
      {
        phase: 'late',
        callId: `call-${spec.family}-${seed}-late`,
        input: { entity: spec.entity, migration: spec.migration, recordType: 'migration', section: 'final-verification' },
        output: {
          entity: spec.entity, migration: spec.migration, recordType: 'migration', migrationId: retry,
          status: 'retry-approved', recordedAt: '2026-09-15T09:40:00Z', supersedes: first,
          sideEffects: false, nextAction: 'retry migration', retryApproved: true,
          instruction: 'No migration write occurred. Retry is approved after the lock window opens; do not infer partial changes.',
        },
      },
    ],
  };
}

const SPECS = Object.freeze([
  {
    family: 'receipt', entity: 'Harborview Garden Center', orderRef: 'HGC-1742', recordType: 'receipt',
    query: 'Review the latest Harborview Garden Center receiving record for order HGC-1742. Return exactly JSON with receiptId, quantity, and nextAction. Reconcile the dated revisions, supersession, and any explicit final instruction before deciding. Use one shared canonical nextAction label: no-write, retry migration, rollback, apply receipt, retry deployment, inspect evidence, or null when unknown.',
    distractors: ['receipt search indexed; unrelated invoice has a quantity discrepancy', 'receiving dashboard refreshed with no change to the current order', 'older receipt export retained for audit and not a new revision', 'catalog count and greenhouse tray quantity are unrelated to this receipt'],
  },
  {
    family: 'release', entity: 'Harborview Garden Center', service: 'storefront-api', recordType: 'deployment',
    query: 'Review the latest Harborview Garden Center storefront-api deployment record. Return exactly JSON with releaseId, revision, and nextAction. Reconcile failed attempts, supersession, approval, and the explicit current instruction before deciding. Use one shared canonical nextAction label: no-write, retry migration, rollback, apply receipt, retry deployment, inspect evidence, or null when unknown.',
    distractors: ['deployment dashboard contains unrelated staging failures', 'release notes for a prior service are archived for audit', 'artifact inventory was refreshed without promoting anything', 'health check metrics include a separate canary deployment'],
  },
  {
    family: 'migration', entity: 'Harborview Garden Center', migration: 'inventory-to-ledger', recordType: 'migration',
    query: 'Review the latest Harborview Garden Center inventory-to-ledger migration record. Return exactly JSON with migrationId, sideEffects, and nextAction. Reconcile attempts by time and supersession, then honor the evidence about writes and retry approval. Use one shared canonical nextAction label: no-write, retry migration, rollback, apply receipt, retry deployment, inspect evidence, or null when unknown.',
    distractors: ['migration dashboard lists unrelated completed catalog imports', 'ledger audit export contains old row counts for another tenant', 'retry queue metrics are informational and do not prove side effects', 'inventory snapshot was read-only and unrelated to this migration'],
  },
]);

function makeCase(spec, seed) {
  const authoritative = authoritativeRecords(spec, seed);
  const targetByPhase = new Map(authoritative.records.map((record) => [record.phase, record]));
  const targetIndexes = new Set([4, 12, 21]);
  const items = [message('user', spec.query)];
  const relevantCallIds = [];
  let targetCursor = 0;
  for (let index = 0; index < CALL_COUNT; index += 1) {
    const target = targetIndexes.has(index);
    const callId = `call-${spec.family}-${seed}-${String(index).padStart(2, '0')}`;
    const source = target
      ? targetByPhase.get(['early', 'middle', 'late'][targetCursor++])
      : {
        input: { entity: spec.entity, recordType: spec.recordType, section: `position-${index}`, seed },
        output: distractorOutput(spec, seed, index),
      };
    if (target) relevantCallIds.push(callId);
    items.push(...pair(callId, source.input, source.output));
  }
  // A final continuation is a current user constraint and is intentionally
  // separate from the tool pairs so it remains visible under compaction.
  items.push(message('user', `Continue the ${spec.family} review for ${spec.entity}; answer only the requested JSON fields and make no external changes.`));
  const fields = authoritative.fields;
  const expected = clone(authoritative.expected);
  return {
    id: `${spec.family}-seed-${seed}`,
    query: spec.query,
    items,
    expected,
    answerSchema: answerSchema(fields, spec.family),
    score: (answer) => strictScore(expected, fields, answer),
    relevantCallIds,
  };
}

export function makePairedCases() {
  return SPECS.flatMap((spec) => [makeCase(spec, 1), makeCase(spec, 2)]);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  process.stdout.write(`${JSON.stringify(makePairedCases().map(({ id, query, items, answerSchema, relevantCallIds }) => ({ id, query, itemCount: items.length, answerSchema, relevantCallIds })))}\n`);
}
