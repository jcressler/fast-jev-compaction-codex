import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureArchive, readCatalog, retrieveEvidence } from '../src/archive.js';
import { recoveryContext } from '../src/hooks.js';
import type { CodexItem } from '../src/codex.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-archive-'));
  roots.push(directory);
  return { directory, index: join(directory, 'index.json'), identity: { session: 'test', transcript: join(directory, 'source.jsonl'), cwd: directory } };
}
const pair = (id: string): CodexItem[] => [
  { type: 'function_call', call_id: id, name: 'deploy', arguments: '{"service":"synthetic"}' },
  { type: 'function_call_output', call_id: id, output: { receipt: `receipt-${id}`, success: true } },
];

describe('durable evidence archive', () => {
  it('keeps exact structured pairs and opaque records, deduplicating repeated captures', async () => {
    const f = await fixture();
    const records = [...pair('a'), { type: 'reasoning', encrypted_content: 'OPAQUE-TEST' }];
    const first = await captureArchive(records, f.directory, f.identity, 100);
    await captureArchive(records, f.directory, f.identity, 200);
    expect((await readCatalog(f.index)).entries).toEqual(first.entries);
    expect((await readdir(join(f.directory, 'objects'))).length).toBe(2);
    expect((await retrieveEvidence(f.index, first.entries[0]!.id)).records).toEqual(pair('a'));
    expect(recoveryContext(first, f.index)).not.toContain('OPAQUE-TEST');
  });

  it('retains concurrent captures and recovers from a stale cached index', async () => {
    const f = await fixture();
    await captureArchive(pair('initial'), f.directory, f.identity, 100);
    const oldIndex = await readFile(f.index);
    await Promise.all([
      captureArchive(pair('first'), f.directory, f.identity, 200),
      captureArchive(pair('second'), f.directory, f.identity, 300),
    ]);
    // Simulate the last writer publishing an older index; immutable manifests win.
    await writeFile(f.index, oldIndex);
    const recovered = await readCatalog(f.index);
    expect(recovered.entries.map(e => e.callId).sort()).toEqual(['first', 'initial', 'second']);
    for (const entry of recovered.entries) expect((await retrieveEvidence(f.index, entry.id)).records).toEqual(pair(entry.callId!));
    expect(recovered.updated).toBe(300);
  });

  it('rejects tampered objects and traversal IDs instead of returning unrelated data', async () => {
    const f = await fixture();
    const catalog = await captureArchive(pair('a'), f.directory, f.identity);
    const id = catalog.entries[0]!.id;
    await expect(retrieveEvidence(f.index, '../source')).rejects.toThrow('SHA-256');
    await writeFile(join(f.directory, 'objects', `${id}.json`), '[]');
    await expect(retrieveEvidence(f.index, id)).rejects.toThrow('integrity');
    await expect(captureArchive(pair('a'), f.directory, f.identity)).rejects.toThrow('conflict');
  });

  it('rejects cross-session merges without changing the earlier catalog', async () => {
    const f = await fixture();
    await captureArchive(pair('a'), f.directory, f.identity);
    const before = await readFile(f.index);
    await expect(captureArchive(pair('b'), f.directory, { ...f.identity, session: 'other' })).rejects.toThrow('identity');
    expect(await readFile(f.index)).toEqual(before);
  });

  it('keeps recent user constraints in a bounded index despite many old write failures', async () => {
    const f = await fixture();
    const records: CodexItem[] = [];
    for (let n = 0; n < 25; n++) records.push(...pair(`a${n}`));
    records.push({ type: 'message', role: 'user', content: 'Never repeat deployment. Work only on documentation.' });
    const catalog = await captureArchive(records, f.directory, f.identity);
    const context = recoveryContext(catalog, f.index, 3000);
    expect(context.length).toBeLessThanOrEqual(3000);
    expect(context).toContain('Never repeat deployment');
    for (const line of context.split('\n').filter(l => l.startsWith('{'))) {
      const selected = JSON.parse(line);
      const evidence = await retrieveEvidence(f.index, selected.id);
      if (selected.kind === 'tool') expect(evidence.records).toHaveLength(2);
    }
  });
});
