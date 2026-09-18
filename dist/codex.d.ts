import type { CallDecision, CompactOptions, CompactResult, JevAsker } from './types.js';
/** A parsed Codex response item. The object is deliberately kept opaque. */
export type CodexItem = Record<string, unknown> & {
    type: string;
};
/**
 * Parses either a JSON array of response items or Codex's JSONL rollout log.
 * Compaction events replace all prior items with their replacement history.
 */
export declare function parseCodexTranscript(text: string): CodexItem[];
/**
 * Compacts Codex items while applying decisions to the original parsed
 * objects. Unmatched, duplicate, ambiguous, and structured-output calls are
 * retained as opaque items and never become Jev candidates.
 */
export declare function compactCodexItems(items: readonly CodexItem[], asker: JevAsker, options?: CompactOptions): Promise<{
    items: CodexItem[];
    decisions: CallDecision[];
    stats: CompactResult['stats'];
}>;
//# sourceMappingURL=codex.d.ts.map