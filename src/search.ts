import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readCatalog } from './archive.js';
import { rankEvidence, type EvidenceSummary } from './evidence.js';
import type { CodexItem } from './codex.js';
import type { JevAsker } from './types.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OBJECT_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 128;
const MAX_NODES = 20_000;
const MAX_TEXT_CHARS = 4 * 1024 * 1024;
const MAX_MATCHES = 3;
const MATCH_CHARS = 280;

export interface ArchiveSearchOptions {
  limit?: number;
  /** Cursor over non-opaque catalog entries, not over ranked search results. */
  offset?: number;
  maxBytes?: number;
  maxObjectBytes?: number;
  maxEntries?: number;
}

export interface EvidenceMatch {
  recordIndex: number;
  field: 'input' | 'output' | 'message';
  text: string;
}

export interface ArchiveSearchHit extends EvidenceSummary {
  matches: EvidenceMatch[];
  matchedTerms: string[];
}

export interface ArchiveSearchResult {
  entries: ArchiveSearchHit[];
  scan: {
    generation: string;
    offset: number;
    scannedEntries: number;
    scannedBytes: number;
    scanBudgetBytes: number;
    complete: boolean;
    nextOffset: number | null;
    skipped: { id: string; reason: string }[];
    /** True when matching entries were omitted by the result limit. */
    resultsTruncated: boolean;
  };
}

function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return result;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Decode structured tool output locally, keeping each text block separate. Bounds
// apply even to nested JSON strings. Never traverse image/audio/reasoning payloads.
function visibleText(records: CodexItem[]): { chunks: EvidenceMatch[]; complete: boolean; visible: boolean } {
  const chunks: EvidenceMatch[] = [];
  let nodes = 0, chars = 0, complete = true, visible = false;
  function walk(value: unknown, recordIndex: number, field: EvidenceMatch['field'], depth = 0, key = ''): void {
    if (++nodes > MAX_NODES || depth > 24 || chars >= MAX_TEXT_CHARS) { complete = false; return; }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^[\[{"]/.test(trimmed)) {
        try {
          const decoded: unknown = JSON.parse(trimmed);
          if (decoded !== value) { walk(decoded, recordIndex, field, depth + 1, key); return; }
        } catch { /* Ordinary text, including incomplete JSON. */ }
      }
      const text = `${key ? `${key}: ` : ''}${value}`;
      const allowed = Math.max(0, MAX_TEXT_CHARS - chars);
      if (text.length > allowed) complete = false;
      chunks.push({ recordIndex, field, text: text.slice(0, allowed) });
      chars += Math.min(text.length, allowed);
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (nodes >= MAX_NODES || chars >= MAX_TEXT_CHARS) { complete = false; break; }
        walk(child, recordIndex, field, depth + 1, key);
      }
    } else if (object(value)) {
      if (value.channel === 'analysis' || value.role === 'system' || value.role === 'developer' ||
          (typeof value.type === 'string' && /(?:reasoning|analysis|image|audio|video|opaque|encrypted|^system$|^developer$)/i.test(value.type))) return;
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === 'type' && /^(?:input_text|output_text|text)$/.test(String(child))) continue;
        if (/^(?:encrypted_content|reasoning|reasoning_content|reasoning_text|analysis)$/i.test(childKey)) continue;
        if (nodes >= MAX_NODES || chars >= MAX_TEXT_CHARS) { complete = false; break; }
        walk(child, recordIndex, field, depth + 1, childKey);
      }
    } else if (value !== undefined && value !== null) {
      walk(String(value), recordIndex, field, depth + 1, key);
    }
  }
  records.forEach((record, recordIndex) => {
    if (record.channel === 'analysis' || record.role === 'system' || record.role === 'developer') return;
    if (record.type === 'function_call' || record.type === 'custom_tool_call') {
      visible = true;
      walk(record.arguments ?? record.input, recordIndex, 'input');
    } else if (record.type === 'function_call_output' || record.type === 'custom_tool_call_output') {
      visible = true;
      walk(record.output, recordIndex, 'output');
    } else if (record.type === 'message' && (record.role === 'user' || record.role === 'assistant')) {
      visible = true;
      walk(record.content ?? record.text, recordIndex, 'message');
    }
  });
  return { chunks, complete, visible };
}

