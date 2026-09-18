import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Minimal app-server evaluation client. Records no reasoning deltas or credentials. */
export class CodexEvalClient {
  constructor(binary, cwd, env = process.env, onTool = async () => ({ error: 'No tool handler' }), configArgs = []) {
    this.events = [];
    this.pending = new Map();
    this.sequence = 0;
    this.onTool = onTool;
    this.closed = false;
    this.child = spawn(binary, ['app-server', ...configArgs], { cwd, env, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] });
    // Native diagnostics can include local paths and configuration. Do not publish them.
    this.child.stderr.resume();
    this.child.on('error', () => this.fail(new Error('Could not launch Codex app-server')));
    this.child.on('exit', () => this.fail(new Error('Codex app-server exited')));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && message.method) {
        void this.handleRequest(message);
      } else if (this.pending.has(message.id)) {
        const job = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(job.timer);
        message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result);
      } else if (message.method && !/reasoning|delta|rawResponse/i.test(message.method)) {
        if ((message.method === 'item/started' || message.method === 'item/completed') &&
            message.params?.item?.type === 'reasoning') return;
        this.events.push(message);
      }
    });
  }

  fail(error) {
    this.closed = true;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }

  send(message) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }

  async handleRequest(message) {
    if (message.method !== 'item/tool/call') {
      this.send({ id: message.id, error: { code: -32601, message: 'This evaluation supports only its declared dynamic tools.' } });
      return;
    }
    try {
      const result = await this.onTool(message.params);
      this.send({ id: message.id, result: { contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
        success: !result?.error } });
    } catch {
      this.send({ id: message.id, result: { contentItems: [{ type: 'inputText', text: JSON.stringify({ error: 'Tool failed in evaluation workspace' }) }], success: false } });
    }
  }

  request(method, params, timeoutMs = 45000) {
    if (this.closed) return Promise.reject(new Error('Codex app-server is closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'jev_long_task_eval', version: '0.3.0' },
      capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }

  async waitFor(method, after, predicate = () => true, timeoutMs = 180000) {
    const started = Date.now();
    let cursor = after;
    while (Date.now() - started < timeoutMs) {
      while (cursor < this.events.length) {
        const event = this.events[cursor++];
        if (event.method === method && predicate(event.params)) return event.params;
      }
      if (this.closed) throw new Error('Codex app-server exited before completion');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${method}`);
  }

  async turn(threadId, text, { outputSchema, effort, timeoutMs = 180000 } = {}) {
    const after = this.events.length;
    const started = Date.now();
    const response = await this.request('turn/start', { threadId,
      input: [{ type: 'text', text, text_elements: [] }],
      ...(outputSchema ? { outputSchema } : {}), ...(effort ? { effort } : {}) });
    const completion = await this.waitFor('turn/completed', after,
      p => p.threadId === threadId && (!response.turn?.id || p.turn?.id === response.turn.id), timeoutMs);
    const items = this.events.slice(after).filter(e => e.method === 'item/completed' && e.params.threadId === threadId).map(e => e.params.item);
    if (completion.turn?.status !== 'completed') throw new Error(completion.turn?.error?.message ?? 'Codex turn failed');
    return { latencyMs: Date.now() - started,
      answer: items.filter(i => i.type === 'agentMessage').map(i => i.text).join('\n'),
      toolCalls: items.filter(i => i.type === 'dynamicToolCall').length };
  }

  async compact(threadId) {
    const after = this.events.length;
    const started = Date.now();
    await this.request('thread/compact/start', { threadId });
    const completion = await this.waitFor('turn/completed', after, p => p.threadId === threadId);
    if (completion.turn?.status !== 'completed') throw new Error(completion.turn?.error?.message ?? 'Native compaction failed');
    const completed = this.events.slice(after).some(e => e.method === 'item/completed' && e.params?.item?.type === 'contextCompaction');
    if (!completed) throw new Error('No completed native contextCompaction event');
    return { latencyMs: Date.now() - started, completed: true };
  }

  usage(threadId) {
    return this.events.filter(e => e.method === 'thread/tokenUsage/updated' && e.params.threadId === threadId)
      .at(-1)?.params.tokenUsage.total ?? null;
  }

  close() { this.child.kill(); this.fail(new Error('Evaluation finished')); }
}
