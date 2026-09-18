#!/usr/bin/env node
/** One synthetic hook handoff. This does not launch Codex or measure task quality. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkpointPaths, readRecoveryRun, runHook } from '../dist/hooks.js';
import { readCatalog, retrieveEvidence } from '../dist/archive.js';
import { JevClient } from '../dist/client.js';
import { fixtureItems } from './jev-trial.mjs';

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const outputAt = argv.indexOf('--output');
const output = outputAt < 0 ? undefined : argv[outputAt + 1];
const allowed = new Set(['--live', '--allow-network', '--output']);
for (let i = 0; i < argv.length; i++) {
  if (!allowed.has(argv[i])) throw new Error('Unknown argument');
  if (argv[i] === '--output') i++;
}
if (outputAt >= 0 && (!output || output.startsWith('--'))) throw new Error('--output needs a path');
if (live && (!argv.includes('--allow-network') || !process.env.TYPESAFE_API_KEY)) {
  throw new Error('Live mode requires --allow-network and TYPESAFE_API_KEY');
}
const digest = value => createHash('sha256').update(value).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'jev-auto-check-'));
try {
  const transcript = join(root, 'synthetic.jsonl');
  const items = fixtureItems('Recover the approved pickup window and completed receipt. Keep supplier uploads disabled. Avoid repeating the failed patch.');
  items.push({ type: 'reasoning', content: 'PRIVATE_REASONING_SENTINEL' });
  const transcriptText = items.map(payload => JSON.stringify({ type: 'response_item', payload })).join('\n') + '\n';
  await writeFile(transcript, transcriptText);
  const sourceHash = digest(transcriptText);
  const sourceFiles = ['dist/hooks.js', 'dist/recovery.js', 'dist/selection.js', 'benchmarks/automatic-hook-check.mjs'];
  const implementationHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path =>
    [path, digest(await readFile(new URL(`../${path}`, import.meta.url)))])));
  const env = { FAST_JEV_DATA_DIR: join(root, 'data'), FAST_JEV_MODE: 'jev', FAST_JEV_ALLOW_NETWORK: '1',
    TYPESAFE_API_KEY: live ? process.env.TYPESAFE_API_KEY : 'offline-test-only' };
  const client = live ? new JevClient({ apiKey: env.TYPESAFE_API_KEY, timeoutMs: 15_000 }) : undefined;
  let calls = 0;
  let request;
  let response;
  const asker = { ask: async (state, questions) => {
    assert.equal(++calls, 1, 'Only one selection call is permitted');
    request = { state, questions };
    assert(!JSON.stringify(request).includes('PRIVATE_REASONING_SENTINEL'));
    response = client ? await client.ask(state, questions) : {
      model: 'offline-equal-scores',
      answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.5 }])),
    };
    return response;
  } };
  const input = { hook_event_name: 'PreCompact', session_id: 'synthetic-automatic-check',
    transcript_path: transcript, cwd: root, trigger: 'manual' };
  assert.deepEqual(await runHook(input, { env, asker }), {});
  assert.equal(calls, 1);
  const { archive } = checkpointPaths(input, env);
  const catalog = await readCatalog(archive);
  const selected = await readRecoveryRun(catalog, archive);
  assert.equal(selected?.mode, 'jev', 'Fallback cannot count as a successful Jev check');
  assert(selected.requirements.included > 0 && selected.requirements.included <= 6);
  assert.equal(selected.requirements.included, request.state.requirements.length);
  assert.equal(Object.keys(request.questions).length, selected.candidateCount * (1 + selected.requirements.included));
  assert.equal(selected.requestChars, JSON.stringify(request).length);
  const compact = { ...input, hook_event_name: 'SessionStart', source: 'compact' };
  const restored = await runHook(compact, { env, asker });
  const context = restored.hookSpecificOutput.additionalContext;
  assert(context.length > 0 && context.length <= 6_000);
  assert(context.includes('Selection: jev.'));
  assert(!context.includes('PRIVATE_REASONING_SENTINEL'));
  const emittedIds = context.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line).id);
  const emitted = await readRecoveryRun(catalog, archive);
  assert.deepEqual(emitted.emittedIds, emittedIds);
  assert.equal(emitted.emittedContextChars, context.length);
  assert.equal(emitted.emittedContextSha256, digest(context));
  assert.deepEqual(await runHook(compact, { env, asker }), {});
  assert.equal(calls, 1);
  assert.equal(digest(await readFile(transcript)), sourceHash);
  for (const id of emittedIds) assert((await retrieveEvidence(archive, id)).records.length > 0);
  for (const [path, hash] of Object.entries(implementationHashes)) {
    assert.equal(digest(await readFile(new URL(`../${path}`, import.meta.url))), hash);
  }
  const report = {
    schema: 1, check: 'automatic-recovery-hook-handoff', passed: true,
    liveJev: live, actualJevRequests: live ? calls : 0, offlineAskerCalls: live ? 0 : calls,
    nativeCompactionTriggered: false, hostContextAcceptanceVerified: false,
    qualityComparison: false, implementationHashes,
    selection: emitted, sourceUnchanged: true, consumedOnce: true,
    emittedReferencesVerified: emittedIds.length,
    requestAudit: { candidateCount: request.state.candidates.length,
      requirementCount: request.state.requirements.length, questionCount: Object.keys(request.questions).length,
      state: request.state, questions: request.questions, answers: response.answers },
    limits: ['Synthetic fixture previously used in development, not held-out quality evidence.',
      'Invokes production hook functions directly; native host dispatch is a separate smoke.',
      'An emitted record ID does not guarantee its bounded excerpt contains the needed fact.'],
  };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  assert(!serialized.includes(env.TYPESAFE_API_KEY));
  if (output) await writeFile(resolve(output), serialized, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: true, liveJev: live, actualJevRequests: report.actualJevRequests,
    candidates: selected.candidateCount, requirements: selected.requirements.included,
    emittedReferences: emittedIds.length, model: emitted.model, usage: emitted.usage,
    nativeCompactionTriggered: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
