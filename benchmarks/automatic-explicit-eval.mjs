#!/usr/bin/env node
/**
 * Prepared/live automatic-hook comparison.  This runner deliberately keeps
 * native event payloads and transcripts out of reports; only bounded counters,
 * hashes, and evaluator results are retained.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexEvalClient } from './codex-eval-client.mjs';

const argv = process.argv.slice(2);
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index < 0 ? fallback : argv[index + 1];
};
const unknown = new Set(['--prepare', '--execute-existing', '--live', '--allow-network', '--profiles', '--codex', '--run-dir', '--output']);
for (let index = 0; isMain && index < argv.length; index += 1) {
  if (!unknown.has(argv[index])) throw new Error(`Unknown argument: ${argv[index]}`);
  if (['--profiles', '--codex', '--run-dir', '--output'].includes(argv[index])) index += 1;
}
if (has('--execute-existing') && has('--prepare')) throw new Error('Choose --prepare or --execute-existing');
if (isMain && !has('--prepare') && !has('--execute-existing') && !has('--live')) {
  console.log('Prepared protocol. Use --prepare, then --execute-existing, or --live --allow-network --codex <binary> --run-dir <new-directory> --profiles <json>.');
  process.exit(0);
}
if (has('--live') && !has('--allow-network')) throw new Error('--live requires --allow-network');
const runDir = resolve(value('--run-dir', 'benchmarks/automatic-explicit-eval-run'));
const outputPath = value('--output', join(runDir, 'report.json'));
const codex = value('--codex', process.env.CODEX_BINARY ?? 'codex');
const fixturePath = resolve(fileURLToPath(new URL('./automatic-fixtures-v3.mjs', import.meta.url)));
const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = resolve(fileURLToPath(new URL('../src/', import.meta.url)));
const protocolPath = join(repoRoot, 'benchmarks', 'AUTOMATIC-EVAL.md');
const contractProtocolPath = join(repoRoot, 'benchmarks', 'AUTOMATIC-EXPLICIT-EVAL.md');
const evaluatorPath = fixturePath;
const bundledHookConfigText = await readFile(join(repoRoot, 'hooks', 'hooks.json'), 'utf8');
const bundledSmokePath = join(repoRoot, 'benchmarks', 'BUNDLED-SMOKE-2026-09-18.json');
const bundledSmokeText = await readFile(bundledSmokePath, 'utf8');
const bundledSmoke = JSON.parse(bundledSmokeText);
if (!Array.isArray(bundledSmoke.arms) || bundledSmoke.arms.length !== 3 || bundledSmoke.arms.some((arm) => arm.status !== 'passed' || !arm.assertions?.nativeContext || !arm.assertions?.keyExcluded)) throw new Error('Bundled native smoke proof is not a passing key-isolation/context gate');
const runtime = { node: process.version, platform: process.platform, arch: process.arch };
const baseInstructions = 'Work in the provided disposable workspace. You may retrieve only session history explicitly referenced by the recovery index. Preserve user constraints and corrections across compactions. Do not inspect evaluator files, other workspaces, or credentials.';
const thresholds = { localVsStock: { netWins: 3, distinctTasks: 2 }, jevVsStock: { netWins: 2, distinctTasks: 2, medianLatencyRatio: 1.2 }, jevVsLocal: { netWins: 2, distinctTasks: 2 }, repeatedLossAllowed: false, hardConstraintRegressionAllowed: false };
const execFile = promisify(execFileCallback);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const digestJson = (value) => digest(JSON.stringify(value));
const contractProtocolHash = digest(await readFile(contractProtocolPath));
const shortError = (error) => String(error?.message ?? error).replace(/(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 500);
const json = async (path, data, flags = {}) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, ...flags });
};

async function hashTree(root, include = () => true) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const relativePath = relative(root, path).split(sep).join('/');
        if (include(relativePath)) files.push([relativePath, digest(await readFile(path))]);
      }
    }
  }
  await visit(root);
  files.sort((a, b) => a[0].localeCompare(b[0]));
  return { files, sha256: digestJson(files) };
}

async function binaryIdentity(command) {
  try {
    let path;
    try { if (isAbsolute(command) && (await stat(command)).isFile()) path = command; } catch { /* resolve through PATH below */ }
    if (!path) {
      const located = process.platform === 'win32'
        ? (await execFile('where.exe', [command], { timeout: 5_000 })).stdout.split(/\r?\n/).find(Boolean)
        : (await execFile('which', [command], { timeout: 5_000 })).stdout.split(/\r?\n/).find(Boolean);
      path = resolve(located?.trim() || command);
    }
    const [contents, versionResult] = await Promise.all([
      readFile(path),
      execFile(path, ['--version'], { timeout: 10_000 }).catch(() => ({ stdout: '' })),
    ]);
    return { pathHash: digest(path), binaryHash: digest(contents), version: String(versionResult.stdout).trim().slice(0, 200) };
  } catch { return { pathHash: null, binaryHash: null, version: null }; }
}

