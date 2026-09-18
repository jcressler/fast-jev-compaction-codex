import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureArchive, parseCodexTranscript, readCatalog, retrieveEvidence, searchEvidence } from '../dist/index.js';

// Offline evidence recovery demo. No model calls and no live session edits.
const items = parseCodexTranscript(await readFile(new URL('./rollout.jsonl', import.meta.url), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'fast-jev-local-demo-'));
try {
  const identity = { session: 'synthetic-demo', transcript: '/example/rollout.jsonl', cwd: '/example/project' };
  const first = await captureArchive(items, directory, identity, 100);
  const original = first.entries.find(entry => entry.callId === 'test-parser');
  assert.ok(original);
  // The next active window no longer contains the old tool evidence.
  await captureArchive([{ type: 'message', role: 'user', content: 'Report the earlier parser test result.' }], directory, identity, 200);
  const archive = join(directory, 'index.json');
  const catalog = await readCatalog(archive);
  const selected = searchEvidence(catalog.entries, 'test-parser', 1)[0];
  assert.equal(selected.id, original.id);
  const recovered = await retrieveEvidence(archive, selected.id);
  assert.equal(recovered.records[1].output, 'PASS parser.test.ts: 12 tests passed.');
  assert.equal(recovered.records.length, 2);
  console.log('Offline demo passed: an old test result and its call survived a later capture and were retrieved by stable ID.');
  console.log(JSON.stringify({ entries: catalog.entries.length, recoveredCall: selected.callId, outcome: selected.outcome, networkRequests: 0 }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
