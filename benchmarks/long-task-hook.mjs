#!/usr/bin/env node
/** Evaluation-only bridge. Codex dispatches these hooks; the runner never invokes them manually. */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runHook, checkpointPaths, readRecoveryRun } from '../dist/hooks.js';
import { readCatalog } from '../dist/archive.js';

try {
  const profile = JSON.parse(await readFile(process.argv[2], 'utf8'));
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('hook input too large');
  }
  const input = JSON.parse(raw);
  const env = { ...process.env, FAST_JEV_DATA_DIR: profile.data,
    FAST_JEV_MODE: profile.mode === 'local' ? 'local' : 'jev',
    FAST_JEV_ALLOW_NETWORK: profile.mode === 'local' ? '0' : '1' };
  const dependencies = { env };
  if (profile.mode === 'candidate-order') {
    // Explicit offline ablation, not a simulated live Jev result.
    env.TYPESAFE_API_KEY = 'in-process-offline-ablation';
    dependencies.asker = { ask: async (_state, questions) => ({ model: 'offline-equal-scores',
      answers: Object.fromEntries(Object.keys(questions).map(key => [key, { noul: 0.5 }])) }) };
  }
  const started = Date.now();
  const output = await runHook(input, dependencies);
  if (profile.mode === 'candidate-order' && output.hookSpecificOutput?.additionalContext) {
    output.hookSpecificOutput.additionalContext = output.hookSpecificOutput.additionalContext
      .replace('Selection: jev.', 'Selection: candidate-order (offline control).');
  }
  let selection = null;
  if (input.transcript_path) {
    const { archive } = checkpointPaths(input, env);
    try { selection = await readRecoveryRun(await readCatalog(archive), archive) ?? null; } catch { /* no archive */ }
  }
  const context = output.hookSpecificOutput?.additionalContext ?? '';
  await appendFile(profile.log, JSON.stringify({ event: input.hook_event_name, source: input.source,
    session: input.session_id, transcriptPresent: Boolean(input.transcript_path), mode: profile.mode,
    latencyMs: Date.now() - started, contextChars: context.length,
    contextHash: context ? createHash('sha256').update(context).digest('hex') : null,
    actualJevRequests: input.hook_event_name === 'PreCompact' && profile.mode === 'jev' ? selection?.requests ?? 0 : 0,
    selection: selection ? { ...selection,
      ...(profile.mode === 'candidate-order' ? { mode: 'candidate-order', requests: 0, model: null } : {}) } : null,
    diagnostic: output.systemMessage ?? null }) + '\n', { mode: 0o600 });
  if (context) await appendFile(join(profile.data, 'delivered-contexts.jsonl'), JSON.stringify({
    generation: selection?.generation, context }) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(output));
} catch {
  console.log(JSON.stringify({ systemMessage: 'Evaluation recovery hook unavailable.' }));
}