export async function profileConfigHash(profilePath) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /(?:^|[\\/])(?:config|hooks|profiles?)\.(?:toml|json)$/i.test(path)) {
        let text = await readFile(path, 'utf8');
        if (/config\.toml$/i.test(path)) {
          // Codex adds per-workspace trust entries at thread start. Those
          // project records are runtime state; hooks/list validates their
          // effective trusted/plugin provenance separately.
          let inProject = false;
          text = text.split(/\r?\n/).filter((line) => {
            if (/^\s*\[projects\./i.test(line)) { inProject = true; return false; }
            if (inProject && /^\s*\[/.test(line)) inProject = false;
            if (inProject || /^\s*trust_level\s*=/.test(line)) return false;
            return true;
          }).join('\n').trim();
        }
        files.push([relative(profilePath, path).split(sep).join('/'), digest(text)]);
      }
    }
  }
  await visit(profilePath);
  files.sort((a, b) => a[0].localeCompare(b[0]));
  return digestJson(files);
}

async function parseProfiles() {
  const raw = value('--profiles');
  if (!raw) throw new Error('--profiles is required');
  let profileText = raw;
  try {
    if (raw.startsWith('@')) profileText = await readFile(resolve(raw.slice(1)), 'utf8');
    else if ((await stat(resolve(raw))).isFile()) profileText = await readFile(resolve(raw), 'utf8');
  } catch { /* The argument is inline JSON. */ }
  let parsed;
  try { parsed = JSON.parse(profileText); } catch { throw new Error('--profiles must be inline JSON or a JSON file path'); }
  const list = Array.isArray(parsed) ? parsed : Object.entries(parsed ?? {}).map(([name, path]) => ({ name, path }));
  const normalized = list.map((item, index) => typeof item === 'string' ? ({ name: ['stockCodex', 'pluginLocal', 'pluginJev'][index], path: item }) : item);
  if (normalized.length !== 3 || new Set(normalized.map((item) => item.name)).size !== 3) throw new Error('--profiles must contain stockCodex, pluginLocal, and pluginJev');
  const byName = Object.fromEntries(normalized.map((item) => [item.name, { name: item.name, path: resolve(String(item.path ?? item.CODEX_HOME ?? item.codexHome)) }]));
  for (const name of ['stockCodex', 'pluginLocal', 'pluginJev']) if (!byName[name]?.path) throw new Error(`Missing profile ${name}`);
  return byName;
}

function stagePrompt(task, stageIndex) {
  return task.stages[stageIndex]?.prompt ?? task.stages[stageIndex]?.text ?? '';
}

function scanContext(value) {
  const contexts = [];
  const seen = new Set();
  function walk(node, depth = 0) {
    if (depth > 12 || node === null || node === undefined) return;
    if (typeof node === 'string') return;
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node)) {
      if (/additionalContext/i.test(key) && typeof child === 'string') contexts.push(child);
      walk(child, depth + 1);
    }
  }
  walk(value);
  return contexts;
}

function nativeHookRuns(events, threadId) {
  const runs = [];
  for (const event of events) {
    if (event?.method !== 'hook/completed') continue;
    const run = event.params?.run;
    if (!run || typeof run !== 'object') continue;
    const identity = run.sessionId ?? run.session_id ?? run.threadId ?? run.thread_id ?? event.params?.sessionId ?? event.params?.threadId;
    const eventThread = event.params?.threadId ?? run.threadId ?? run.thread_id;
    const exactSession = identity === threadId || eventThread === threadId;
    const entries = Array.isArray(run.entries) ? run.entries : [];
    const contexts = entries.filter((entry) => entry?.kind === 'context').flatMap((entry) => {
      const text = entry.text ?? entry.content ?? entry.value ?? entry.additionalContext;
      return typeof text === 'string' && text.length > 0 ? [text] : [];
    });
    const name = String(run.hookEventName ?? run.hook_event_name ?? run.eventName ?? run.event ?? '');
    runs.push({ name, exactSession, source: run.source, status: run.status, sessionHash: typeof identity === 'string' ? digest(identity) : null, contexts });
  }
  return runs;
}

