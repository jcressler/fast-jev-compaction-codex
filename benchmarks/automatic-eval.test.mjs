import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boundaryAcceptance, compareEmission, commandTelemetry, eventCounts, hooksSummary, profileConfigHash, safeEnvironment } from './automatic-eval.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const context = 'Historical evidence\n{"id":"record-a"}';
const hook = (eventName, extra = {}) => ({ method: 'hook/completed', params: { threadId: 'thread-a', run: { eventName, source: 'plugin', status: 'completed', entries: eventName === 'sessionStart' ? [{ kind: 'context', text: context }] : [], ...extra } } });
const events = [hook('preCompact'), hook('sessionStart')];
const accepted = boundaryAcceptance(events, 'thread-a');
assert.equal(accepted.preCompactCount, 1);
assert.equal(accepted.sessionStartCount, 1);
assert.deepEqual(accepted.contextIds, ['record-a']);
assert.equal(boundaryAcceptance(events, 'another-thread').contexts.length, 0);
assert.equal(boundaryAcceptance([hook('sessionStart', { status: 'failed' })], 'thread-a').contexts.length, 0);
assert.equal(boundaryAcceptance([hook('sessionStart', { source: 'user' })], 'thread-a').contexts.length, 0);
const boundary = { acceptedContextIds: ['record-a'], contextSha256: [hash(context)], contextChars: [context.length], nativeAcceptance: { sessionHashes: [hash('thread-a')] } };
const selection = { generation: 'z-first', emittedIds: ['record-a'], emittedContextSha256: hash(context), sessionHash: hash('thread-a'), mode: 'jev', requests: 1 };
assert.equal(compareEmission([boundary], [{ ...selection, generation: 'a-later', emittedContextSha256: 'different' }, selection], 'pluginJev')[0].generation, 'z-first');
assert.equal(compareEmission([boundary], [selection], 'pluginJev')[0].sessionMatch, true);
assert.equal(compareEmission([boundary], [{ ...selection, emittedIds: ['wrong'] }], 'pluginJev')[0].idMatch, false);
assert.equal(compareEmission([boundary], [{ ...selection, emittedContextSha256: 'wrong' }], 'pluginJev')[0].hashMatch, false);
assert.equal(compareEmission([boundary], [{ ...selection, mode: 'local-fallback' }], 'pluginJev')[0].mode, 'local-fallback');
const completed = (item) => ({ method: 'item/completed', params: { item } });
const commands = [completed({ type: 'fileChange', status: 'completed', changes: [] }), completed({ type: 'commandExecution', command: 'node test', exitCode: 1 }), completed({ type: 'commandExecution', command: 'node test', exitCode: 0 })];
assert.equal(commandTelemetry(commands).failed, 1);
assert.equal(commandTelemetry(commands).duplicateCompleted, 1);
assert.equal(eventCounts([...events, ...commands, { ...commands[0], method: 'item/started' }]).fileChange, 1);
assert.equal(eventCounts(events).acceptedContexts, 1);
const hookDefs = [{ eventName: 'preCompact', matcher: '^(manual|auto)$' }, { eventName: 'sessionStart', matcher: '^compact$' }].map((h) => ({ ...h, enabled: true, trustStatus: 'trusted', source: 'plugin', pluginId: 'fast-jev-compaction-codex@fast-jev-compaction-codex' }));
assert.equal(hooksSummary({ data: [{ hooks: hookDefs }] }).expected, true);
assert.equal(hooksSummary({ data: [{ hooks: hookDefs.map(h => ({ ...h, source: 'user' })) }] }).expected, false);
assert.equal(hooksSummary({ data: [{ hooks: hookDefs.map(h => ({ ...h, matcher: '.*' })) }] }).expected, false);
const previous = process.env.FAST_JEV_ENDPOINT;
process.env.FAST_JEV_ENDPOINT = 'https://unexpected.invalid';
try {
  for (const mode of ['stockCodex', 'pluginLocal', 'pluginJev']) {
    const env = safeEnvironment({ path: 'profile' }, 'arm', 'data', mode);
    assert.equal(env.FAST_JEV_ENDPOINT, undefined);
    if (mode !== 'pluginJev') assert.equal(env.TYPESAFE_API_KEY, undefined);
    if (mode === 'stockCodex') assert.equal(Object.keys(env).some(k => k.startsWith('FAST_JEV_')), false);
  }
} finally { if (previous === undefined) delete process.env.FAST_JEV_ENDPOINT; else process.env.FAST_JEV_ENDPOINT = previous; }
const dir = await mkdtemp(join(tmpdir(), 'automatic-runner-selftest-'));
try {
  await writeFile(join(dir, 'config.toml'), 'model = "example"\n');
  const original = await profileConfigHash(dir);
  await writeFile(join(dir, 'config.toml'), 'model = "example"\n\n[projects."C:/test"]\ntrust_level = "trusted"\n');
  assert.equal(await profileConfigHash(dir), original);
  await writeFile(join(dir, 'config.toml'), 'model = "changed"\n');
  assert.notEqual(await profileConfigHash(dir), original);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('automatic runner self-test passed');
