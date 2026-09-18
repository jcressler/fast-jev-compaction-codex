import type { JevAsker } from './types.js';
import type { CodexItem } from './codex.js';
export interface EvidenceEntry {
    id: string;
    kind: 'tool' | 'message' | 'opaque';
    callId?: string;
    tool?: string;
    turn: number;
    summary: string;
    outcome: string;
    flags: string[];
    records: CodexItem[];
    role?: 'user' | 'assistant';
}
export type EvidenceSummary = Omit<EvidenceEntry, 'records'>;
/**
 * Builds a lossless local index. Heuristic flags are deliberately broad hints,
 * not security or correctness guarantees; records remain the authoritative data.
 */
export declare function buildEvidenceEntries(items: readonly CodexItem[]): EvidenceEntry[];
export declare function searchEvidence(entries: readonly EvidenceSummary[], query: string, limit?: number): EvidenceSummary[];
export declare function rankEvidence(entries: readonly EvidenceSummary[], query: string, asker: JevAsker, limit?: number): Promise<{
    entries: EvidenceSummary[];
    mode: 'jev' | 'local-fallback';
    requests: number;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
}>;
//# sourceMappingURL=evidence.d.ts.map