export function boundaryAcceptance(events, threadId) {
  const runs = nativeHookRuns(events, threadId);
  const valid = runs.filter((run) => run.exactSession && run.source === 'plugin' && run.status === 'completed');
  const pre = valid.filter((run) => /^preCompact$/i.test(run.name));
  const session = valid.filter((run) => /^sessionStart$/i.test(run.name));
  const contexts = session.flatMap((run) => run.contexts).filter(Boolean);
  return {
    preCompactCount: pre.filter((run) => run.exactSession).length,
    sessionStartCount: session.filter((run) => run.exactSession).length,
    exactSession: runs.every((run) => run.exactSession),
    sessionHashes: [...new Set(runs.map((run) => run.sessionHash).filter(Boolean))],
    contexts,
    contextIds: contexts.flatMap((context) => context.split('\n').flatMap((line) => {
      try { const item = JSON.parse(line); return typeof item?.id === 'string' ? [item.id] : []; } catch { return []; }
    })),
  };
}

export function eventCounts(events) {
  const counts = { commandExecution: 0, fileChange: 0, contextCompaction: 0, hookEvents: 0, acceptedContexts: 0 };
  for (const event of events) {
    if (/hook/i.test(String(event?.method ?? ''))) counts.hookEvents += 1;
    if (event?.method === 'hook/completed') counts.acceptedContexts += (event.params?.run?.entries ?? []).filter((entry) => entry.kind === 'context' && entry.text).length;
    if (event?.method !== 'item/completed') continue;
    const item = event?.params?.item;
    if (item?.type === 'commandExecution' || /commandExecution/i.test(String(item?.type ?? ''))) counts.commandExecution += 1;
    if (item?.type === 'fileChange' || /fileChange/i.test(String(item?.type ?? ''))) counts.fileChange += 1;
    if (item?.type === 'contextCompaction') counts.contextCompaction += 1;
    counts.acceptedContexts += scanContext(event).filter((text) => text.length > 0).length;
  }
  return counts;
}

export function commandTelemetry(events) {
  const records = events.filter((event) => event?.method === 'item/completed' && /commandExecution|fileChange/i.test(String(event.params?.item?.type ?? ''))).map((event) => {
    const item = event.params.item;
    const failed = Boolean(item.error) || (item.exitCode != null && Number(item.exitCode) !== 0) || ['failed', 'declined'].includes(item.status);
    return { kind: item.type, fingerprint: digestJson({ type: item.type, command: item.command ?? item.input?.command ?? null, path: item.path ?? item.input?.path ?? null, changes: item.changes ?? null }), failed };
  });
  const fingerprints = records.map((record) => record.fingerprint);
  return { completed: records.length, failed: records.filter((record) => record.failed).length, duplicateCompleted: fingerprints.length - new Set(fingerprints).size, sha256: digestJson(records.map(({ kind, fingerprint, failed }) => ({ kind, fingerprint, failed }))) };
}

export function hooksSummary(result) {
  const hooks = result?.data?.flatMap((group) => group?.hooks ?? []) ?? [];
  const names = hooks.map((hook) => ({
    eventName: hook.eventName ?? null,
    matcher: hook.matcher ?? null,
    enabled: hook.enabled !== false,
    trusted: hook.trustStatus === 'trusted',
    source: hook.source ?? null,
    pluginId: hook.pluginId ?? null,
  }));
  const pre = names.filter((hook) => /^preCompact$/i.test(String(hook.eventName)));
  const session = names.filter((hook) => /^sessionStart$/i.test(String(hook.eventName)));
  const matcherDefinitions = pre[0]?.matcher === '^(manual|auto)$' && session[0]?.matcher === '^compact$';
  const pluginProvenance = names.every((hook) => hook.source === 'plugin' && hook.pluginId === 'fast-jev-compaction-codex@fast-jev-compaction-codex');
  const expected = names.length === 2 && pre.length === 1 && session.length === 1 && matcherDefinitions && names.every((hook) => hook.enabled && hook.trusted) && pluginProvenance;
  return { count: names.length, expected, hooks: names, preCompact: pre.length, sessionStart: session.length, pluginProvenance, matcherDefinitions };
}

