import { type EvidenceCatalog } from './archive.js';
import type { JevAsker } from './types.js';
export interface RecoverySelection {
    mode: 'jev' | 'local-fallback';
    selectedIds: string[];
    requests: number;
    latencyMs: number;
    candidateCount: number;
    requestChars: number;
    model?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
    reason?: string;
}
export interface RecoveryOptions {
    maxCandidates?: number;
    now?: () => number;
}
export declare function selectRecovery(catalog: EvidenceCatalog, archivePath: string, asker: JevAsker, options?: RecoveryOptions): Promise<RecoverySelection>;
//# sourceMappingURL=recovery.d.ts.map