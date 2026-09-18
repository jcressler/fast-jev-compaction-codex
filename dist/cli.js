#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JevClient } from './client.js';
import { compactCodexItems, parseCodexTranscript } from './codex.js';
import { runHook, writeNewArchive } from './hooks.js';
import { captureArchive, readBounded, readCatalog, retrieveEvidence } from './archive.js';
import { rankEvidence, searchEvidence } from './evidence.js';
const HELP = `fast-jev-codex — local evidence recovery around native Codex compaction

  fast-jev-codex inspect --input rollout.jsonl
  fast-jev-codex archive --input rollout.jsonl --output evidence-directory
  fast-jev-codex search --archive evidence-directory/index.json --query "migration failure"
  fast-jev-codex retrieve --archive evidence-directory/index.json --id <full-id>
  fast-jev-codex search --archive index.json --query "question" --jev --allow-network
  fast-jev-codex hook       (Codex hook JSON on stdin, always offline)

search accepts --limit 1..100 (default 10); Jev ranks at most 20 candidates.
retrieve accepts --offset and --max-chars 1..64000 (default 12000) for large records.
Hooks and local commands need no key. Jev search requires TYPESAFE_API_KEY and
explicit --allow-network; sends query and bounded evidence/outcome excerpts to TypeSafe.

Legacy experiment: compact --input rollout.jsonl --output pruned.json --allow-network
Produces a NEW lossy response-item archive, not a resumable Codex session.
No command changes native compaction or writes the source rollout.
`;
function integer(value, fallback, min, max, label) {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max)
        throw new Error(`${label} must be an integer from ${min} to ${max}`);
    return n;
}
async function main() {
    const command = process.argv[2];
    if (!command || command === '--help' || command === 'help') {
        console.log(HELP);
        return;
    }
    if (command === 'hook') {
        try {
            let raw = '';
            for await (const chunk of process.stdin) {
                raw += chunk.toString();
                if (raw.length > 1_000_000)
                    throw new Error('oversized input');
            }
            console.log(JSON.stringify(await runHook(JSON.parse(raw))));
        }
        catch {
            console.log('{}');
        }
        return;
    }
    if (!['inspect', 'archive', 'search', 'retrieve', 'compact'].includes(command))
        throw new Error('Unknown command; use --help');
    const { values } = parseArgs({ args: process.argv.slice(3), options: {
            input: { type: 'string' }, output: { type: 'string' }, archive: { type: 'string' },
            query: { type: 'string' }, id: { type: 'string' }, limit: { type: 'string' },
            offset: { type: 'string' }, 'max-chars': { type: 'string' },
            jev: { type: 'boolean' }, 'allow-network': { type: 'boolean' },
        } });
    if (command === 'search' || command === 'retrieve') {
        if (!values.archive)
            throw new Error('--archive is required');
        if (command === 'search') {
            if (!values.query?.trim())
                throw new Error('--query is required');
            if (values.query.length > 4_000)
                throw new Error('Query exceeds 4000 characters');
            const limit = integer(values.limit, 10, 1, 100, '--limit');
            if (values.jev && !values['allow-network'])
                throw new Error('--allow-network is required for Jev ranking');
            if (values.jev && !process.env.TYPESAFE_API_KEY)
                throw new Error('TYPESAFE_API_KEY is required');
            const catalog = await readCatalog(values.archive);
            const result = values.jev
                ? await rankEvidence(catalog.entries, values.query, new JevClient(), limit)
                : { entries: searchEvidence(catalog.entries, values.query, limit), mode: 'local', requests: 0 };
            console.log(JSON.stringify({ archive: resolve(values.archive), ...result }, null, 2));
        }
        else {
            if (!values.id)
                throw new Error('--id is required');
            const offset = integer(values.offset, 0, 0, Number.MAX_SAFE_INTEGER, '--offset');
            const maxChars = integer(values['max-chars'], 12_000, 1, 64_000, '--max-chars');
            const evidence = await retrieveEvidence(values.archive, values.id);
            const serialized = JSON.stringify(evidence.records);
            if (offset > serialized.length)
                throw new Error('Offset exceeds evidence length');
            if (offset === 0 && serialized.length <= maxChars) {
                console.log(JSON.stringify({ ...evidence, totalChars: serialized.length, nextOffset: null }));
            }
            else {
                const end = Math.min(offset + maxChars, serialized.length);
                console.log(JSON.stringify({ entry: evidence.entry, content: serialized.slice(offset, end),
                    offset, totalChars: serialized.length, nextOffset: end < serialized.length ? end : null }));
            }
        }
        return;
    }
    if (!values.input)
        throw new Error('--input is required');
    if (command === 'archive' || command === 'compact') {
        if (!values.output)
            throw new Error('--output is required');
        if (resolve(values.input) === resolve(values.output) ||
            (command === 'archive' && resolve(values.input) === resolve(values.output, 'index.json'))) {
            throw new Error('Input and output must differ');
        }
    }
    if (command === 'compact') {
        try {
            await stat(values.output);
            throw new Error('Output already exists; choose a new path');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (!values['allow-network'])
            throw new Error('--allow-network is required to send conversation data to Jev');
        if (!process.env.TYPESAFE_API_KEY)
            throw new Error('TYPESAFE_API_KEY is required');
    }
    const text = await readBounded(values.input);
    if (command === 'inspect') {
        let isCatalog = false;
        try {
            isCatalog = JSON.parse(text)?.version === 2;
        }
        catch { /* JSONL */ }
        if (isCatalog) {
            const catalog = await readCatalog(values.input);
            console.log(JSON.stringify({ version: 2, entries: catalog.entries.length,
                currentEntries: catalog.currentIds.length, byKind: catalog.entries.reduce((a, e) => {
                    a[e.kind] = (a[e.kind] ?? 0) + 1;
                    return a;
                }, Object.create(null)) }, null, 2));
            return;
        }
    }
    const items = parseCodexTranscript(text);
    if (command === 'inspect') {
        console.log(JSON.stringify({ items: items.length, byType: items.reduce((counts, item) => {
                counts[item.type] = (counts[item.type] ?? 0) + 1;
                return counts;
            }, Object.create(null)) }, null, 2));
    }
    else if (command === 'archive') {
        const catalog = await captureArchive(items, values.output, {
            session: 'offline', transcript: resolve(values.input), cwd: process.cwd(),
        });
        console.log(JSON.stringify({ archive: resolve(join(values.output, 'index.json')),
            entries: catalog.entries.length, currentEntries: catalog.currentIds.length }, null, 2));
    }
    else {
        const result = await compactCodexItems(items, new JevClient());
        await writeNewArchive(values.output, result.items);
        console.log(JSON.stringify({ output: resolve(values.output), stats: result.stats,
            warning: 'Legacy lossy archive only; not a supported live Codex replacement.' }, null, 2));
    }
}
main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Command failed');
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map