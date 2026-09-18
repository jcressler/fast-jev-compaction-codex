#!/usr/bin/env node
const STAGES = 3;
const CALLS_PER_STAGE = 24;
const SEED = 460917;

const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (v) => JSON.stringify(v);

function pair(callId, input, output) {
  return [
    { type: 'function_call', call_id: callId, name: 'workspace_lookup', arguments: json(input) },
    { type: 'function_call_output', call_id: callId, output: json(output) },
  ];
}
function opaqueId(caseIndex, stage, index) {
  const n = (SEED + caseIndex * 1009 + stage * 149 + index * 31) >>> 0;
  return `q${n.toString(16).padStart(8, '0')}`;
}
function makeSchema(expectedFacts) {
  const properties = Object.fromEntries(Object.entries(expectedFacts).map(([key, value]) => [
    key, { type: [typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string', 'null'] },
  ]));
  return {
    type: 'object', additionalProperties: false, required: ['source', 'facts'],
    properties: {
      source: { type: 'string', minLength: 1 },
      facts: { type: 'object', additionalProperties: false, required: Object.keys(expectedFacts), properties },
    },
  };
}
function makeScorer(expectedFacts) {
  const fields = Object.keys(expectedFacts);
  return (answer) => {
    const facts = answer && typeof answer === 'object' && answer.facts && typeof answer.facts === 'object'
      ? answer.facts : answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
    const correctFields = fields.filter((field) => Object.hasOwn(facts, field)
      && json(facts[field]) === json(expectedFacts[field])).length;
    return { correctFields, totalFields: fields.length, fullyCorrect: correctFields === fields.length };
  };
}
const fillerTopics = [
  'A read-only neighboring workspace snapshot was indexed for audit.',
  'The check compared generated types and retained the result without a write.',
  'An unrelated staging sample used the same tool with a different contract.',
  'The prior diagnostic was archived after its bounded check completed.',
  'The maintainer inspected the local fixture and did not install dependencies.',
  'A report refresh completed; it does not supersede the task record.',
  'A failed plan was recorded for audit and must not be retried from this evidence.',
];
function filler(caseIndex, stage, index) {
  return {
    workspace: `corrected-maintenance-${caseIndex + 1}`, stage: stage + 1, sequence: index,
    status: index % 7 === 0 ? 'warning' : index % 5 === 0 ? 'archived' : 'observed',
    recordedAt: `2026-09-${String(4 + stage).padStart(2, '0')}T${String(8 + (index % 9)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
    summary: fillerTopics[(caseIndex + stage + index) % fillerTopics.length],
    details: `The bounded lookup recorded sample ${caseIndex + 1}-${stage + 1}-${index + 1}; this is surrounding audit context.`,
    checks: ['shape', 'typecheck', index % 3 === 0 ? 'stale-review' : 'offline-test'],
  };
}
function buildStages(spec, caseIndex) {
  const byPosition = new Map(spec.targets.map((t) => [`${t.stage}:${t.index}`, t]));
  const stages = [], relevantCallIds = [];
  for (let stage = 0; stage < STAGES; stage += 1) {
    const items = [];
    for (let index = 0; index < CALLS_PER_STAGE; index += 1) {
      const callId = opaqueId(caseIndex, stage, index);
      const target = byPosition.get(`${stage}:${index}`);
      const input = { path: `${spec.area}/record-${(index % 8) + 1}.json`, query: spec.topic, stage: stage + 1, sequence: index, seed: SEED + caseIndex };
      const output = target ? {
        workspace: `corrected-maintenance-${caseIndex + 1}`, stage: stage + 1, sequence: index,
        recordedAt: target.recordedAt, status: target.status, subject: target.subject, fact: target.fact,
        value: clone(target.value), correction: target.correction || null, failedPlan: target.failedPlan || null,
        attemptedAction: 'read-only observation', doNotRepeat: true, note: target.note,
        verification: `Historical evidence for ${spec.topic}; only an explicit later correction supersedes an earlier value.`,
      } : filler(caseIndex, stage, index);
      items.push(...pair(callId, input, output));
      if (target) relevantCallIds.push(callId);
    }
    stages.push(items);
  }
  return { stages, relevantCallIds };
}

const CACHE_SOURCE = String.raw`function solve(input) {
  const entry = (input && input.entries || []).find((item) => item && item.key === input.key);
  if (!entry) return { value: null, state: 'miss', refresh: true };
  const age = Number(input.nowMs) - Number(entry.storedAt);
  const ttl = Number(input.ttlSeconds) || 0;
  if (age <= ttl * 1000) return { value: entry.value, state: 'fresh', refresh: false };
  return { value: input.staleWhileRevalidate ? entry.value : null, state: input.staleWhileRevalidate ? 'stale' : 'miss', refresh: false };
}`;
const CACHE_EXPECTED = String.raw`function solve(input) {
  const entries = Array.isArray(input && input.entries) ? input.entries : [];
  const key = input && input.key == null ? '' : String(input.key);
  const entry = entries.find((item) => item && String(item.key) === key);
  const now = Number.isFinite(input && input.nowMs) ? input.nowMs : 0;
  const ttl = Number.isFinite(input && input.ttlSeconds) && input.ttlSeconds >= 0 ? input.ttlSeconds : 300;
  const allowStale = input && typeof input.staleWhileRevalidate === 'boolean' ? input.staleWhileRevalidate : true;
  if (!entry || !Number.isFinite(entry.storedAt)) return { value: null, state: 'miss', refresh: true };
  const fresh = now - entry.storedAt < ttl * 1000;
  if (fresh) return { value: entry.value, state: 'fresh', refresh: false };
  if (allowStale) return { value: entry.value, state: 'stale', refresh: true };
  return { value: null, state: 'miss', refresh: true };
}`;
const BATCH_SOURCE = String.raw`function solve(input) {
  const items = Array.isArray(input && input.items) ? input.items : [];
  const size = Number(input && input.maxItemsPerBatch) || 10;
  const prefix = input && input.batchIdPrefix || 'batch-';
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push({ id: prefix + batches.length, items: items.slice(i, i + size) });
  if (!batches.length) batches.push({ id: prefix + '0', items: [] });
  return { batches, batchCount: batches.length, itemCount: items.length };
}`;
const BATCH_EXPECTED = String.raw`function solve(input) {
  const items = Array.isArray(input && input.items) ? input.items.slice() : [];
  const size = Number.isInteger(input && input.maxItemsPerBatch) && input.maxItemsPerBatch > 0 ? input.maxItemsPerBatch : 3;
  const prefix = input && input.batchIdPrefix != null ? String(input.batchIdPrefix) : 'pack-';
  const allowEmpty = input && typeof input.allowEmptyBatch === 'boolean' ? input.allowEmptyBatch : false;
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push({ id: prefix + String(batches.length + 1), items: items.slice(i, i + size) });
  if (!batches.length && allowEmpty) batches.push({ id: prefix + '1', items: [] });
  return { batches, batchCount: batches.length, itemCount: items.length };
}`;
const REDACT_SOURCE = String.raw`function solve(input) {
  const keys = Array.isArray(input && input.sensitiveKeys) ? input.sensitiveKeys : [];
  const replacement = input && input.replacement || '<redacted>';
  const lines = Array.isArray(input && input.lines) ? input.lines : [];
  let count = 0;
  const out = lines.map((line) => String(line).replace(/(\b[^ =]+)=([^ ]+)/g, (all, key) => {
    if (keys.includes(key)) { count += 1; return key + '=' + replacement; }
    return all;
  }));
  return { lines: out, redactedCount: count, unchangedCount: lines.length - count };
}`;
const REDACT_EXPECTED = String.raw`function solve(input) {
  const lines = Array.isArray(input && input.lines) ? input.lines.map(String) : [];
  const keys = Array.isArray(input && input.sensitiveKeys) ? input.sensitiveKeys.map(String) : [];
  const replacement = input && input.replacement != null ? String(input.replacement) : '[REDACTED]';
  const insensitive = input && typeof input.caseInsensitive === 'boolean' ? input.caseInsensitive : true;
  const limit = Number.isInteger(input && input.maxRedactions) && input.maxRedactions >= 0 ? input.maxRedactions : 3;
  const wanted = new Set(keys.map((key) => insensitive ? key.toLowerCase() : key));
  let count = 0;
  const out = lines.map((line) => line.replace(/(^|\s)([^=\s]+)=("[^"\n]*"|[^\s]+)/g, (all, lead, key, value) => {
    if (count >= limit || !wanted.has(insensitive ? key.toLowerCase() : key)) return all;
    count += 1; return lead + key + '=' + replacement;
  }));
  return { lines: out, redactedCount: count, unchangedCount: out.filter((line, index) => line === lines[index]).length };
}`;
const MIGRATION_SOURCE = String.raw`function solve(input) {
  const config = { ...((input && input.config) || {}) };
  if (config.retry_count != null) config.retryCount = config.retry_count;
  if (config.endpoint_url != null) config.endpointUrl = config.endpoint_url;
  delete config.retry_count; delete config.endpoint_url;
  config.schemaVersion = Number(input && input.targetVersion) || 2;
  return { config, changed: true, warnings: [] };
}`;
const MIGRATION_EXPECTED = String.raw`function solve(input) {
  const original = input && input.config && typeof input.config === 'object' ? input.config : {};
  const target = Number.isInteger(input && input.targetVersion) && input.targetVersion > 0 ? input.targetVersion : 4;
  const preserveUnknown = input && typeof input.preserveUnknown === 'boolean' ? input.preserveUnknown : true;
  const config = {};
  for (const [key, value] of Object.entries(original)) {
    if (key === 'retry_count') config.retryCount = value;
    else if (key === 'endpoint_url') config.endpointUrl = value;
    else if (key === 'schema_version') config.schemaVersion = value;
    else if (['retryCount', 'endpointUrl'].includes(key) || (key !== 'schemaVersion' && preserveUnknown)) config[key] = value;
    else if (key === 'schemaVersion') config.schemaVersion = value;
  }
  const current = Number.isInteger(config.schemaVersion) ? config.schemaVersion : 0;
  if (current < target) config.schemaVersion = target;
  const changed = JSON.stringify(config) !== JSON.stringify(original);
  const warnings = current > target ? ['downgrade-blocked'] : [];
  return { config, changed, warnings };
}`;
const CASES = [
  {
    id: 'cache-expiry', area: 'cache', topic: 'cache expiry helper',
    taskContext: 'Repair solve(input) in src/cache.js. Input is an object with entries array of {key,value,storedAt}, key, nowMs, and optional ttlSeconds/staleWhileRevalidate. Use the first matching stringified key; missing entries or nonnumeric storedAt miss. Times are milliseconds; a missing/invalid nowMs is 0. A finite nonnegative ttlSeconds overrides the historical default, otherwise use that default; a boolean staleWhileRevalidate overrides its historical default. Fresh means age < ttlSeconds*1000 and returns {value:entry.value,state:"fresh",refresh:false}. Expired entries return {value:entry.value,state:"stale",refresh:true} when stale serving is enabled, otherwise {value:null,state:"miss",refresh:true}. Missing entries return that same miss. Do not mutate input.\nCurrent source:\n',
    query: 'Repair the cache expiry helper. Return JSON {source,facts}; preserve keyed lookup, strict expiry, stale-while-revalidate, refresh signaling, and input immutability.',
    source: CACHE_SOURCE, expectedSource: CACHE_EXPECTED,
    expectedFacts: { ttlSeconds: 300, staleWhileRevalidate: true, cacheNamespace: 'edge-catalog-v2' },
    requirements: ['ttlSeconds — identify the configured lifetime used for cache freshness.', 'staleWhileRevalidate — identify whether an expired value may be served while refreshing.', 'cacheNamespace — identify the cache namespace associated with this helper.'],
    targets: [
      { stage: 0, index: 5, fact: 'ttlSeconds', value: 120, subject: 'old cache policy', recordedAt: '2026-09-05T08:10:00Z', status: 'stale', correction: 'The 120-second draft was retired after the edge policy review.', note: 'This stale draft belongs to the previous catalog rollout.' },
      { stage: 1, index: 11, fact: 'cacheLookup', value: 'failed', subject: 'configuration lookup', recordedAt: '2026-09-09T12:20:00Z', status: 'failed', failedPlan: 'The remote lookup timed out; no cache configuration was changed.', note: 'Do not treat this failed lookup as a configuration value.' },
      { stage: 1, index: 18, fact: 'cacheNamespace', value: 'edge-catalog-v2', subject: 'cache identity', recordedAt: '2026-09-12T10:30:00Z', status: 'observed', note: 'The current helper is scoped to the edge catalog namespace.' },
      { stage: 1, index: 22, fact: 'staleWhileRevalidate', value: true, subject: 'stale serving policy', recordedAt: '2026-09-12T11:00:00Z', status: 'approved', note: 'The current default serves expired entries while requesting refresh.' },
      { stage: 2, index: 7, fact: 'ttlSeconds', value: 300, subject: 'cache policy', recordedAt: '2026-09-15T15:05:00Z', status: 'corrected', correction: 'The current policy supersedes the stale 120-second draft.', note: 'Use the corrected lifetime for the default when the caller omits ttlSeconds.' },
    ],
    tests: [
      { name: 'fresh', input: { entries: [{ key: 'a', value: 7, storedAt: 1000 }], key: 'a', nowMs: 2000, ttlSeconds: 3 }, expected: { value: 7, state: 'fresh', refresh: false } },
      { name: 'strict-expiry', input: { entries: [{ key: 'a', value: 7, storedAt: 1000 }], key: 'a', nowMs: 4000, ttlSeconds: 3, staleWhileRevalidate: false }, expected: { value: null, state: 'miss', refresh: true } },
      { name: 'stale-serve', input: { entries: [{ key: 'a', value: 7, storedAt: 1000 }], key: 'a', nowMs: 4000, ttlSeconds: 3, staleWhileRevalidate: true }, expected: { value: 7, state: 'stale', refresh: true } },
      { name: 'missing', input: { entries: [], key: 'a', nowMs: 1 }, expected: { value: null, state: 'miss', refresh: true } },
      { name: 'key-match', input: { entries: [{ key: 'b', value: 1, storedAt: 0 }, { key: 'a', value: 2, storedAt: 0 }], key: 'a', nowMs: 1, ttlSeconds: 3 }, expected: { value: 2, state: 'fresh', refresh: false } },
      { name: 'default-ttl', input: { entries: [{ key: 'a', value: 4, storedAt: 1000 }], key: 'a', nowMs: 301000 }, expected: { value: 4, state: 'stale', refresh: true } },
      { name: 'invalid-stored', input: { entries: [{ key: 'a', value: 4, storedAt: 'bad' }], key: 'a', nowMs: 1 }, expected: { value: null, state: 'miss', refresh: true } },
      { name: 'no-mutation', input: { entries: [{ key: 'a', value: { n: 1 }, storedAt: 0 }], key: 'a', nowMs: 1, ttlSeconds: 3 }, expected: { value: { n: 1 }, state: 'fresh', refresh: false } },
    ],
  },
  {
    id: 'batch-partition', area: 'batch', topic: 'batch partition helper',
    taskContext: 'Repair solve(input) in src/batch.js. Input is an object with items (default empty array), optional maxItemsPerBatch, batchIdPrefix, and allowEmptyBatch. Output exactly {batches,batchCount,itemCount}; each batch is {id,items}. Split into contiguous chunks without dropping, duplicating, reordering or mutating input. A positive integer size overrides the historical default; invalid/missing size uses that default. A supplied nonnull prefix is stringified, otherwise use the historical prefix. IDs are prefix plus the ONE-BASED batch number. A boolean allowEmptyBatch overrides its historical default. Empty input emits one empty batch only when that setting is true.\nCurrent source:\n',
    query: 'Repair the batch partition helper. Return JSON {source,facts}; preserve ordered lossless chunks, default sizing, stable IDs, empty-input policy, and input immutability.',
    source: BATCH_SOURCE, expectedSource: BATCH_EXPECTED,
    expectedFacts: { maxItemsPerBatch: 3, allowEmptyBatch: false, batchIdPrefix: 'pack-' },
    requirements: ['maxItemsPerBatch — identify the maximum number of items in one output batch.', 'allowEmptyBatch — identify whether empty input produces an output batch.', 'batchIdPrefix — identify the prefix used for generated batch identifiers.'],
    targets: [
      { stage: 0, index: 4, fact: 'maxItemsPerBatch', value: 8, subject: 'batch draft', recordedAt: '2026-09-05T09:00:00Z', status: 'stale', correction: 'The eight-item draft was for a different worker.', note: 'This stale limit must not become the current helper default.' },
      { stage: 1, index: 10, fact: 'batchLookup', value: 'failed', subject: 'worker configuration', recordedAt: '2026-09-09T13:40:00Z', status: 'failed', failedPlan: 'The worker configuration endpoint failed before any batch was written.', note: 'The failed plan contains no usable batch setting.' },
      { stage: 1, index: 20, fact: 'batchIdPrefix', value: 'pack-', subject: 'batch identity', recordedAt: '2026-09-12T11:25:00Z', status: 'observed', note: 'Generated identifiers use the pack namespace for this helper.' },
      { stage: 1, index: 22, fact: 'allowEmptyBatch', value: false, subject: 'empty batch policy', recordedAt: '2026-09-12T11:30:00Z', status: 'approved', note: 'The current default emits no batch for an empty item array.' },
      { stage: 2, index: 9, fact: 'maxItemsPerBatch', value: 3, subject: 'batch policy', recordedAt: '2026-09-15T16:15:00Z', status: 'corrected', correction: 'The three-item limit supersedes the stale worker draft.', note: 'Use this value when maxItemsPerBatch is absent or invalid.' },
    ],
    tests: [
      { name: 'chunks', input: { items: [1, 2, 3, 4, 5], maxItemsPerBatch: 2, batchIdPrefix: 'x-' }, expected: { batches: [{ id: 'x-1', items: [1, 2] }, { id: 'x-2', items: [3, 4] }, { id: 'x-3', items: [5] }], batchCount: 3, itemCount: 5 } },
      { name: 'exact', input: { items: [1, 2, 3], maxItemsPerBatch: 3 }, expected: { batches: [{ id: 'pack-1', items: [1, 2, 3] }], batchCount: 1, itemCount: 3 } },
      { name: 'remainder', input: { items: [1, 2, 3, 4], maxItemsPerBatch: 3 }, expected: { batches: [{ id: 'pack-1', items: [1, 2, 3] }, { id: 'pack-2', items: [4] }], batchCount: 2, itemCount: 4 } },
      { name: 'empty-default', input: { items: [] }, expected: { batches: [], batchCount: 0, itemCount: 0 } },
      { name: 'empty-opt-in', input: { items: [], allowEmptyBatch: true }, expected: { batches: [{ id: 'pack-1', items: [] }], batchCount: 1, itemCount: 0 } },
      { name: 'invalid-size', input: { items: [1, 2, 3, 4], maxItemsPerBatch: 0 }, expected: { batches: [{ id: 'pack-1', items: [1, 2, 3] }, { id: 'pack-2', items: [4] }], batchCount: 2, itemCount: 4 } },
      { name: 'objects', input: { items: [{ id: 'a' }, { id: 'b' }], maxItemsPerBatch: 1 }, expected: { batches: [{ id: 'pack-1', items: [{ id: 'a' }] }, { id: 'pack-2', items: [{ id: 'b' }] }], batchCount: 2, itemCount: 2 } },
      { name: 'no-mutation', input: { items: [1, 2], maxItemsPerBatch: 3, batchIdPrefix: 'q-' }, expected: { batches: [{ id: 'q-1', items: [1, 2] }], batchCount: 1, itemCount: 2 } },
    ],
  },
  {
    id: 'log-redaction', area: 'logs', topic: 'log redaction helper',
    taskContext: 'Repair solve(input) in src/redact.js. Input has lines and sensitiveKeys arrays (default empty), optional replacement, caseInsensitive, maxRedactions. Output exactly {lines,redactedCount,unchangedCount}. Scan whitespace-delimited key=value tokens; a double-quoted value may contain spaces but no escaped quotes or newlines. Match whole keys, preserve key/separator/leading whitespace, and replace the entire value including its quotes. Use the historical replacementToken unless replacement is supplied. Boolean caseInsensitive and nonnegative integer maxRedactions override historical defaults. The limit is global across all lines. redactedCount counts replacements; unchangedCount counts lines whose text did not change. Do not mutate input.\nCurrent source:\n',
    query: 'Repair the log redaction helper. Return JSON {source,facts}; preserve key matching, quoted values, replacement text, global limits, counts, and input immutability.',
    source: REDACT_SOURCE, expectedSource: REDACT_EXPECTED,
    expectedFacts: { maxRedactions: 3, caseInsensitive: true, replacementToken: '[REDACTED]' },
    requirements: ['maxRedactions — identify the maximum number of values one call may replace.', 'caseInsensitive — identify whether sensitive key matching ignores case.', 'replacementToken — identify the token written in place of a sensitive value.'],
    targets: [
      { stage: 0, index: 6, fact: 'maxRedactions', value: 10, subject: 'redaction draft', recordedAt: '2026-09-05T10:15:00Z', status: 'stale', correction: 'The ten-value draft was rejected for log volume reasons.', note: 'This stale limit is not the current redaction default.' },
      { stage: 1, index: 12, fact: 'redactionLookup', value: 'failed', subject: 'security configuration', recordedAt: '2026-09-09T14:05:00Z', status: 'failed', failedPlan: 'The security service timed out; no log line was modified.', note: 'A failed configuration read is not evidence of a replacement token.' },
      { stage: 1, index: 21, fact: 'replacementToken', value: '[REDACTED]', subject: 'redaction output', recordedAt: '2026-09-12T12:50:00Z', status: 'observed', note: 'The current output token is stable and is used verbatim.' },
      { stage: 1, index: 22, fact: 'caseInsensitive', value: true, subject: 'key matching policy', recordedAt: '2026-09-12T13:00:00Z', status: 'approved', note: 'The current default ignores case when comparing sensitive keys.' },
      { stage: 2, index: 8, fact: 'maxRedactions', value: 3, subject: 'redaction policy', recordedAt: '2026-09-15T17:00:00Z', status: 'corrected', correction: 'The three-value cap supersedes the stale draft.', note: 'Use this cap when maxRedactions is omitted or invalid.' },
    ],
    tests: [
      { name: 'basic', input: { lines: ['user=ann token=abc ok=yes'], sensitiveKeys: ['token'] }, expected: { lines: ['user=ann token=[REDACTED] ok=yes'], redactedCount: 1, unchangedCount: 0 } },
      { name: 'quoted', input: { lines: ['token="a value here" keep=yes'], sensitiveKeys: ['token'] }, expected: { lines: ['token=[REDACTED] keep=yes'], redactedCount: 1, unchangedCount: 0 } },
      { name: 'case', input: { lines: ['TOKEN=abc'], sensitiveKeys: ['token'] }, expected: { lines: ['TOKEN=[REDACTED]'], redactedCount: 1, unchangedCount: 0 } },
      { name: 'case-sensitive', input: { lines: ['TOKEN=abc'], sensitiveKeys: ['token'], caseInsensitive: false }, expected: { lines: ['TOKEN=abc'], redactedCount: 0, unchangedCount: 1 } },
      { name: 'limit', input: { lines: ['token=a', 'token=b', 'token=c', 'token=d'], sensitiveKeys: ['token'], maxRedactions: 3 }, expected: { lines: ['token=[REDACTED]', 'token=[REDACTED]', 'token=[REDACTED]', 'token=d'], redactedCount: 3, unchangedCount: 1 } },
      { name: 'custom', input: { lines: ['password=abc'], sensitiveKeys: ['password'], replacement: 'X' }, expected: { lines: ['password=X'], redactedCount: 1, unchangedCount: 0 } },
      { name: 'unmatched', input: { lines: ['user=ann'], sensitiveKeys: ['token'] }, expected: { lines: ['user=ann'], redactedCount: 0, unchangedCount: 1 } },
      { name: 'empty', input: { lines: [], sensitiveKeys: ['token'] }, expected: { lines: [], redactedCount: 0, unchangedCount: 0 } },
    ],
  },
  {
    id: 'version-migration', area: 'config', topic: 'version migration helper',
    taskContext: 'Repair solve(input) in src/migrate.js. Input has config (default {}), optional targetVersion and preserveUnknown. Output exactly {config,changed,warnings}. Rename retry_count to retryCount, endpoint_url to endpointUrl, and schema_version to the historical versionField; remove renamed legacy keys. Config never has conflicting old/new names. Always retain recognized camelCase keys; preserve other keys only when preserveUnknown is true. Positive integer targetVersion and boolean preserveUnknown override historical defaults. Treat missing/invalid version as 0; raise version to target but never lower it. warnings is ["downgrade-blocked"] when original version exceeds target, otherwise []. changed means output differs from original. Do not mutate input.\nCurrent source:\n',
    query: 'Repair the version migration helper. Return JSON {source,facts}; preserve legacy renames, target versioning, unknown-key policy, downgrade protection, warnings, and input immutability.',
    source: MIGRATION_SOURCE, expectedSource: MIGRATION_EXPECTED,
    expectedFacts: { targetVersion: 4, preserveUnknown: true, versionField: 'schemaVersion' },
    requirements: ['targetVersion — identify the default schema version used for upgrades.', 'preserveUnknown — identify whether unrecognized configuration keys survive migration.', 'versionField — identify the canonical output field for the schema version.'],
    targets: [
      { stage: 0, index: 5, fact: 'targetVersion', value: 2, subject: 'migration draft', recordedAt: '2026-09-05T11:05:00Z', status: 'stale', correction: 'The version-two draft was for the retired client.', note: 'This stale target must not be used as the current default.' },
      { stage: 1, index: 13, fact: 'migrationLookup', value: 'failed', subject: 'schema registry', recordedAt: '2026-09-09T15:30:00Z', status: 'failed', failedPlan: 'The registry lookup failed before any configuration write.', note: 'No migration was applied by this failed attempt.' },
      { stage: 1, index: 19, fact: 'versionField', value: 'schemaVersion', subject: 'migration schema', recordedAt: '2026-09-12T13:35:00Z', status: 'observed', note: 'The canonical output key uses the camelCase schema field.' },
      { stage: 1, index: 22, fact: 'preserveUnknown', value: true, subject: 'unknown key policy', recordedAt: '2026-09-12T13:40:00Z', status: 'approved', note: 'The current default retains unknown configuration fields.' },
      { stage: 2, index: 6, fact: 'targetVersion', value: 4, subject: 'migration policy', recordedAt: '2026-09-15T17:35:00Z', status: 'corrected', correction: 'The version-four target supersedes the stale client draft.', note: 'Use this target when targetVersion is absent or invalid.' },
    ],
    tests: [
      { name: 'rename', input: { config: { retry_count: 2, endpoint_url: '/v1' }, targetVersion: 4 }, expected: { config: { retryCount: 2, endpointUrl: '/v1', schemaVersion: 4 }, changed: true, warnings: [] } },
      { name: 'unknown-preserved', input: { config: { featureFlag: true, schemaVersion: 1 }, targetVersion: 4 }, expected: { config: { featureFlag: true, schemaVersion: 4 }, changed: true, warnings: [] } },
      { name: 'unknown-dropped-known-kept', input: { config: { featureFlag: true, retryCount: 2, endpointUrl: '/keep', schemaVersion: 1 }, targetVersion: 4, preserveUnknown: false }, expected: { config: { retryCount: 2, endpointUrl: '/keep', schemaVersion: 4 }, changed: true, warnings: [] } },
      { name: 'current', input: { config: { retryCount: 2, schemaVersion: 4 }, targetVersion: 4 }, expected: { config: { retryCount: 2, schemaVersion: 4 }, changed: false, warnings: [] } },
      { name: 'newer', input: { config: { schemaVersion: 6, x: 1 }, targetVersion: 4 }, expected: { config: { schemaVersion: 6, x: 1 }, changed: false, warnings: ['downgrade-blocked'] } },
      { name: 'legacy-version', input: { config: { schema_version: 2 }, targetVersion: 4 }, expected: { config: { schemaVersion: 4 }, changed: true, warnings: [] } },
      { name: 'default-target', input: { config: { schemaVersion: 1 } }, expected: { config: { schemaVersion: 4 }, changed: true, warnings: [] } },
      { name: 'empty', input: {}, expected: { config: { schemaVersion: 4 }, changed: true, warnings: [] } },
    ],
  }
];

function materialize(spec, index) {
  const built = buildStages(spec, index);
  const expectedFacts = clone(spec.expectedFacts);
  return {
    id: spec.id, taskContext: spec.taskContext + spec.source, query: spec.query,
    source: spec.source, expectedSource: spec.expectedSource, tests: clone(spec.tests).map(test => ({ ...test, regression: true })),
    stages: built.stages, relevantCallIds: built.relevantCallIds,
    answerSchema: makeSchema(expectedFacts), scoreFacts: makeScorer(expectedFacts),
    expectedFacts, requirements: [...spec.requirements],
  };
}

export function makeCorrectedCases() {
  return CASES.map(materialize);
}


