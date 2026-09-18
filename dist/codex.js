import { compact } from './compact.js';
const ROLLOUT_METADATA = new Set([
    'session_meta',
    'turn_context',
    'event_msg',
    'token_count',
    'task_started',
    'task_complete',
    'thread_started',
    'thread_completed',
    'world_state',
    'inter_agent_communication_metadata',
    'token_usage_record',
]);
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function item(value, where) {
    if (!isRecord(value) || typeof value.type !== 'string' || value.type.length === 0) {
        throw new Error(`Malformed Codex item at ${where}: expected an object with a type`);
    }
    return value;
}
function replacementHistory(record, where) {
    let replacement;
    if (Object.prototype.hasOwnProperty.call(record, 'replacement_history')) {
        replacement = record.replacement_history;
    }
    else if (isRecord(record.payload) &&
        Object.prototype.hasOwnProperty.call(record.payload, 'replacement_history')) {
        replacement = record.payload.replacement_history;
    }
    if (!Array.isArray(replacement)) {
        throw new Error(`Compacted Codex record at ${where} has no valid replacement_history; refusing to reuse stale history`);
    }
    return replacement;
}
function appendRecord(current, value, where) {
    if (!isRecord(value))
        throw new Error(`Malformed Codex record at ${where}`);
    const type = typeof value.type === 'string' ? value.type : undefined;
    if (type === 'response_item') {
        if (!Object.prototype.hasOwnProperty.call(value, 'payload')) {
            throw new Error(`Response item at ${where} is missing payload`);
        }
        current.push(item(value.payload, `${where}.payload`));
        return current;
    }
    if (type === 'compacted') {
        const history = replacementHistory(value, where);
        let replacement = [];
        for (const [index, entry] of history.entries()) {
            // A nested compacted event is itself a replacement boundary. Keep the
            // returned array so a later item cannot accidentally resurrect entries
            // from before that nested boundary.
            replacement = appendRecord(replacement, entry, `${where}.replacement_history[${index}]`);
        }
        return replacement;
    }
    // These are rollout bookkeeping records rather than response items.
    if (type !== undefined && ROLLOUT_METADATA.has(type))
        return current;
    // A raw response item can be emitted directly as one JSONL line. Unknown
    // response item types stay opaque and are retained for safe compaction.
    current.push(item(value, where));
    return current;
}
function parseJson(text, where) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        void error;
        throw new Error(`Malformed Codex transcript JSON at ${where}`);
    }
}
/**
 * Parses either a JSON array of response items or Codex's JSONL rollout log.
 * Compaction events replace all prior items with their replacement history.
 */
