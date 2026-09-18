import { createHash } from 'node:crypto';
const MAX_SUMMARY = 160;
const MAX_OUTCOME = 240;
const FAILURE_WORDS = /\b(?:error|failed?|failure|exception|traceback|denied|timed?\s*out|timeout|not\s+found|cannot|could\s+not|invalid)\b/i;
const IDENTIFIER_WORDS = /\b(?:id|uuid|url|uri|path|file|sha|commit|revision|branch|created|updated|deleted|written|saved)\b/i;
const WRITE_TOOL = /(?:write|edit|patch|create|update|delete|remove|move|copy|rename|mkdir|apply[_ -]?patch|commit|publish|send|post|put|deploy|migrat(?:e|ion)|git\s+push|git\s+commit|terraform\s+apply|kubectl\s+(?:apply|delete)|npm\s+publish|release)/i;
const MAX_JEV_ID = 64;
const MAX_JEV_CALL_ID = 64;
const MAX_JEV_TOOL = 64;
const MAX_JEV_SUMMARY = 100;
const MAX_JEV_OUTCOME = 120;
const MAX_JEV_FLAG = 20;
const MAX_JEV_FLAGS = 6;
const MAX_JEV_QUERY = 120;
const MAX_JEV_QUESTION = 430;
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clip(value, max) {
    const text = value.trim();
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (isRecord(value)) {
        const result = Object.create(null);
        for (const key of Object.keys(value).sort()) {
            const child = value[key];
            if (child !== undefined)
                result[key] = canonical(child);
        }
        return result;
    }
    return value;
}
function stableId(records) {
    return createHash('sha256').update(JSON.stringify(records)).digest('hex');
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
function callId(record) {
    return typeof record.call_id === 'string' && record.call_id.length > 0 ? record.call_id : undefined;
}
function toolName(record) {
    if (typeof record.name === 'string' && record.name.trim())
        return record.name.trim();
    return record.type;
}
function visibleMessage(record) {
    return record.type === 'message' && (record.role === 'user' || record.role === 'assistant') && record.channel !== 'analysis';
}
function textFrom(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined || value === null)
        return '';
    if (Array.isArray(value))
        return value.map(textFrom).filter(Boolean).join('\n');
    if (isRecord(value)) {
        if (typeof value.text === 'string')
            return value.text;
        if (typeof value.output_text === 'string')
            return value.output_text;
        if (typeof value.content === 'string' || Array.isArray(value.content))
            return textFrom(value.content);
        try {
            return JSON.stringify(canonical(value));
        }
        catch {
            return String(value);
        }
    }
    return String(value);
}
function messageText(record) {
    return textFrom(record.content ?? record.text);
}
function callInput(record) {
    return record.type === 'function_call' ? record.arguments : record.input;
}
function shortInput(record) {
    const raw = callInput(record);
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = raw;
        }
    }
    if (!isRecord(parsed))
        return typeof parsed === 'string' ? clip(parsed, 80) : '';
    const parts = [];
    for (const key of Object.keys(parsed).sort()) {
        if (/^(?:content|body|text|data|token|secret|password|api[_-]?key|authorization)$/i.test(key))
            continue;
        const value = parsed[key];
        const rendered = typeof value === 'string' ? value : isRecord(value) || Array.isArray(value) ? textFrom(value) : String(value);
        if (rendered)
            parts.push(`${key}=${clip(rendered.replace(/\s+/g, ' '), 55)}`);
    }
    return parts.join(', ');
}
function walk(value, visit, key) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (isRecord(parsed) || Array.isArray(parsed)) {
                walk(parsed, visit, key);
                return;
            }
        }
        catch { /* Plain result text is inspected below. */ }
    }
    visit(key, value);
    if (Array.isArray(value))
        value.forEach((child) => walk(child, visit));
    else if (isRecord(value))
        for (const [childKey, child] of Object.entries(value))
            walk(child, visit, childKey);
}
function resultValue(records) {
    const output = records.find((record) => outputKind(record.type));
    return output ? output.output : undefined;
}
function resultHasFailure(value) {
    let failed = false;
    walk(value, (key, child) => {
        if (key && /^(?:isError|error|errors|failed|failure|exception)$/i.test(key)) {
            if (child === true)
                failed = true;
            else if (typeof child === 'number')
                failed ||= child !== 0;
            else if (typeof child === 'string')
                failed ||= child.trim() !== '' && !/^(?:false|null|none|no|0|ok|success)$/i.test(child.trim());
            else if (Array.isArray(child))
                failed ||= child.length > 0;
            else if (isRecord(child))
                failed ||= Object.keys(child).length > 0;
        }
        if (key && /^exit[_ -]?code$/i.test(key) && ((typeof child === 'number' && child !== 0) || (typeof child === 'string' && /^-?\d+$/.test(child) && Number(child) !== 0)))
            failed = true;
        if (key && /^status[_ -]?code$/i.test(key) && ((typeof child === 'number' && child >= 400) || (typeof child === 'string' && /^\d+$/.test(child) && Number(child) >= 400)))
            failed = true;
        if (key && /^status$/i.test(key) && typeof child === 'string' && FAILURE_WORDS.test(child))
            failed = true;
        if (typeof child === 'string' && FAILURE_WORDS.test(child))
            failed = true;
    });
    return failed;
}
function resultHasIdentifier(value) {
    let found = false;
    walk(value, (key, child) => {
        if (key && IDENTIFIER_WORDS.test(key) && child !== undefined && child !== null && String(child).length > 0)
            found = true;
        if (typeof child === 'string' && (/(?:https?:\/\/|(?:^|\s)[A-Za-z]:\\|(?:^|\s)(?:\.?\.?\/)?[\w.-]+\/[\w./-]+|\b[0-9a-f]{7,40}\b)/i.test(child)))
            found = true;
    });
    return found;
}
function resultLines(value) {
    if (value === undefined)
        return [];
    const text = textFrom(value).replace(/\r/g, '');
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const signal = lines.filter((line) => FAILURE_WORDS.test(line) || IDENTIFIER_WORDS.test(line));
    return [...new Set([...signal, ...lines])];
}
function outcomeFor(records) {
    return clip(resultLines(resultValue(records)).join('\n'), MAX_OUTCOME);
}
function messageFlags(text) {
    const flags = [];
    if (/\b(?:must|never|do not|don't|only|preserve|keep|require|avoid|cannot)\b/i.test(text))
        flags.push('constraint');
    if (/\b(?:decided|choose|chosen|approved|will use|going to|plan to|ship|deploy)\b/i.test(text))
        flags.push('decision');
    return flags;
}
function entryFlags(records, tool) {
    const flags = [];
    const output = resultValue(records);
    const outputRecord = records.find((record) => outputKind(record.type));
    const call = records.find((record) => callKind(record.type));
    const commandText = call ? textFrom(callInput(call)) : '';
    if ((tool && WRITE_TOOL.test(tool)) || WRITE_TOOL.test(commandText) || /\b(?:wrote|written|created|updated|deleted|saved|applied\s+patch|committed)\b/i.test(textFrom(output)))
        flags.push('write');
    if (resultHasFailure(output) || (outputRecord && resultHasFailure(outputRecord)))
        flags.push('failure');
    if (resultHasIdentifier(output))
        flags.push('identifier');
    return flags;
}
/**
 * Builds a lossless local index. Heuristic flags are deliberately broad hints,
 * not security or correctness guarantees; records remain the authoritative data.
 */
export function buildEvidenceEntries(items) {
    const calls = new Map();
    const outputs = new Map();
    items.forEach((record, index) => {
        const kind = callKind(record.type);
        const id = callId(record);
        if (kind && id) {
            const list = calls.get(id) ?? [];
            list.push({ index, record, kind });
            calls.set(id, list);
        }
        const outputType = outputKind(record.type);
        if (outputType && id) {
            const list = outputs.get(id) ?? [];
            list.push({ index, record, kind: outputType });
            outputs.set(id, list);
        }
    });
    const paired = new Map();
    for (const [id, callList] of calls) {
        const outputList = outputs.get(id) ?? [];
        if (callList.length !== 1 || outputList.length !== 1)
            continue;
        const call = callList[0];
        const output = outputList[0];
        if (call.kind !== output.kind || call.index >= output.index)
            continue;
        paired.set(call.index, { call: call.record, output: output.record, outputIndex: output.index, id, tool: toolName(call.record) });
    }
    const pairOutputIndices = new Set();
    for (const pair of paired.values()) {
        pairOutputIndices.add(pair.outputIndex);
    }
    const turnAt = [];
    let turn = 0;
    let sawUser = false;
    items.forEach((record, index) => {
        if (visibleMessage(record) && record.role === 'user') {
            if (sawUser)
                turn += 1;
            sawUser = true;
        }
        turnAt[index] = turn;
    });
    const entries = [];
    const used = new Set();
    for (let index = 0; index < items.length; index += 1) {
        if (used.has(index) || pairOutputIndices.has(index))
            continue;
        const record = items[index];
        const pair = paired.get(index);
        let entry;
        if (pair) {
            const records = [pair.call, pair.output];
            used.add(index);
            used.add(pair.outputIndex);
            const outcome = outcomeFor(records);
            entry = {
                id: stableId(records), kind: 'tool', callId: pair.id, tool: pair.tool,
                turn: turnAt[index], summary: clip(`${pair.tool}${shortInput(pair.call) ? ` (${shortInput(pair.call)})` : ''}`, MAX_SUMMARY),
                outcome, flags: entryFlags(records, pair.tool), records,
            };
        }
        else if (callKind(record.type) || outputKind(record.type)) {
            used.add(index);
            const id = callId(record);
            const tool = callKind(record.type) ? toolName(record) : undefined;
            const ambiguous = !id || (calls.get(id)?.length ?? 0) > 1 || (outputs.get(id)?.length ?? 0) > 1 || !(paired.has(index) || [...paired.values()].some((pair) => pair.outputIndex === index));
            const records = [record];
            entry = {
                id: stableId(records), kind: 'tool', ...(id ? { callId: id } : {}), ...(tool ? { tool } : {}),
                turn: turnAt[index], summary: tool ? clip(`${tool}${shortInput(record) ? ` (${shortInput(record)})` : ''}`, MAX_SUMMARY) : 'Tool result',
                outcome: outcomeFor(records), flags: [...(ambiguous ? ['ambiguous'] : []), ...entryFlags(records, tool)], records,
            };
        }
        else if (visibleMessage(record)) {
            used.add(index);
            const text = messageText(record);
            entry = {
                id: stableId([record]), kind: 'message', turn: turnAt[index], summary: clip(text.replace(/\s+/g, ' '), MAX_SUMMARY),
                outcome: '', flags: messageFlags(text), records: [record], role: record.role,
            };
        }
        else {
            used.add(index);
            entry = { id: stableId([record]), kind: 'opaque', turn: turnAt[index], summary: '', outcome: '', flags: [], records: [record] };
        }
        entries.push({ ...entry, firstIndex: index });
    }
    return entries.sort((a, b) => a.firstIndex - b.firstIndex).map(({ firstIndex: _firstIndex, ...entry }) => entry);
}
function terms(value) {
    return value.toLowerCase().match(/[a-z0-9][a-z0-9_.:/-]*/g) ?? [];
}
function localScore(entry, queryTerms) {
    if (queryTerms.length === 0)
        return 0;
    const tool = (entry.tool ?? '').toLowerCase();
    const id = (entry.callId ?? '').toLowerCase();
    const summary = entry.summary.toLowerCase();
    const outcome = entry.outcome.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        if (id === term)
            score += 10_000;
        else if (tool === term)
            score += 80;
        else if (id.includes(term))
            score += 50;
        else if (tool.includes(term))
            score += 40;
        if (summary.includes(term))
            score += 12;
        if (outcome.includes(term))
            score += 10;
        if (entry.flags.some((flag) => flag === term))
            score += 16;
    }
    if (entry.flags.includes('failure') && queryTerms.some((term) => /fail|error|exception/.test(term)))
        score += 18;
    if (entry.flags.includes('write') && queryTerms.some((term) => /write|edit|patch|create|update|delete/.test(term)))
        score += 18;
    return score;
}
export function searchEvidence(entries, query, limit = 10) {
    const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    const queryTerms = terms(query);
    return entries
        .map((entry, index) => ({ entry, index, score: entry.kind === 'opaque' ? -1 : localScore(entry, queryTerms) }))
        .filter((item) => item.entry.kind !== 'opaque' && (queryTerms.length === 0 || item.score > 0))
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, count)
        .map((item) => item.entry);
}
function validScore(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function boundedSummary(entry) {
    const flags = Array.isArray(entry.flags)
        ? entry.flags.filter((flag) => typeof flag === 'string').slice(0, MAX_JEV_FLAGS).map((flag) => clip(flag, MAX_JEV_FLAG))
        : [];
    const turn = typeof entry.turn === 'number' && Number.isFinite(entry.turn)
        ? Math.max(-1_000_000_000, Math.min(1_000_000_000, Math.trunc(entry.turn)))
        : 0;
    return {
        id: clip(typeof entry.id === 'string' ? entry.id : '', MAX_JEV_ID),
        kind: entry.kind === 'message' || entry.kind === 'tool' ? entry.kind : 'opaque',
        ...(typeof entry.callId === 'string' ? { callId: clip(entry.callId, MAX_JEV_CALL_ID) } : {}),
        ...(typeof entry.tool === 'string' ? { tool: clip(entry.tool, MAX_JEV_TOOL) } : {}),
        turn,
        summary: clip(typeof entry.summary === 'string' ? entry.summary : '', MAX_JEV_SUMMARY),
        outcome: clip(typeof entry.outcome === 'string' ? entry.outcome : '', MAX_JEV_OUTCOME),
        flags,
        ...(entry.role === 'user' || entry.role === 'assistant' ? { role: entry.role } : {}),
    };
}
export async function rankEvidence(entries, query, asker, limit = 10) {
    const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    const queryTerms = terms(query);
    const local = entries
        .map((entry, index) => ({ entry, index, score: entry.kind === 'opaque' ? -1 : localScore(entry, queryTerms) }))
        .filter((item) => item.entry.kind !== 'opaque')
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .slice(0, 20)
        .map((item) => item.entry);
    if (local.length === 0 || count === 0)
        return { entries: local.slice(0, count), mode: 'local-fallback', requests: 0 };
    const questions = {};
    const candidates = local.map((entry, index) => {
        const safe = boundedSummary(entry);
        const key = `evidence_${index}`;
        questions[key] = {
            type: 'noul',
            instructions: clip(`For state.candidates[${index}] (id=${safe.id}), answer this binary proposition: would retaining this evidence materially help answer state.query correctly? Treat relevant facts, constraints, corrections, failed attempts, and safety boundaries as potentially useful evidence, including when the record reports a failure.`, MAX_JEV_QUESTION),
            criteria: {
                true: 'The candidate materially helps answer the query correctly or preserves a relevant fact, constraint, correction, failed attempt, or safety boundary.',
                false: 'The candidate is unrelated to answering the query correctly and does not preserve a relevant constraint or prior outcome.',
            },
        };
        return { key, entry, safe, index };
    });
    try {
        const response = await asker.ask({ query: clip(query, MAX_JEV_QUERY), candidates: candidates.map(({ safe }) => safe) }, questions);
        const scored = candidates.map((candidate) => {
            const answer = response.answers[candidate.key];
            const score = answer && 'noul' in answer ? answer.noul : undefined;
            return { ...candidate, score };
        });
        if (!scored.every((candidate) => validScore(candidate.score)))
            throw new Error('invalid Jev evidence score');
        return {
            entries: scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, count).map((candidate) => candidate.entry),
            mode: 'jev', requests: 1, ...(response.usage ? { usage: response.usage } : {}),
        };
    }
    catch {
        return { entries: searchEvidence(entries, query, count), mode: 'local-fallback', requests: 1 };
    }
}
//# sourceMappingURL=evidence.js.map