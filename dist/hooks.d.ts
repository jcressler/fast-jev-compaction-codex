import { type EvidenceCatalog } from './archive.js';
import { type RecoverySelection } from './recovery.js';
import type { JevAsker } from './types.js';
export interface HookInput {
    hook_event_name: string;
    session_id: string;
    transcript_path: string | null;
    cwd: string;
    source?: string;
}
export interface HookDependencies {
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    asker?: JevAsker;
}
export type RecoveryRun = Omit<RecoverySelection, 'mode'> & {
    version: 1;
    generation: string;
    mode: RecoverySelection['mode'] | 'local';
    /** What SessionStart emitted, not proof that a model consumed the context. */
    emittedIds?: string[];
    emittedContextChars?: number;
    emittedContextSha256?: string;
};
/** Metadata only: no key, raw record, task prompt, or provider error is persisted here. */
export declare function readRecoveryRun(catalog: EvidenceCatalog, archive: string): Promise<RecoveryRun | undefined>;
export declare function checkpointPaths(input: HookInput, env: NodeJS.ProcessEnv): {
    directory: string;
    archive: string;
    pending: string;
};
/** A small retrieval index, not replacement history. Whole paired references only. */
export declare function recoveryContext(catalog: EvidenceCatalog, archive: string, maxChars?: number, selection?: Pick<RecoveryRun, 'mode' | 'selectedIds'>): string;
/** Capture first; optional Jev selection never changes native history or blocks compaction. */
export declare function runHook(value: unknown, dependencies?: HookDependencies): Promise<object>;
export declare function writeNewArchive(path: string, content: unknown): Promise<void>;
//# sourceMappingURL=hooks.d.ts.map