export function parseCodexTranscript(text) {
    if (typeof text !== 'string')
        throw new Error('Codex transcript must be a string');
    const source = text.trim();
    if (source.length === 0)
        return [];
    try {
        const parsed = JSON.parse(source);
        // Hook checkpoints wrap the same response items with local recovery metadata.
        if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.items)) {
            return parseCodexTranscript(JSON.stringify(parsed.items));
        }
        if (Array.isArray(parsed)) {
            let entries = [];
            parsed.forEach((value, index) => {
                entries = appendRecord(entries, value, `[${index}]`);
            });
            return entries;
        }
        return appendRecord([], parsed, 'document');
    }
    catch (error) {
        // A multi-line JSONL transcript is expected to fail the whole-document
        // parse. Parse each non-empty line with a line-specific error instead.
        if (source.indexOf('\n') < 0 && source.indexOf('\r') < 0) {
            void error;
            throw new Error('Malformed Codex transcript JSON at document');
        }
    }
    let entries = [];
    const lines = source.split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
        if (line.trim().length === 0)
            return;
        const parsed = parseJson(line, `line ${lineIndex + 1}`);
        entries = appendRecord(entries, parsed, `line ${lineIndex + 1}`);
    });
    return entries;
}
function nonEmptyId(value, where) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Malformed Codex item at ${where}: call_id must be a non-empty string`);
    }
    return value;
}
function parseArguments(value, where) {
    if (typeof value === 'string') {
        let parsed;
        try {
            parsed = JSON.parse(value);
        }
        catch (error) {
            void error;
            throw new Error(`Malformed Codex function arguments at ${where}: invalid JSON`);
        }
        if (isRecord(parsed))
            return parsed;
        return { value: parsed };
    }
    if (isRecord(value))
        return value;
    if (value !== undefined)
        return { value };
    throw new Error(`Malformed Codex call at ${where}: missing arguments`);
}
function customArguments(value, where) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (isRecord(parsed))
                return parsed;
        }
        catch {
            // Custom tools are allowed to receive an opaque string input.
        }
        return { input: value };
    }
    if (isRecord(value))
        return value;
    if (value !== undefined)
        return { value };
    throw new Error(`Malformed Codex custom tool call at ${where}: missing input`);
}
function toolName(record) {
    return typeof record.name === 'string' && record.name.length > 0
        ? record.name
        : String(record.type);
}
function callKind(type) {
    if (type === 'function_call')
        return 'function';
    if (type === 'custom_tool_call')
        return 'custom';
    return undefined;
}
function outputKind(type) {
    if (type === 'function_call_output')
        return 'function';
    if (type === 'custom_tool_call_output')
        return 'custom';
    return undefined;
}
function toolResultText(record) {
    if (typeof record.output === 'string')
        return record.output;
    if (record.type !== 'custom_tool_call_output' || !Array.isArray(record.output))
        return undefined;
    if (!record.output.every((part) => isRecord(part) &&
        (part.type === 'input_text' || part.type === 'inputText') && typeof part.text === 'string')) {
        return undefined;
    }
    return record.output.map((part) => part.text).join('\n');
}
function visibleMessageText(record) {
    if (typeof record.content === 'string')
        return record.content;
    if (typeof record.text === 'string')
        return record.text;
    if (!Array.isArray(record.content))
        return '';
    const parts = [];
    for (const content of record.content) {
        if (typeof content === 'string')
            parts.push(content);
        else if (isRecord(content) && typeof content.text === 'string')
            parts.push(content.text);
    }
    return parts.join('\n');
}
function opaqueMessage(record, role = 'assistant') {
    return {
        role,
        text: `[opaque Codex item: ${record.type}]`,
        toolUses: [],
    };
}
function validateSpecialIds(items) {
    items.forEach((record, index) => {
        if (callKind(record.type) || outputKind(record.type)) {
            nonEmptyId(record.call_id, `item ${index}`);
        }
    });
}
function normalizedTranscript(items) {
    validateSpecialIds(items);
    const calls = new Map();
    const outputs = new Map();
    items.forEach((record, index) => {
        const kind = callKind(record.type);
        if (kind) {
            const id = record.call_id;
            const list = calls.get(id) ?? [];
            list.push({ index, record, kind });
            calls.set(id, list);
            return;
        }
        const outputType = outputKind(record.type);
        if (outputType) {
            const id = record.call_id;
            const list = outputs.get(id) ?? [];
            list.push({ index, record, kind: outputType });
            outputs.set(id, list);
        }
    });
    const pairs = [];
    for (const [id, callList] of calls) {
        const outputList = outputs.get(id) ?? [];
        if (callList.length !== 1 || outputList.length !== 1)
            continue;
        const call = callList[0];
        const output = outputList[0];
        if (call.kind !== output.kind ||
            call.index >= output.index ||
            toolResultText(output.record) === undefined)
            continue;
        pairs.push({
            id,
            callIndex: call.index,
            resultIndex: output.index,
            tool: toolName(call.record),
        });
    }
    pairs.sort((a, b) => a.callIndex - b.callIndex);
    const pairByCall = new Map(pairs.map((pair) => [pair.callIndex, pair]));
    const pairByResult = new Map(pairs.map((pair) => [pair.resultIndex, pair]));
    const messages = items.map((record, index) => {
        const pair = pairByCall.get(index);
        if (pair) {
            const kind = callKind(record.type);
            const input = kind === 'function'
                ? parseArguments(record.arguments, `item ${index}`)
                : customArguments(record.input, `item ${index}`);
            return {
                role: 'assistant',
                text: '',
                toolUses: [{
                        tool_use_id: pair.id,
                        tool: pair.tool,
                        input,
                    }],
            };
        }
        const outputPair = pairByResult.get(index);
        const outputText = toolResultText(record);
        if (outputPair && outputText !== undefined) {
            return {
                role: 'user',
                text: '',
                toolUses: [],
                toolResults: [{
                        tool_use_id: outputPair.id,
                        text: outputText,
                    }],
            };
        }
        if (record.type === 'message') {
            if (record.role === 'user' || record.role === 'assistant') {
                if (record.role === 'assistant' && record.channel === 'analysis') {
                    return opaqueMessage(record);
                }
                return { role: record.role, text: visibleMessageText(record), toolUses: [] };
            }
            return opaqueMessage(record);
        }
        // Reasoning, system/developer content, hosted calls, and unknown response
        // items are represented by a harmless marker so their item boundaries and
        // recent-history pinning remain visible without leaking protected content.
        return opaqueMessage(record);
    });
    return { messages, pairs };
}
function serializedChars(items) {
    return JSON.stringify(items).length;
}
function safeTruncate(text, headChars) {
    if (text.length <= headChars + 120)
        return text;
    const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
    const shortened = `${head}[fast-jev-compaction truncated ${text.length - headChars} chars of this tool result; do not rerun side-effect tools solely to recover omitted output]`;
    return shortened.length < text.length ? shortened : text;
}
/**
 * Compacts Codex items while applying decisions to the original parsed
 * objects. Unmatched, duplicate, ambiguous, and structured-output calls are
 * retained as opaque items and never become Jev candidates.
 */
export async function compactCodexItems(items, asker, options = {}) {
    if (!Array.isArray(items))
        throw new Error('Codex items must be an array');
    items.forEach((record, index) => item(record, `items[${index}]`));
    const normalized = normalizedTranscript(items);
    const result = await compact(normalized.messages, asker, options);
    const pairByDecision = new Map();
    normalized.pairs.forEach((pair, index) => pairByDecision.set(`t${index + 1}`, pair));
    const dropItems = new Set();
    const truncateResults = new Map();
    const truncateHead = Number.isFinite(options.truncateHeadChars)
        ? Math.max(0, Math.floor(options.truncateHeadChars))
        : 300;
    result.decisions.forEach((decision) => {
        const pair = pairByDecision.get(decision.id);
        if (!pair)
            throw new Error(`Internal Codex decision ${decision.id} has no pair`);
        if (decision.action === 'drop_call') {
            dropItems.add(pair.callIndex);
            dropItems.add(pair.resultIndex);
        }
        else if (decision.action === 'drop_result') {
            const output = items[pair.resultIndex];
            const text = output.output;
            if (typeof text === 'string') {
                const next = safeTruncate(text, truncateHead);
                if (next !== text)
                    truncateResults.set(pair.resultIndex, next);
            }
        }
    });
    const compactedItems = [];
    items.forEach((record, index) => {
        if (dropItems.has(index))
            return;
        const replacement = truncateResults.get(index);
        if (replacement === undefined) {
            compactedItems.push(record);
            return;
        }
        compactedItems.push({ ...record, output: replacement });
    });
    return {
        items: compactedItems,
        decisions: result.decisions,
        stats: {
            ...result.stats,
            messagesBefore: items.length,
            messagesAfter: compactedItems.length,
            charsBefore: serializedChars(items),
            charsAfter: serializedChars(compactedItems),
        },
    };
}
//# sourceMappingURL=codex.js.map