async function readSelectionTelemetry(dataRoot, task, workspace, threadId, transcriptPath) {
  const selections = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/selection-.*\.json$/i.test(entry.name)) {
        try {
          const item = JSON.parse(await readFile(path, 'utf8'));
          let sessionHash = null;
          let capture = null;
          let coverage = null;
          try {
            const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
            if (typeof index?.identity?.session === 'string') sessionHash = digest(index.identity.session);
            const snapshot = JSON.parse(await readFile(join(directory, 'captures', `${item.generation}.json`), 'utf8'));
            capture = { generation: snapshot.generation, records: snapshot.entries.length, valid: snapshot.generation === item.generation && snapshot.identity.session === threadId && resolve(snapshot.identity.cwd) === resolve(workspace) && resolve(snapshot.identity.transcript) === resolve(transcriptPath) };
            const targets = task.stages.slice(0, 2).map((stage, i) => ({ stage: i + 1, ids: [] }));
            const available = new Map();
            for (const name of await readdir(join(directory, 'captures'))) {
              if (!name.endsWith('.json')) continue;
              const prior = JSON.parse(await readFile(join(directory, 'captures', name), 'utf8'));
              if (prior.updated <= snapshot.updated) for (const entry of prior.entries) available.set(entry.id, entry);
            }
            for (const entry of available.values()) {
              if (entry.kind === 'opaque') continue;
              const content = await readFile(join(directory, 'objects', `${entry.id}.json`), 'utf8');
              if (digest(content) !== entry.id) throw new Error('Archive object integrity mismatch');
              for (const target of targets) if (content.includes(JSON.stringify(task.stages[target.stage - 1].prompt).slice(1, -1))) target.ids.push(entry.id);
            }
            coverage = targets.map((target) => ({ ...target, selected: target.ids.filter(id => item.selectedIds?.includes(id)), delivered: target.ids.filter(id => item.emittedIds?.includes(id)) }));
            capture.objectsVerified = true;
          } catch { if (capture) capture.valid = false; }
          selections.push({ capture, coverage,
            path: relative(dataRoot, path).split(sep).join('/'), sessionHash, generation: item.generation ?? null, mode: item.mode ?? null, selectedIds: Array.isArray(item.selectedIds) ? item.selectedIds.slice(0, 100) : [], candidateCount: Number.isFinite(item.candidateCount) ? item.candidateCount : null, requests: Number.isFinite(item.requests) ? item.requests : null, latencyMs: Number.isFinite(item.latencyMs) ? item.latencyMs : null, model: typeof item.model === 'string' ? item.model.slice(0, 120) : null, usage: item.usage && typeof item.usage === 'object' ? item.usage : null, reason: typeof item.reason === 'string' ? item.reason.slice(0, 160) : null, emittedIds: Array.isArray(item.emittedIds) ? item.emittedIds.slice(0, 100) : null, emittedContextChars: Number.isSafeInteger(item.emittedContextChars) ? item.emittedContextChars : null, emittedContextSha256: typeof item.emittedContextSha256 === 'string' ? item.emittedContextSha256 : null });
        } catch { /* malformed telemetry is recorded through the missing count */ }
      }
    }
  }
  await visit(dataRoot);
  return selections.sort((a, b) => String(a.generation).localeCompare(String(b.generation)));
}

export function compareEmission(compactions, selections, mode) {
  const unused = new Set(selections);
  return compactions.map((compaction) => {
    const nativeIds = [...new Set(compaction.acceptedContextIds ?? [])];
    const contextHash = compaction.contextSha256?.[0] ?? null;
    const selection = [...unused].find((candidate) => contextHash && candidate.emittedContextSha256 === contextHash);
    if (selection) unused.delete(selection);
    const emittedIds = selection?.emittedIds ?? [];
    const idMatch = selection !== undefined && JSON.stringify([...emittedIds].sort()) === JSON.stringify([...nativeIds].sort());
    const hashMatch = selection?.emittedContextSha256 ? selection.emittedContextSha256 === contextHash : false;
    const sessionMatch = selection?.sessionHash !== null && selection?.sessionHash !== undefined && compaction.nativeAcceptance?.sessionHashes?.includes(selection.sessionHash);
    return { generation: selection?.generation ?? null, sessionMatch, mode: selection?.mode ?? null, requests: selection?.requests ?? null, expectedMode: mode === 'pluginJev' ? 'jev' : mode === 'pluginLocal' ? 'local' : null, idMatch, hashMatch, emittedCount: emittedIds.length, nativeCount: nativeIds.length, emittedContextChars: selection?.emittedContextChars ?? null, nativeContextChars: compaction.contextChars?.[0] ?? null, reason: selection?.reason ?? null };
  });
}

