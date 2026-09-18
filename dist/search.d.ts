import { type EvidenceSummary } from './evidence.js';
import type { JevAsker } from './types.js';
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
        skipped: {
            id: string;
            reason: string;
        }[];
        /** True when matching entries were omitted by the result limit. */
        resultsTruncated: boolean;
    };
}
/** Searches immutable objects without rewriting archives or replaying tools.
 * Object reads are bounded; loading the cumulative catalog has its own limits.
 * A complete scan describes this page's coverage, not semantic recall.
 */
export declare function searchArchive(archivePath: string, query: string, options?: ArchiveSearchOptions): Promise<ArchiveSearchResult>;
/** Opt-in Jev reranking uses only bounded visible excerpts, never raw objects. */
export declare function rankArchiveSearch(result: ArchiveSearchResult, query: string, asker: JevAsker, limit?: number): Promise<{
    entries: ArchiveSearchHit[];
    scan: {
        resultsTruncated: boolean;
        generation: string;
        offset: number;
        scannedEntries: number;
        scannedBytes: number;
        scanBudgetBytes: number;
        complete: boolean;
        nextOffset: number | null;
        skipped: {
            id: string;
            reason: string;
        }[];
    };
    mode: "jev" | "local-fallback";
    requests: number;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}>;
//# sourceMappingURL=search.d.ts.map