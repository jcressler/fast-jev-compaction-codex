import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compactCodexItems, parseCodexTranscript } from '../dist/index.js';

// Deterministic fixture, not a measured Jev quality/performance benchmark.
const items = parseCodexTranscript(await readFile(new URL('./rollout.jsonl', import.meta.url), 'utf8'));
const fakeJev = {
  async ask(_state, questions) {
    return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, {
      noul: key.endsWith('_t1') ? 0.05 : 0.95,
    }])) };
  },
};
const { items: pruned, stats } = await compactCodexItems(items, fakeJev, { preserveRecentMessages: 2 });
assert.equal(pruned.length, items.length - 2);
assert.ok(!pruned.some(item => item.call_id === 'read-old'));
assert.ok(pruned.some(item => item.call_id === 'edit-parser'));
assert.ok(pruned.some(item => item.call_id === 'test-parser'));
assert.deepEqual(pruned.filter(item => item.type === 'message'), items.filter(item => item.type === 'message'));
console.log('Offline demo passed: stale pair removed, write/test evidence and all messages preserved.');
console.log(JSON.stringify(stats, null, 2));
