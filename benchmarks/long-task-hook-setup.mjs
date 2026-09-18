import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** Uses an explicitly prepared profile. Never edits trust state or bypasses review. */
export async function configure({ env }) {
  if (!env.LONG_TASK_CODEX_HOME) throw new Error('Set LONG_TASK_CODEX_HOME to an isolated profile with reviewed hooks.');
  env.CODEX_HOME = resolve(env.LONG_TASK_CODEX_HOME);
  await access(join(env.CODEX_HOME, 'hooks.json'));
  return { configArgs: ['--enable', 'plugin_hooks'], config: { 'features.plugin_hooks': true } };
}