export function safeEnvironment(profile, arm, dataRoot, mode) {
  const env = { ...process.env, CODEX_HOME: profile.path };
  for (const key of Object.keys(env)) if (/^FAST_JEV_/i.test(key)) delete env[key];
  if (mode !== 'stockCodex') {
    Object.assign(env, { FAST_JEV_DATA_DIR: dataRoot, FAST_JEV_MODE: mode === 'pluginLocal' ? 'local' : 'jev', FAST_JEV_ALLOW_NETWORK: mode === 'pluginJev' ? '1' : '0' });
  }
  if (mode !== 'pluginJev') delete env.TYPESAFE_API_KEY;
  // The key is inherited only by the native hook dispatcher. The report never
  // serializes this environment, and model-launched shells use Codex policy.
  return env;
}

async function runArm({ task, taskIndex, repetition, mode, profile, armRoot, fixture }) {
  const workspace = join(armRoot, 'workspace');
  const dataRoot = join(armRoot, 'recovery');
  await mkdir(armRoot, { recursive: true });
  await fixture.materializeTask(task, workspace);
  const env = safeEnvironment(profile, armRoot, dataRoot, mode);
  const client = new CodexEvalClient(codex, workspace, env, undefined, []);
  const started = Date.now();
  let threadId;
  let transcriptPath;
  let watchdogError = null;
  const watchdog = setInterval(() => {
    const counts = eventCounts(client.events);
    if (counts.commandExecution + counts.fileChange > 120) watchdogError = new Error('arm tool budget exceeded');
    if (Date.now() - started > 15 * 60 * 1000) watchdogError = new Error('arm wall-time budget exceeded');
    if (watchdogError) client.close();
  }, 250);
  const result = { taskIndex, repetition, mode, status: 'failed', stages: [], compactions: [], hookSmoke: null, hookEvents: { counts: {} }, selection: [], nativeUsage: null, toolCounts: { commandExecution: 0, fileChange: 0 }, costUsd: null };
  try {
    await client.initialize();
    console.log(JSON.stringify({ event: 'arm-start', taskIndex, repetition, mode }));
    const account = await client.request('account/read', { refreshToken: false });
    if (!account || typeof account !== 'object' || !account.account || typeof account.account !== 'object') throw new Error('account/read preflight is not authenticated');
    const config = { 'features.plugin_hooks': mode !== 'stockCodex', 'features.shell_tool': true, 'features.apps': false, 'features.multi_agent': false, 'features.memories': false, 'features.skip_host_skill_discovery': true, web_search: 'disabled', model_reasoning_effort: 'medium', shell_environment_policy: { inherit: 'core', exclude: ['TYPESAFE_API_KEY', 'FAST_JEV_*', 'OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN'] } };
    const sandboxReady = await client.request('windowsSandbox/readiness', {}).catch(() => null);
    if (!sandboxReady || String(sandboxReady.status ?? '').toLowerCase() !== 'ready') throw new Error('Windows sandbox readiness is not confirmed');
    const start = await client.request('thread/start', { cwd: workspace, ephemeral: false, model: 'gpt-5.6-luna', approvalPolicy: 'never', sandbox: 'workspace-write', selectedCapabilityRoots: [], baseInstructions, config });
    threadId = start?.thread?.id;
    if (!threadId) throw new Error('thread/start returned no thread id');
    result.threadId = threadId;
    transcriptPath = start.thread.path;
    result.sandbox = start.sandbox?.type;
    if (result.sandbox !== 'workspaceWrite') throw new Error('Effective sandbox is not workspaceWrite');
    result.hookSmoke = hooksSummary(await client.request('hooks/list', { cwds: [workspace] }));
    if (mode === 'stockCodex') result.hookSmoke.expected = result.hookSmoke.count === 0;
    if (!result.hookSmoke.expected) throw new Error(`Hook preflight failed for ${mode}`);
    const pendingBoundaries = [];
    for (let stageIndex = 0; stageIndex < task.stages.length && stageIndex < 3; stageIndex += 1) {
      console.log(JSON.stringify({ event: 'stage-start', taskIndex, repetition, mode, stage: stageIndex + 1 }));
      const stageStarted = Date.now();
      const turn = await client.turn(threadId, stagePrompt(task, stageIndex), { effort: 'medium', timeoutMs: 8 * 60 * 1000 });
      result.stages.push({ index: stageIndex, latencyMs: turn.latencyMs, toolCalls: turn.toolCalls });
      const countsAfterTurn = eventCounts(client.events);
      if (countsAfterTurn.commandExecution + countsAfterTurn.fileChange > 120) throw new Error('arm tool budget exceeded');
      if (pendingBoundaries.length) {
        const boundary = pendingBoundaries.shift();
        const acceptance = boundaryAcceptance(client.events.slice(boundary.eventStart), threadId);
        result.compactions.push({ index: boundary.index, latencyMs: boundary.latencyMs, acceptedContextCount: acceptance.contexts.length, contextChars: acceptance.contexts.map((context) => context.length), contextSha256: acceptance.contexts.map(digest), acceptedContextIds: acceptance.contextIds, nativeAcceptance: { preCompactCount: acceptance.preCompactCount, sessionStartCount: acceptance.sessionStartCount, exactSession: acceptance.exactSession, sessionHashes: acceptance.sessionHashes } });
      }
      if (stageIndex < Math.min(2, task.stages.length - 1)) {
        const eventStart = client.events.length;
        const compact = await client.compact(threadId);
        pendingBoundaries.push({ index: stageIndex, eventStart, latencyMs: compact.latencyMs });
      }
      if (Date.now() - started > 15 * 60 * 1000) throw new Error('arm wall-time budget exceeded');
      await json(join(armRoot, 'checkpoint.json'), { taskIndex, repetition, mode, stagesCompleted: result.stages.length, elapsedMs: Date.now() - started });
    }
    result.status = 'completed';
    result.nativeUsage = client.usage(threadId);
  } catch (error) {
    result.error = shortError(watchdogError ?? error);
  } finally {
    clearInterval(watchdog);
    const events = client.events.slice();
    const counts = eventCounts(events);
    result.hookEvents.counts = counts;
    result.toolCounts = { commandExecution: counts.commandExecution, fileChange: counts.fileChange };
    result.commandTelemetry = commandTelemetry(events);
    result.hookDurations = events.filter(event => event.method === 'hook/completed').map(event => ({ eventName: event.params.run?.eventName, status: event.params.run?.status, durationMs: event.params.run?.durationMs ?? null }));
    result.stockRecoveryPrefix = mode === 'stockCodex' && transcriptPath ? (await readFile(transcriptPath, 'utf8')).includes('Historical evidence saved before compaction by fast-jev-compaction-codex.') : false;
    if (threadId && !client.closed) {
      await client.request('thread/unsubscribe', { threadId }, 10_000).catch(() => {});
      await client.request('thread/archive', { threadId }, 10_000).catch(() => {});
    }
    client.close();
  }
  result.selection = await readSelectionTelemetry(dataRoot, task, workspace, threadId, transcriptPath);
  result.emissionComparison = compareEmission(result.compactions, result.selection, mode);
  result.stockContamination = mode === 'stockCodex' && (result.stockRecoveryPrefix || result.selection.length > 0 || await stat(dataRoot).then(() => true, () => false));
  try { result.quality = await fixture.scoreTask(task, workspace); } catch (error) { result.quality = { passed: false, checks: [], category: 'evaluator-error', hardConstraintViolations: [shortError(error)] }; }
  result.latencyMs = Date.now() - started;
  result.integrationValid = result.status === 'completed' && result.compactions.length === 2 && (mode === 'stockCodex'
    ? result.hookEvents.counts.hookEvents === 0 && !result.stockContamination
    : result.hookSmoke?.expected === true && result.selection.length === 2 && result.selection.every((selection) => selection.mode === (mode === 'pluginJev' ? 'jev' : 'local') && selection.requests <= 1) && result.compactions.every((compaction) => compaction.acceptedContextCount > 0 && compaction.nativeAcceptance?.preCompactCount === 1 && compaction.nativeAcceptance?.sessionStartCount === 1) && result.emissionComparison.every((item) => item.sessionMatch && item.idMatch && item.hashMatch && item.mode === item.expectedMode && (mode !== 'pluginJev' || item.requests === 1)));
  if (mode !== 'stockCodex') result.integrationValid &&= result.selection.every(selection => selection.capture?.valid && selection.capture.objectsVerified);
  await json(join(armRoot, 'report.json'), result, { flag: 'w' });
  return result;
}

