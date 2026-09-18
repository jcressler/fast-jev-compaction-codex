import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildEvidenceEntries } from './evidence.js';
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export async function readBounded(path) {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES)
        throw new Error('Unsupported archive or transcript size');
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > MAX_ARCHIVE_BYTES)
        throw new Error('Archive or transcript grew beyond limit');
    return content;
}
export async function atomicJson(path, value) {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > MAX_ARCHIVE_BYTES)
        throw new Error('Archive index exceeds 64 MiB');
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
    }
    finally {
        await rm(temporary, { force: true });
    }
}
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
async function immutableFile(path, content) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        try {
            await link(temporary, path);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            if (await readBounded(path) !== content)
                throw new Error('Immutable archive object or identity conflict');
        }
    }
    finally {
        await rm(temporary, { force: true });
    }
}
function validateCatalog(value) {
    if (!value || value.version !== 2 || !value.identity ||
        !['session', 'transcript', 'cwd'].every(key => typeof value.identity[key] === 'string') ||
        typeof value.generation !== 'string' || !Number.isFinite(value.created) || !Number.isFinite(value.updated) ||
        !Array.isArray(value.entries) || !Array.isArray(value.currentIds) ||
        !value.entries.every(e => e && validId(e.id) && ['tool', 'message', 'opaque'].includes(e.kind) &&
            typeof e.summary === 'string' && typeof e.outcome === 'string' && Number.isFinite(e.turn) &&
            Array.isArray(e.flags) && e.flags.every(f => typeof f === 'string')) ||
        !value.currentIds.every(validId))
        throw new Error('Invalid evidence catalog');
    const ids = new Set(value.entries.map(e => e.id));
    if (ids.size !== value.entries.length || value.currentIds.some(id => !ids.has(id)))
        throw new Error('Invalid catalog references');
    return value;
}
function decodeCatalog(text) {
    try {
        return validateCatalog(JSON.parse(text));
    }
    catch {
        throw new Error('Invalid evidence catalog');
    }
}
function sameIdentity(a, b) {
    return a.session === b.session && a.transcript === b.transcript && a.cwd === b.cwd;
}
/** Immutable capture manifests are authoritative, so concurrent writers cannot lose evidence. */
async function mergeCaptures(directory, seed) {
    const captures = [seed];
    let names;
    try {
        names = await readdir(join(directory, 'captures'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return seed;
        throw error;
    }
    for (const name of names) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name))
            continue;
        const capture = decodeCatalog(await readBounded(join(directory, 'captures', name)));
        if (!sameIdentity(capture.identity, seed.identity))
            throw new Error('Archive identity mismatch');
        captures.push(capture);
    }
    captures.sort((a, b) => a.updated - b.updated || a.generation.localeCompare(b.generation));
    const entries = new Map();
    for (const capture of captures)
        for (const entry of capture.entries)
            entries.set(entry.id, entry);
    return { ...captures[captures.length - 1], created: Math.min(...captures.map(c => c.created)), entries: [...entries.values()] };
}
export async function readCatalog(path) {
    return mergeCaptures(dirname(resolve(path)), decodeCatalog(await readBounded(path)));
}
/** Immutable objects plus an atomic cumulative index. No live transcript is ever written. */
export async function captureArchive(items, directory, identity, now = Date.now()) {
    directory = resolve(directory);
    await mkdir(join(directory, 'objects'), { recursive: true, mode: 0o700 });
    await mkdir(join(directory, 'captures'), { recursive: true, mode: 0o700 });
    const identityPath = join(directory, 'identity.json');
    await immutableFile(identityPath, JSON.stringify(identity));
    const path = join(directory, 'index.json');
    let previous;
    try {
        previous = await readCatalog(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    if (previous && !sameIdentity(previous.identity, identity)) {
        throw new Error('Archive belongs to a different session, transcript, or workspace');
    }
    const incoming = buildEvidenceEntries(items);
    const entries = new Map();
    for (const entry of incoming) {
        const content = JSON.stringify(entry.records);
        const id = createHash('sha256').update(content).digest('hex');
        if (id !== entry.id || Buffer.byteLength(content) > MAX_ARCHIVE_BYTES)
            throw new Error('Invalid evidence object');
        const objectPath = join(directory, 'objects', `${id}.json`);
        await immutableFile(objectPath, content);
        const { records: _, ...summary } = entry;
        entries.set(id, summary);
    }
    const capture = {
        version: 2, identity, generation: randomUUID(), created: previous?.created ?? now, updated: now,
        entries: [...entries.values()], currentIds: incoming.map(e => e.id),
    };
    // Each completed manifest survives a crash before the index refresh. Atomic
    // rename hides partially written captures from readers; names are unique.
    await atomicJson(join(directory, 'captures', `${capture.generation}.json`), capture);
    const catalog = await mergeCaptures(directory, capture);
    await atomicJson(path, catalog);
    return catalog;
}
/** A hash is a local archive identifier, never a path supplied by transcript content. */
export async function retrieveEvidence(catalogPath, id) {
    if (!validId(id))
        throw new Error('Evidence ID must be a full SHA-256 identifier');
    const catalog = await readCatalog(catalogPath);
    const entry = catalog.entries.find(e => e.id === id);
    if (!entry)
        throw new Error('Evidence ID not found in this archive');
    const content = await readBounded(join(dirname(resolve(catalogPath)), 'objects', `${id}.json`));
    if (createHash('sha256').update(content).digest('hex') !== id)
        throw new Error('Evidence object integrity check failed');
    const records = JSON.parse(content);
    if (!Array.isArray(records) || !records.every(r => r && typeof r === 'object' && typeof r.type === 'string')) {
        throw new Error('Invalid evidence records');
    }
    return { entry, records: records };
}
//# sourceMappingURL=archive.js.map