/** Searches immutable objects without rewriting archives or replaying tools.
 * Object reads are bounded; loading the cumulative catalog has its own limits.
 * A complete scan describes this page's coverage, not semantic recall.
 */
export async function searchArchive(archivePath: string, query: string, options: ArchiveSearchOptions = {}): Promise<ArchiveSearchResult> {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Query must not be empty');
  if (query.length > 4_000) throw new Error('Query exceeds 4000 characters');
  const phrase = query.trim().toLowerCase();
  const terms = [...new Set(phrase.match(/[\p{L}\p{N}][\p{L}\p{N}_.:/-]*/gu) ?? [phrase])];
  if (terms.length > 64) throw new Error('Query exceeds 64 distinct terms');
  const limit = integer(options.limit, 10, 1, 100, 'limit');
  const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
  const maxBytes = integer(options.maxBytes, MAX_BYTES, 1, MAX_BYTES, 'maxBytes');
  const maxObjectBytes = integer(options.maxObjectBytes, MAX_OBJECT_BYTES, 1, MAX_OBJECT_BYTES, 'maxObjectBytes');
  const maxEntries = integer(options.maxEntries, MAX_ENTRIES, 1, MAX_ENTRIES, 'maxEntries');
  const catalog = await readCatalog(archivePath);
  const entries = catalog.entries.filter(entry => entry.kind !== 'opaque');
  if (offset > entries.length) throw new Error('Offset exceeds catalog length');
  const scan: ArchiveSearchResult['scan'] = { generation: catalog.generation, offset, scannedEntries: 0,
    scannedBytes: 0, scanBudgetBytes: maxBytes, complete: true, nextOffset: null, skipped: [], resultsTruncated: false };
  const hits: { entry: ArchiveSearchHit; score: number; index: number }[] = [];
  let cursor = offset;
  for (; cursor < entries.length && scan.scannedEntries < maxEntries; cursor++) {
    const entry = entries[cursor]!;
    let records: CodexItem[];
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let budgetStop = false;
    try {
      if (!/^[a-f0-9]{64}$/.test(entry.id)) throw new Error('invalid-id');
      handle = await open(join(dirname(archivePath), 'objects', `${entry.id}.json`), 'r');
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('not-file');
      if (info.size > maxObjectBytes) throw new Error('object-byte-limit');
      if (info.size > maxBytes - scan.scannedBytes) { budgetStop = true; throw new Error('scan-byte-budget'); }
      const buffer = Buffer.alloc(info.size);
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
        scan.scannedBytes += bytesRead;
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (count !== info.size || (await handle.stat()).size !== info.size ||
          createHash('sha256').update(buffer).digest('hex') !== entry.id) throw new Error('integrity-mismatch');
      const parsed: unknown = JSON.parse(buffer.toString('utf8'));
      if (!Array.isArray(parsed) || !parsed.every(record => object(record) && typeof record.type === 'string')) throw new Error('invalid-records');
      records = parsed as CodexItem[];
    } catch (error) {
      const known = ['invalid-id', 'not-file', 'object-byte-limit', 'scan-byte-budget', 'integrity-mismatch', 'invalid-records'];
      const reason = error instanceof Error && known.includes(error.message) ? error.message : 'unreadable-object';
      scan.skipped.push({ id: entry.id, reason });
      scan.complete = false;
      if (budgetStop) break;
      scan.scannedEntries++;
      continue;
    } finally { await handle?.close(); }
    scan.scannedEntries++;
    const extracted = visibleText(records);
    if (!extracted.complete) { scan.complete = false; scan.skipped.push({ id: entry.id, reason: 'text-extraction-limit' }); }
    if (!extracted.visible) continue;
    // Historical summaries can contain a flattened opaque content block. Build
    // display excerpts from the same filtered text we search, leaving disk intact.
    const summary = entry.kind === 'message'
      ? (extracted.chunks.find(chunk => chunk.field === 'message')?.text ?? '').slice(0, 160)
      : `${entry.tool ?? 'Tool result'} ${extracted.chunks.find(chunk => chunk.field === 'input')?.text ?? ''}`.trim().slice(0, 160);
    const outcome = (extracted.chunks.find(chunk => chunk.field === 'output')?.text ?? '').slice(0, 240);
    const metadata = [entry.id, entry.callId, entry.tool, ...entry.flags].join(' ').toLowerCase();
    const matched = new Set(terms.filter(term => metadata.includes(term)));
    let exact = metadata.includes(phrase);
    const windows: { match: EvidenceMatch; terms: string[]; exact: boolean; index: number }[] = [];
    // Prefer query-centered result evidence to tool inputs for equally good hits.
    const chunks = extracted.chunks.sort((a, b) => (a.field === 'input' ? 1 : 0) - (b.field === 'input' ? 1 : 0));
    for (const chunk of chunks) {
      const folded = chunk.text.toLowerCase();
      const found = terms.filter(term => folded.includes(term));
      found.forEach(term => matched.add(term));
      exact ||= folded.includes(phrase);
      const positions = [...new Set(found.map(term => folded.indexOf(term)))].sort((a, b) => a - b);
      let previousEnd = -1;
      for (const position of positions) {
        if (position < previousEnd) continue;
        const start = Math.max(0, position - 40), end = Math.min(chunk.text.length, start + MATCH_CHARS - 2);
        const text = `${start ? '…' : ''}${chunk.text.slice(start, end)}${end < chunk.text.length ? '…' : ''}`;
        previousEnd = end;
        const foldedWindow = text.toLowerCase();
        windows.push({ match: { ...chunk, text }, terms: found.filter(term => foldedWindow.includes(term)),
          exact: foldedWindow.includes(phrase), index: windows.length });
      }
    }
    if (!matched.size) continue;
    const represented = new Set<string>();
    const matches: EvidenceMatch[] = [];
    while (matches.length < MAX_MATCHES && windows.length) {
      windows.sort((a, b) => b.terms.filter(term => !represented.has(term)).length - a.terms.filter(term => !represented.has(term)).length ||
        Number(b.exact) - Number(a.exact) || a.index - b.index);
      const best = windows.shift()!;
      best.terms.forEach(term => represented.add(term));
      matches.push(best.match);
    }
    hits.push({ entry: { ...entry, summary, outcome, matches, matchedTerms: terms.filter(term => matched.has(term)) },
      score: matched.size * 100 + (exact ? 10 : 0), index: cursor });
  }
  if (cursor < entries.length) { scan.complete = false; scan.nextOffset = cursor; }
  scan.resultsTruncated = hits.length > limit;
  return { entries: hits.sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map(hit => hit.entry), scan };
}

/** Opt-in Jev reranking uses only bounded visible excerpts, never raw objects. */
export async function rankArchiveSearch(result: ArchiveSearchResult, query: string, asker: JevAsker, limit = 10) {
  integer(limit, 10, 1, 100, 'limit');
  const pool = result.entries.slice(0, 20);
  const ranked = await rankEvidence(pool.map(entry => ({ ...entry,
    outcome: entry.matches.find(match => match.field !== 'input')?.text ?? entry.outcome })), query, asker, limit);
  // Failures retain the stronger local order, including Unicode-only matches.
  const entries = ranked.mode === 'local-fallback' ? pool.slice(0, limit) : ranked.entries.map(entry => pool.find(hit => hit.id === entry.id)!);
  return { ...ranked, entries, scan: { ...result.scan,
    resultsTruncated: result.scan.resultsTruncated || result.entries.length > entries.length } };
}
