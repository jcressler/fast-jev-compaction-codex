#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'fast-jev-score-'));
try {
  const input = join(root, 'runs.json');
  await writeFile(input, JSON.stringify({ runs: [
    { mode: 'native-only', latencyMs: 10, costUsd: null, taskResults: [
      { taskId: 'a', success: true, repeatedSideEffects: null },
      { taskId: 'b', success: null },
    ] },
    { mode: 'local-recovery', latencyMs: 20, costUsd: 0, taskResults: [
      { taskId: 'a', success: true, repeatedSideEffects: 0, repeatedMistakes: 2 },
    ] },
  ] }), 'utf8');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./score.mjs', import.meta.url)), input], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'score command failed');
  const output = JSON.parse(result.stdout);
  const native = output.groups.find((group) => group.mode === 'native-only');
  const local = output.groups.find((group) => group.mode === 'local-recovery');
  if (native.taskSuccess.value !== 1 || native.taskSuccess.unknown !== 1 || native.repeatedSideEffects.value !== null) {
    throw new Error('native unknown handling failed');
  }
  if (local.taskSuccess.value !== 1 || local.repeatedSideEffects.value !== 0) {
    throw new Error('local grouped scoring failed');
  }
  if (local.repeatedMistakes.value !== 2 || native.repeatedMistakes.value !== null) throw new Error('mistake counts failed');
  console.log('score self-test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
