import { type EvidenceCatalog } from './archive.js';
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
}
export declare function checkpointPaths(input: HookInput, env: NodeJS.ProcessEnv): {
    directory: string;
    archive: string;
    pending: string;
};
/** A small retrieval index, not replacement history. Whole paired references only. */
export declare function recoveryContext(catalog: EvidenceCatalog, archive: string, maxChars?: number): string;
/** Hooks are always local. Errors never block native compaction. */
export declare function runHook(value: unknown, dependencies?: HookDependencies): Promise<object>;
export declare function writeNewArchive(path: string, content: unknown): Promise<void>;
//# sourceMappingURL=hooks.d.ts.map