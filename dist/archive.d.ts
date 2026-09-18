import type { CodexItem } from './codex.js';
import { type EvidenceSummary } from './evidence.js';
export declare const MAX_ARCHIVE_BYTES: number;
export interface ArchiveIdentity {
    session: string;
    transcript: string;
    cwd: string;
}
export interface EvidenceCatalog {
    version: 2;
    identity: ArchiveIdentity;
    generation: string;
    created: number;
    updated: number;
    entries: EvidenceSummary[];
    currentIds: string[];
}
export declare function readBounded(path: string): Promise<string>;
export declare function atomicJson(path: string, value: unknown): Promise<void>;
export declare function readCatalog(path: string): Promise<EvidenceCatalog>;
/** Immutable objects plus an atomic cumulative index. No live transcript is ever written. */
export declare function captureArchive(items: CodexItem[], directory: string, identity: ArchiveIdentity, now?: number): Promise<EvidenceCatalog>;
/** A hash is a local archive identifier, never a path supplied by transcript content. */
export declare function retrieveEvidence(catalogPath: string, id: string): Promise<{
    entry: EvidenceSummary;
    records: CodexItem[];
}>;
//# sourceMappingURL=archive.d.ts.map