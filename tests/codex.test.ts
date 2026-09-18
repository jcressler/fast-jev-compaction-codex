import { describe, expect, it } from 'vitest';
import { compactCodexItems, parseCodexTranscript, type CodexItem } from '../src/codex.js';
import type { JevAsker, JevQuestions } from '../src/types.js';

function asker(value: number, seen: string[] = []): JevAsker {
  return {
    async ask(_state, questions: JevQuestions) {
      seen.push(...Object.keys(questions));
      return {
        answers: Object.fromEntries(
          Object.keys(questions).map((key) => [key, { type: 'noul' as const, noul: value }]),
        ),
      };
    },
  };
}

const call = (id: string, args = '{"path":"a.ts"}'): CodexItem => ({
  type: 'function_call', call_id: id, name: 'read_file', arguments: args,
});
const output = (id: string, text: string): CodexItem => ({
  type: 'function_call_output', call_id: id, output: text,
});

describe('Codex transcript parsing', () => {
  it('unwraps response_item JSONL and replaces history at compacted records', () => {
    const parsed = parseCodexTranscript([
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'old' } }),
      JSON.stringify({ type: 'compacted', payload: { replacement_history: [
        { type: 'message', role: 'user', content: 'replacement' },
      ] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'new' } }),
    ].join('\n'));
    expect(parsed.map((entry) => entry.content)).toEqual(['replacement', 'new']);
  });

  it('throws instead of resurrecting stale history for a broken compacted record', () => {
    expect(() => parseCodexTranscript([
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'old' } }),
      JSON.stringify({ type: 'compacted', payload: {} }),
    ].join('\n'))).toThrow(/replacement_history/);
  });

  it('accepts arrays and raw response item JSONL', () => {
    const direct = parseCodexTranscript(JSON.stringify([{ type: 'message', role: 'user', content: 'hi' }]));
    const raw = parseCodexTranscript(JSON.stringify({ type: 'message', role: 'user', content: 'hi' }));
    expect(direct[0]?.type).toBe('message');
    expect(raw[0]?.type).toBe('message');
  });

  it('skips rollout metadata and sanitizes malformed JSON errors', () => {
    const parsed = parseCodexTranscript([
      JSON.stringify({ type: 'world_state', secret: 'do not archive' }),
      JSON.stringify({ type: 'inter_agent_communication_metadata', secret: 'do not archive' }),
      JSON.stringify({ type: 'token_usage_record', secret: 'do not archive' }),
      JSON.stringify({ type: 'message', role: 'user', content: 'keep this' }),
    ].join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.content).toBe('keep this');

    expect(() => parseCodexTranscript('{"type":"message","content":"private"} trailing-secret'))
      .toThrow('Malformed Codex transcript JSON at document');
    expect(() => parseCodexTranscript('{"type":"message","content":"private"} trailing-secret'))
      .not.toThrow(/trailing-secret/);
  });

  it('applies nested compacted replacement boundaries in order', () => {
    const parsed = parseCodexTranscript(JSON.stringify([
      { type: 'message', role: 'user', content: 'before' },
      { type: 'compacted', replacement_history: [
        { type: 'message', role: 'user', content: 'first replacement' },
        { type: 'compacted', payload: { replacement_history: [
          { type: 'message', role: 'user', content: 'nested replacement' },
        ] } },
        { type: 'message', role: 'assistant', content: 'after nested' },
      ] },
    ]));
    expect(parsed.map((entry) => entry.content)).toEqual(['nested replacement', 'after nested']);
  });
});

