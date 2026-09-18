import { retrieveEvidence } from './archive.js';
import { searchEvidence } from './evidence.js';
const MAX_CANDIDATES = 24;
const MAX_REQUEST_CHARS = 50_000;
const MAX_OBJECTIVE = 2_400;
const MAX_CONTEXT_ITEM = 900;
const MAX_RECENT_DISCUSSION = 8;
const MAX_CANDIDATE_TEXT = 1_050;
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clip(value, max) {
    const text = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
    if (text.length <= max)
        return text;
    if (max <= 1)
        return text.slice(0, max);
    const head = Math.ceil((max - 20) / 2);
    const tail = Math.floor((max - 20) / 2);
    return `${text.slice(0, Math.max(0, head))}\n[… clipped …]\n${text.slice(-Math.max(0, tail))}`.slice(0, max);
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
    }
    return String(value);
}
function visibleMessage(record) {
    if (record.type !== 'message' || (record.role !== 'user' && record.role !== 'assistant'))
        return undefined;
    if (record.channel === 'analysis')
        return undefined;
    return { role: record.role, text: textFrom(record.content ?? record.text) };
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
    return typeof record.name === 'string' && record.name.trim() ? record.name.trim() : record.type;
}
function parsed(value) {
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function safeJson(value, max) {
    const sanitized = sanitize(value);
    try {
        return clip(JSON.stringify(sanitized), max);
    }
    catch {
        return clip(String(sanitized), max);
    }
}
function sanitize(value) {
    if (Array.isArray(value))
        return value.map(sanitize);
    if (!isRecord(value))
        return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        // Keep the retrieval signal while avoiding common credential fields.
        if (/^(?:token|secret|password|api[_-]?key|authorization|cookie)$/i.test(key))
            continue;
        result[key] = sanitize(child);
    }
    return result;
}
function pairedTool(records) {
    if (records.length < 2)
        return undefined;
    const call = records.find((record) => callKind(record.type));
    const output = records.find((record) => outputKind(record.type));
    if (!call || !output)
        return undefined;
    const id = callId(call);
    if (!id || callId(output) !== id || callKind(call.type) !== outputKind(output.type))
        return undefined;
    const input = callKind(call.type) === 'function' ? call.arguments : call.input;
    return {
        tool: clip(toolName(call), 100),
        input: safeJson(parsed(input), MAX_CANDIDATE_TEXT),
        result: safeJson(output.output, MAX_CANDIDATE_TEXT),
    };
}
function terms(value) {
    return value.toLowerCase().match(/[a-z0-9][a-z0-9_.:/-]*/g) ?? [];
}
function localPriority(entry, queryTerms, order, newestTurn) {
    const haystack = `${entry.tool ?? ''} ${entry.callId ?? ''} ${entry.summary} ${entry.outcome}`.toLowerCase();
    let score = 0;
    for (const term of queryTerms)
        if (haystack.includes(term))
            score += 10;
    if (entry.flags.includes('failure'))
        score += 90;
    if (entry.flags.includes('write'))
        score += 75;
    if (entry.flags.includes('constraint'))
        score += 65;
    if (entry.flags.includes('decision'))
        score += 50;
    if (entry.flags.includes('identifier'))
        score += 15;
    score += Math.max(0, Math.min(20, entry.turn - newestTurn + 20));
    return score * 1_000 + order;
}
async function archivedMessages(entries, archivePath) {
    const result = new Map();
    const messageEntries = entries.filter((entry) => entry.kind === 'message');
    await Promise.all(messageEntries.map(async (entry) => {
        try {
            const retrieved = await retrieveEvidence(archivePath, entry.id);
            const message = retrieved.records.map(visibleMessage).find((value) => value !== undefined);
            if (message)
                result.set(entry.id, message);
        }
        catch {
            // The bounded catalog summary remains a safe fallback for a stale object.
        }
    }));
    return result;
}
async function contextFor(entries, archivePath) {
    const messagesById = await archivedMessages(entries, archivePath);
    const users = entries.filter((entry) => entry.kind === 'message' && entry.role === 'user');
    const messages = entries
        .filter((entry) => entry.kind === 'message' && (entry.role === 'user' || entry.role === 'assistant'));
    const messageText = (entry) => messagesById.get(entry.id)?.text ?? entry.summary;
    return {
        objective: clip(users[0] ? messageText(users[0]) : '', MAX_OBJECTIVE),
        latestUserInstructions: users.slice(-4).map((entry) => ({ turn: entry.turn, text: clip(messageText(entry), MAX_CONTEXT_ITEM) })),
        recentDiscussion: messages.slice(-MAX_RECENT_DISCUSSION).map((entry) => ({
            role: entry.role,
            turn: entry.turn,
            text: clip(messageText(entry), MAX_CONTEXT_ITEM),
        })),
    };
}
function safeId(value) { return clip(value, 128); }
function safeModel(value) {
    if (typeof value !== 'string')
        return undefined;
    const model = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return model ? clip(model, 120) : undefined;
}
function safeUsage(value) {
    if (!isRecord(value))
        return undefined;
    const result = {};
    for (const key of ['input_tokens', 'output_tokens']) {
        const amount = value[key];
        if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
            result[key] = amount;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
function candidateOrder(entries, query) {
    const queryTerms = terms(query);
    const newestTurn = Math.max(0, ...entries.map((entry) => entry.turn));
    const byPriority = [...entries].sort((a, b) => localPriority(b, queryTerms, entries.indexOf(b), newestTurn) -
        localPriority(a, queryTerms, entries.indexOf(a), newestTurn));
    const byHeuristic = searchEvidence(entries, query, entries.length);
    const byAge = [...entries].sort((a, b) => a.turn - b.turn || entries.indexOf(a) - entries.indexOf(b));
    const flagged = byPriority.filter((entry) => entry.flags.some((flag) => ['failure', 'write', 'constraint', 'decision'].includes(flag)));
    const pools = [flagged, byHeuristic, byAge, byPriority];
    const result = [];
    const seen = new Set();
    let cursor = 0;
    while (result.length < entries.length && cursor < entries.length * pools.length + pools.length) {
        const pool = pools[cursor % pools.length];
        const candidate = pool[Math.floor(cursor / pools.length)];
        if (candidate && !seen.has(candidate.id)) {
            seen.add(candidate.id);
            result.push(candidate);
        }
        cursor += 1;
    }
    return result;
}
function buildState(context, candidates) {
    return {
        objective: context.objective,
        latestUserInstructions: context.latestUserInstructions,
        recentDiscussion: context.recentDiscussion,
        candidates: candidates.map((candidate) => ({
            id: safeId(candidate.entry.id),
            kind: candidate.kind,
            turn: candidate.entry.turn,
            ...(candidate.role ? { role: candidate.role } : {}),
            ...(candidate.tool ? { tool: candidate.tool } : {}),
            ...(candidate.text !== undefined ? { text: clip(candidate.text, MAX_CANDIDATE_TEXT) } : {}),
            ...(candidate.input !== undefined ? { input: clip(candidate.input, MAX_CANDIDATE_TEXT) } : {}),
            ...(candidate.result !== undefined ? { result: clip(candidate.result, MAX_CANDIDATE_TEXT) } : {}),
            flags: candidate.entry.flags.slice(0, 6).map((flag) => clip(flag, 24)),
        })),
    };
}
function buildQuestions(candidates) {
    return Object.fromEntries(candidates.map((candidate, index) => [
        `candidate_${index + 1}`,
        {
            type: 'noul',
            instructions: `For candidate ${candidate.entry.id} (question key candidate_${index + 1}), answer yes/no as a probability in [0,1] for task relevance: would retaining this evidence materially help continue the current task correctly, including by preserving relevant facts, constraints, prior attempt outcomes, or avoiding repeating mistakes? Use 0 for unrelated evidence and 1 for evidence directly needed to continue the task. Consider the full cross-turn context and constraints.`,
        },
    ]));
}
function requestChars(state, questions) {
    return JSON.stringify({ state, questions }).length;
}
function fitRequest(context, candidates) {
    let working = candidates.map((candidate) => ({ ...candidate }));
    let contextWorking = {
        objective: context.objective,
        latestUserInstructions: context.latestUserInstructions.map((item) => ({ ...item })),
        recentDiscussion: context.recentDiscussion.map((item) => ({ ...item })),
    };
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const state = buildState(contextWorking, working);
        const questions = buildQuestions(working);
        const chars = requestChars(state, questions);
        if (chars <= MAX_REQUEST_CHARS)
            return { state, questions, chars, candidates: working };
        contextWorking = {
            objective: clip(contextWorking.objective, Math.floor(Math.max(200, contextWorking.objective.length * 0.7))),
            latestUserInstructions: contextWorking.latestUserInstructions.map((item) => ({ ...item, text: clip(item.text, Math.floor(Math.max(120, item.text.length * 0.7))) })),
            recentDiscussion: contextWorking.recentDiscussion.map((item) => ({ ...item, text: clip(item.text, Math.floor(Math.max(120, item.text.length * 0.7))) })),
        };
        working = working.map((candidate) => ({
            ...candidate,
            text: candidate.text === undefined ? undefined : clip(candidate.text, Math.floor(Math.max(160, candidate.text.length * 0.7))),
            input: candidate.input === undefined ? undefined : clip(candidate.input, Math.floor(Math.max(160, candidate.input.length * 0.7))),
            result: candidate.result === undefined ? undefined : clip(candidate.result, Math.floor(Math.max(160, candidate.result.length * 0.7))),
        }));
    }
    while (working.length > 0) {
        const state = buildState(contextWorking, working);
        const questions = buildQuestions(working);
        const chars = requestChars(state, questions);
        if (chars <= MAX_REQUEST_CHARS)
            return { state, questions, chars, candidates: working };
        working.pop();
    }
    const state = buildState(contextWorking, []);
    const questions = buildQuestions([]);
    return { state, questions, chars: requestChars(state, questions), candidates: [] };
}
function validNoul(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function scoreAnswers(response, candidates) {
    if (!isRecord(response) || !isRecord(response.answers))
        throw new Error('invalid Jev response');
    const answers = response.answers;
    const expected = candidates.map((_, index) => `candidate_${index + 1}`);
    for (const key of expected) {
        const answer = answers[key];
        if (!isRecord(answer) || !validNoul(answer.noul))
            throw new Error('invalid Jev score');
    }
    for (const answer of Object.values(answers)) {
        if (!isRecord(answer) || !validNoul(answer.noul))
            throw new Error('invalid Jev score');
    }
    return expected.map((key) => answers[key].noul);
}
function localSelection(entries, candidates, query, maxCandidates, latencyMs, requestCharsValue, requests, reason) {
    const queryTerms = terms(query);
    const newestTurn = Math.max(0, ...entries.map((entry) => entry.turn));
    const ranked = [...candidates]
        .sort((a, b) => localPriority(b.entry, queryTerms, b.order, newestTurn) - localPriority(a.entry, queryTerms, a.order, newestTurn))
        .slice(0, maxCandidates);
    return {
        mode: 'local-fallback',
        selectedIds: ranked.map((candidate) => candidate.entry.id),
        requests,
        latencyMs,
        candidateCount: candidates.length,
        requestChars: requestCharsValue,
        ...(reason ? { reason } : {}),
    };
}
export async function selectRecovery(catalog, archivePath, asker, options = {}) {
    const now = options.now ?? Date.now;
    const started = now();
    const maxCandidates = Number.isFinite(options.maxCandidates)
        ? Math.min(MAX_CANDIDATES, Math.max(0, Math.floor(options.maxCandidates)))
        : MAX_CANDIDATES;
    const entries = catalog.entries.filter((entry) => entry.kind !== 'opaque');
    const context = await contextFor(entries, archivePath);
    const query = [context.objective, ...context.latestUserInstructions.map((item) => item.text), ...context.recentDiscussion.map((item) => item.text)].join(' ');
    const merged = candidateOrder(entries, query);
    const candidates = [];
    for (const [order, entry] of merged.entries()) {
        if (candidates.length >= maxCandidates)
            break;
        if (entry.kind === 'message') {
            if (entry.role !== 'user' && entry.role !== 'assistant')
                continue;
            let text = entry.summary;
            try {
                const retrieved = await retrieveEvidence(archivePath, entry.id);
                const message = retrieved.records.map(visibleMessage).find((value) => value !== undefined);
                if (message)
                    text = message.text;
            }
            catch {
                // Use the bounded summary if the immutable message object is unavailable.
            }
            candidates.push({ entry, kind: 'message', role: entry.role, text, order });
            continue;
        }
        try {
            const retrieved = await retrieveEvidence(archivePath, entry.id);
            const pair = pairedTool(retrieved.records);
            if (!pair)
                continue;
            candidates.push({ entry, kind: 'tool', tool: pair.tool, input: pair.input, result: pair.result, order });
        }
        catch {
            // A stale or malformed object is simply unavailable to recovery.
        }
    }
    const fitted = fitRequest(context, candidates);
    const elapsed = () => {
        const value = Number(now()) - started;
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    if (fitted.candidates.length === 0) {
        return localSelection(entries, candidates, query, maxCandidates, elapsed(), fitted.chars, 0, 'no eligible recovery candidates');
    }
    try {
        const response = await asker.ask(fitted.state, fitted.questions);
        const scores = scoreAnswers(response, fitted.candidates);
        const ranked = fitted.candidates.map((candidate, index) => ({ candidate, score: scores[index], index }))
            .sort((a, b) => b.score - a.score || a.index - b.index);
        const typed = response;
        const model = safeModel(typed.model);
        const usage = safeUsage(typed.usage);
        return {
            mode: 'jev',
            selectedIds: ranked.map(({ candidate }) => candidate.entry.id),
            requests: 1,
            latencyMs: elapsed(),
            candidateCount: fitted.candidates.length,
            requestChars: fitted.chars,
            ...(model ? { model } : {}),
            ...(usage && Object.keys(usage).length ? { usage } : {}),
        };
    }
    catch {
        return localSelection(entries, candidates, query, maxCandidates, elapsed(), fitted.chars, 1, 'jev unavailable; local recovery ranking used');
    }
}
//# sourceMappingURL=recovery.js.map