async function loadFixture() {
  const module = await import(pathToFileURL(fixturePath));
  if (typeof module.createTask !== 'function' || typeof module.materializeTask !== 'function' || typeof module.scoreTask !== 'function') throw new Error('automatic-fixtures.mjs must export createTask, materializeTask, and scoreTask');
  return module;
}

async function verifyInstalled(profile, mode) {
  if (mode === 'stockCodex') return null;
  const version = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).version;
  const installed = join(profile.path, 'plugins', 'cache', 'fast-jev-compaction-codex', 'fast-jev-compaction-codex', version);
  const shipped = await hashTree(join(repoRoot, 'dist'), (path) => path.endsWith('.js'));
  const actual = await hashTree(join(installed, 'dist'), (path) => path.endsWith('.js'));
  if (actual.sha256 !== shipped.sha256 || digest(await readFile(join(installed, 'hooks', 'hooks.json'))) !== digest(bundledHookConfigText)) throw new Error(`Installed plugin differs from reviewed production files: ${mode}`);
  return actual.sha256;
}

async function main() {
const profiles = await parseProfiles();
for (const profile of Object.values(profiles)) {
  try { if (!(await stat(profile.path)).isDirectory()) throw new Error('not a directory'); }
  catch { throw new Error(`Profile path is unavailable: ${profile.name}`); }
}
if (new Set(Object.values(profiles).map((profile) => profile.path.toLowerCase())).size !== 3) throw new Error('Each arm must use a distinct isolated CODEX_HOME profile');
const fixture = await loadFixture();
const runnerHash = digest(await readFile(fileURLToPath(import.meta.url)));
const codexIdentity = await binaryIdentity(codex);
if (!codexIdentity.binaryHash) throw new Error(`Codex binary could not be resolved: ${codex}`);
const distHash = (await hashTree(join(repoRoot, 'dist'))).sha256;
const profileHashes = Object.fromEntries(await Promise.all(Object.values(profiles).map(async (profile) => [profile.name, await profileConfigHash(profile.path)])));
const installedHashes = Object.fromEntries(await Promise.all(Object.values(profiles).map(async (profile) => [profile.name, await verifyInstalled(profile, profile.name)])));
const protocolHash = digest(await readFile(protocolPath));
const clientHash = digest(await readFile(new URL('./codex-eval-client.mjs', import.meta.url)));
await mkdir(runDir, { recursive: true });
const taskCount = 6;
const repetitionCount = 2;
const armNames = ['stockCodex', 'pluginLocal', 'pluginJev'];
const tasks = [];
for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
  for (let repetition = 0; repetition < repetitionCount; repetition += 1) {
    const task = await fixture.createTask(taskIndex, repetition + 1);
    const prepared = join(runDir, 'prepared', `${taskIndex}-${repetition}`);
    if (has('--prepare')) await fixture.materializeTask(task, prepared);
    tasks.push({ taskIndex, repetition, id: task.id, hash: digestJson({ id: task.id, files: task.files, stages: task.stages }) });
  }
}
const frozen = { schemaVersion: 1, trial: 'explicit-contract-v3', status: 'prepared', protocol: { model: 'gpt-5.6-luna', effort: 'medium', stages: 3, maxCompactions: 2, maxTurnsPerStage: 8, maxToolCalls: 120, maxWallTimeMs: 15 * 60 * 1000, maxJevRequestsPerBoundary: 1, maxContextChars: 6_000, successfulJevModes: ['jev'] }, taskCount, repetitionCount, armNames, tasks, evaluatorHash: (await hashTree(dirname(evaluatorPath), (path) => ['automatic-fixtures.mjs', 'automatic-fixtures-v3.mjs'].includes(path))).sha256, runtime, runnerHash, codex: codexIdentity, distHash, bundledHookConfigHash: digest(bundledHookConfigText), bundledSmokeHash: digest(bundledSmokeText), profileConfigHashes: profileHashes, sourceHashes: { src: (await hashTree(sourceRoot, (path) => /(?:hooks|recovery|selection|archive)\.ts$/.test(path))).sha256 }, profiles: Object.fromEntries(armNames.map((name) => [name, { pathHash: digest(profiles[name].path), exists: true }])), armOrder: Array.from({ length: taskCount * repetitionCount }, (_, cell) => armNames.map((_, offset) => armNames[(cell + offset) % armNames.length])), noGo: ['native host acceptance unavailable', 'stock contamination', 'untrusted or disabled bundled hooks', 'untrusted or disabled bundled hooks', 'unverified key/shell isolation', 'fallback counted as Jev success', 'post-fork archive or trajectory reuse'] };
const manifestPath = join(runDir, 'manifest.json');
Object.assign(frozen, { protocolHash, contractProtocolHash, clientHash, installedHashes, thresholds, baseInstructions, dynamicTools: [], sandbox: 'workspace-write', approvalPolicy: 'never' });
if (has('--prepare')) {
  await writeFile(manifestPath, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, manifest: manifestPath, taskCount, repetitions: repetitionCount, arms: armNames }));
  process.exit(0);
}
if (!has('--live') && !has('--execute-existing')) throw new Error('Execution requires --live --allow-network or --execute-existing');
let manifest;
if (has('--live') && !has('--execute-existing')) {
  await writeFile(manifestPath, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  manifest = frozen;
} else {
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error(`Missing frozen manifest: ${manifestPath}`); }
}
if (manifest.evaluatorHash !== frozen.evaluatorHash || digestJson(manifest.tasks) !== digestJson(frozen.tasks)) throw new Error('Frozen manifest does not match current fixture/evaluator; prepare a new run directory');
if (manifest.sourceHashes?.src !== frozen.sourceHashes.src) throw new Error('Frozen manifest does not match current recovery implementation; prepare a new run directory');
if (manifest.runnerHash !== frozen.runnerHash || manifest.codex?.binaryHash !== frozen.codex.binaryHash || manifest.distHash !== frozen.distHash || digestJson(manifest.profileConfigHashes) !== digestJson(frozen.profileConfigHashes)) throw new Error('Frozen manifest runtime/profile hashes do not match; prepare a new run directory');
if (manifest.bundledHookConfigHash !== frozen.bundledHookConfigHash) throw new Error('Frozen manifest bundled hook definition changed; prepare a new run directory');
if (manifest.bundledSmokeHash !== frozen.bundledSmokeHash) throw new Error('Frozen manifest bundled smoke proof changed; prepare a new run directory');
if (manifest.contractProtocolHash !== frozen.contractProtocolHash) throw new Error('Frozen explicit contract protocol changed; prepare a new run directory');
if (manifest.protocolHash !== frozen.protocolHash || manifest.clientHash !== frozen.clientHash || digestJson(manifest.thresholds) !== digestJson(frozen.thresholds) || digestJson(manifest.installedHashes) !== digestJson(frozen.installedHashes)) throw new Error('Frozen protocol, client, thresholds, or installed plugin changed');
if (!has('--live') && !has('--allow-network')) throw new Error('--execute-existing requires --allow-network as an explicit execution acknowledgement');
if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('Jev key is required before starting any scored arm');
const executionLock = join(runDir, 'execution.lock');
try { await writeFile(executionLock, JSON.stringify({ startedAt: new Date().toISOString(), runnerHash }) + '\n', { flag: 'wx', mode: 0o600 }); }
catch { throw new Error(`Execution directory is already locked: ${executionLock}`); }
const reports = [];
for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
  for (let repetition = 0; repetition < repetitionCount; repetition += 1) {
    const task = await fixture.createTask(taskIndex, repetition + 1);
    for (const mode of manifest.armOrder[taskIndex * repetitionCount + repetition]) {
      try {
        if (await profileConfigHash(profiles[mode].path) !== manifest.profileConfigHashes[mode]) throw new Error(`Profile configuration changed before ${mode}`);
        if (await verifyInstalled(profiles[mode], mode) !== manifest.installedHashes[mode]) throw new Error(`Installed plugin changed before ${mode}`);
        reports.push(await runArm({ task, taskIndex, repetition, mode, profile: profiles[mode], armRoot: join(runDir, `${taskIndex}-${repetition}-${mode}`), fixture }));
      } catch (error) {
        reports.push({ taskIndex, repetition, mode, status: 'failed', error: shortError(error), quality: { passed: false, checks: [], category: 'technical-failure', hardConstraintViolations: [] }, integrationValid: false, costUsd: null });
      }
      await json(join(runDir, 'progress.json'), { schemaVersion: 1, manifest: manifestPath, completed: reports.length, total: taskCount * repetitionCount * armNames.length, reports: reports.map(({ taskIndex: i, repetition: r, mode: m, status, latencyMs, quality, integrationValid, error }) => ({ taskIndex: i, repetition: r, mode: m, status, latencyMs, quality, integrationValid, error })) });
      console.log(JSON.stringify({ event: 'arm-completed', completed: reports.length, total: 36, taskIndex, repetition, mode, status: reports.at(-1).status, integrationValid: reports.at(-1).integrationValid }));
    }
  }
}
const noGo = reports.some((report) => !report.integrationValid || (report.mode === 'pluginJev' && (report.selection ?? []).some((selection) => selection.mode !== 'jev')));
const report = { schemaVersion: 1, status: noGo ? 'no-go' : 'complete', manifest: manifestPath, reports, aggregate: { total: reports.length, completed: reports.filter((item) => item.status === 'completed').length, passed: reports.filter((item) => item.quality?.passed).length, integrationValid: reports.filter((item) => item.integrationValid).length, noGo }, privacy: { rawTranscripts: false, reasoning: false, credentials: false }, costUsd: null };
await json(resolve(outputPath), report, { flag: 'w' });
console.log(JSON.stringify({ status: report.status, total: reports.length, completed: report.aggregate.completed, passed: report.aggregate.passed, integrationValid: report.aggregate.integrationValid, noGo }));
if (noGo) process.exitCode = 1;
}
if (isMain) await main();
