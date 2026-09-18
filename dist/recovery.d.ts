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
    /** Diagnostic size when the complete bounded request could not be sent. */
    requestCharsAttempted?: number;
    requirements?: {
        ids: string[];
        sourceIds: string[];
        included: number;
        omitted: number;
        omittedSourceIds: string[];
    };
    reason?: string;
}
export interface RecoveryOptions {
    maxCandidates?: number;
    now?: () => number;
}
export interface RecoveryRequirement {
    id: string;
    text: string;
    source: {
        kind: 'user-message';
        entryId: string;
        turn: number;
    };
}
export interface RecoveryRequirementExtraction {
    requirements: RecoveryRequirement[];
    consideredSourceIds: string[];
    omittedSourceIds: string[];
    omittedCount: number;
}
/** Derive bounded requirement units from user messages only. */
export declare function deriveRecoveryRequirements(instructions: readonly {
    id: string;
    turn: number;
    text: string;
}[]): RecoveryRequirementExtraction;
export declare function selectRecovery(catalog: EvidenceCatalog, archivePath: string, asker: JevAsker, options?: RecoveryOptions): Promise<RecoverySelection>;
//# sourceMappingURL=recovery.d.ts.map