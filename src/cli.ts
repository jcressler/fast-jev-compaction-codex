#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JevClient } from './client.js';
import { compactCodexItems, parseCodexTranscript } from './codex.js';
import { runHook, writeNewArchive } from './hooks.js';

const HELP = `fast-jev-codex — Codex transcript pruning and recovery

  fast-jev-codex inspect --input rollout.jsonl
  fast-jev-codex compact --input rollout.jsonl --output pruned.json --allow-network
  fast-jev-codex hook       (Codex hook JSON on stdin)

inspect is offline. compact sends conversation text and tool arguments to Jev
(TypeSafe), requires TYPESAFE_API_KEY, and creates a NEW response-item archive.
It never edits a live Codex session. Existing output files are refused.
Hooks require FAST_JEV_ALLOW_NETWORK=1 as well as TYPESAFE_API_KEY.
`;

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === 'help') { console.log(HELP); return; }
  if (command === 'hook') {
    try {
      let raw = '';
      for await (const chunk of process.stdin) {
        raw += chunk.toString();
        if (raw.length > 1_000_000) throw new Error('oversized input');
      }
      console.log(JSON.stringify(await runHook(JSON.parse(raw))));
    } catch { console.log('{}'); }
    return;
  }
  if (command !== 'inspect' && command !== 'compact') throw new Error('Unknown command; use --help');
  const { values } = parseArgs({ args: process.argv.slice(3), options: {
    input: { type: 'string' }, output: { type: 'string' }, 'allow-network': { type: 'boolean' },
  } });
  if (!values.input) throw new Error('--input is required');
  if (command === 'compact') {
    if (!values.output) throw new Error('--output is required');
    if (resolve(values.input) === resolve(values.output)) throw new Error('Input and output must differ');
    try {
      await stat(values.output);
      throw new Error('Output already exists; choose a new path');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!values['allow-network']) throw new Error('--allow-network is required to send conversation data to Jev');
    if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required');
  }
  if ((await stat(values.input)).size > 64 * 1024 * 1024) throw new Error('Transcript exceeds 64 MiB');
  const items = parseCodexTranscript(await readFile(values.input, 'utf8'));
  if (command === 'inspect') {
    console.log(JSON.stringify({ items: items.length, byType: items.reduce<Record<string, number>>((counts, item) => {
      counts[item.type] = (counts[item.type] ?? 0) + 1; return counts;
    }, Object.create(null)) }, null, 2));
    return;
  }
  const result = await compactCodexItems(items, new JevClient());
  await writeNewArchive(values.output!, result.items);
  console.log(JSON.stringify({ output: resolve(values.output!), stats: result.stats }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
