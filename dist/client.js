import { buildJevRequest, parseJevResponse } from './request.js';
/** Asks Jev over HTTP with the global `fetch` (or an injected one). */
export class JevClient {
    apiKey;
    model;
    baseUrl;
    fetcher;
    timeoutMs;
    constructor(options = {}) {
        this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? '';
        this.model = options.model;
        this.baseUrl = options.baseUrl;
        this.fetcher = options.fetch ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 15_000;
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
            throw new Error('timeoutMs must be positive');
        }
    }
    async ask(state, questions) {
        if (!this.apiKey)
            throw new Error('TYPESAFE_API_KEY is not configured');
        const request = buildJevRequest({ apiKey: this.apiKey, model: this.model, baseUrl: this.baseUrl }, state, questions);
        const response = await this.fetcher(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: AbortSignal.timeout(this.timeoutMs),
            redirect: 'error',
        });
        return parseJevResponse(response.status, response.ok, await response.text());
    }
}
//# sourceMappingURL=client.js.map