describe('Codex compaction adapter', () => {
  it('drops a safe call and output together while preserving retained raw objects', async () => {
    const user = { type: 'message', role: 'user', content: 'inspect the file' } as CodexItem;
    const assistant = call('c1');
    const result = output('c1', 'x'.repeat(500));
    const tail = { type: 'message', role: 'assistant', content: 'done' } as CodexItem;
    const compacted = await compactCodexItems([user, assistant, result, tail], asker(0), {
      preserveRecentMessages: 1,
    });
    expect(compacted.items).toEqual([user, tail]);
    expect(compacted.items[0]).toBe(user);
    expect(compacted.items[1]).toBe(tail);
    expect(compacted.decisions[0]).toMatchObject({ action: 'drop_call' });
  });

  it('truncates only string outputs with a safe rerun notice', async () => {
    const user = { type: 'message', role: 'user', content: 'read' } as CodexItem;
    const assistant = call('c1');
    const result = output('c1', 'a'.repeat(400));
    const compacted = await compactCodexItems([user, assistant, result], {
      async ask(_state, questions) {
        return {
          answers: Object.fromEntries(Object.keys(questions).map((key) => [
            key,
            { type: 'noul' as const, noul: key.startsWith('call_') ? 0.8 : 0.2 },
          ])),
        };
      },
    }, {
      preserveRecentMessages: 0,
      truncateHeadChars: 10,
    });
    expect(compacted.items).toHaveLength(3);
    expect(compacted.items[1]).toBe(assistant);
    expect(compacted.items[2]).not.toBe(result);
    expect(compacted.items[2]?.output).toContain('do not rerun side-effect tools');
    expect(result.output).toBe('a'.repeat(400));
  });

  it('keeps unmatched, duplicate, ambiguous, and structured outputs without asking Jev', async () => {
    const seen: string[] = [];
    const items: CodexItem[] = [
      call('unmatched'),
      output('unmatched-output', 'text'),
      call('duplicate'),
      call('duplicate'),
      output('duplicate', 'text'),
      call('structured'),
      { type: 'function_call_output', call_id: 'structured', output: { ok: true } },
      { type: 'message', role: 'assistant', content: 'visible' },
    ];
    const compacted = await compactCodexItems(items, asker(0, seen), { preserveRecentMessages: 0 });
    expect(compacted.items).toEqual(items);
    expect(seen).toEqual([]);
    expect(compacted.decisions).toEqual([]);
  });

  it('pairs persisted custom tool text arrays while keeping malformed arrays opaque', async () => {
    const seen: string[] = [];
    const customCall = {
      type: 'custom_tool_call', call_id: 'custom-text', name: 'workspace_read', input: '{"path":"a"}',
    } as CodexItem;
    const customOutput = {
      type: 'custom_tool_call_output', call_id: 'custom-text',
      output: [{ type: 'input_text', text: 'workspace contents' }],
    } as CodexItem;
    const malformedCall = {
      type: 'custom_tool_call', call_id: 'custom-image', name: 'workspace_read', input: '{"path":"b"}',
    } as CodexItem;
    const malformedOutput = {
      type: 'custom_tool_call_output', call_id: 'custom-image',
      output: [{ type: 'input_image', image_url: 'https://example.invalid/image' }],
    } as CodexItem;
    const compacted = await compactCodexItems([
      { type: 'message', role: 'user', content: 'inspect the workspace' } as CodexItem,
      customCall,
      customOutput,
      malformedCall,
      malformedOutput,
    ], asker(0, seen), { preserveRecentMessages: 0 });

    expect(seen).toEqual(['call_t1', 'result_t1']);
    expect(compacted.items).toEqual([
      { type: 'message', role: 'user', content: 'inspect the workspace' },
      malformedCall,
      malformedOutput,
    ]);
  });

  it('protects a reversed output/call pair from deletion', async () => {
    const seen: string[] = [];
    const items: CodexItem[] = [
      output('reversed', 'result before call'),
      call('reversed'),
      { type: 'message', role: 'assistant', content: 'visible' },
    ];
    const compacted = await compactCodexItems(items, asker(0, seen), { preserveRecentMessages: 0 });
    expect(compacted.items).toEqual(items);
    expect(compacted.decisions).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('does not expose system, developer, or reasoning text to Jev', async () => {
    let stateText = '';
    const protectedAsker: JevAsker = {
      async ask(state, questions) {
        stateText = JSON.stringify(state);
        return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 1 }])) };
      },
    };
    await compactCodexItems([
      { type: 'message', role: 'system', content: 'SECRET SYSTEM INSTRUCTION' },
      { type: 'message', role: 'developer', content: 'SECRET DEVELOPER INSTRUCTION' },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE REASONING' }] },
      { type: 'message', role: 'assistant', channel: 'analysis', content: 'PRIVATE ANALYSIS' },
      { type: 'message', role: 'user', content: 'visible request' },
      call('safe'),
      output('safe', 'safe output'),
    ], protectedAsker, { preserveRecentMessages: 0 });
    expect(stateText).toContain('visible request');
    expect(stateText).not.toContain('SECRET SYSTEM INSTRUCTION');
    expect(stateText).not.toContain('SECRET DEVELOPER INSTRUCTION');
    expect(stateText).not.toContain('PRIVATE REASONING');
    expect(stateText).not.toContain('PRIVATE ANALYSIS');
  });

  it('reports archive item counts and serialized archive character counts', async () => {
    const items = [
      { type: 'message', role: 'user', content: 'keep' } as CodexItem,
      call('drop'),
      output('drop', 'x'.repeat(400)),
    ];
    const compacted = await compactCodexItems(items, asker(0), { preserveRecentMessages: 0 });
    expect(compacted.stats.messagesBefore).toBe(items.length);
    expect(compacted.stats.messagesAfter).toBe(compacted.items.length);
    expect(compacted.stats.charsBefore).toBe(JSON.stringify(items).length);
    expect(compacted.stats.charsAfter).toBe(JSON.stringify(compacted.items).length);
  });

  it('preserves first and recent boundaries', async () => {
    const seen: string[] = [];
    const items = [
      { type: 'message', role: 'user', content: 'first' } as CodexItem,
      call('old'), output('old', 'old result'),
      { type: 'message', role: 'assistant', content: 'middle' } as CodexItem,
      call('recent'), output('recent', 'recent result'),
    ];
    const compacted = await compactCodexItems(items, asker(0, seen), { preserveRecentMessages: 2 });
    expect(compacted.items).toEqual([items[0], items[3], items[4], items[5]]);
    expect(compacted.decisions.map((decision) => decision.reason)).toEqual(['call_dropped', 'pinned']);
    expect(seen).toContain('call_t1');
    expect(seen).not.toContain('call_t2');
  });
});
