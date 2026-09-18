import { type CodexItem } from './codex.js';
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
    asker?: JevAsker;
    now?: () => number;
}
/** Nothing in a rollout is rewritten. This directory only holds private sidecars. */
export declare function checkpointPaths(input: HookInput, env: NodeJS.ProcessEnv): {
    directory: string;
    archive: string;
    pending: string;
};
/** A bounded, quoted evidence packet. Opaque records and reasoning never become instructions. */
export declare function recoveryContext(items: CodexItem[], archive: string, maxChars?: number): string;
/** Fail open: all error paths return success without blocking native compaction. */
export declare function runHook(value: unknown, dependencies?: HookDependencies): Promise<object>;
export declare function writeNewArchive(path: string, content: unknown): Promise<void>;
//# sourceMappingURL=hooks.d.ts.map