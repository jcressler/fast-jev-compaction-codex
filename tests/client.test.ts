import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { JevClient, noulAnswer, parseJevResponse, parseCodexTranscript } from '../src/index.js';

describe('Jev transport safeguards', () => {
  it('reads the items in a hook checkpoint without treating its metadata as history', () => {
    const items = [{ type: 'message', role: 'user', content: 'fixture' }];
    expect(parseCodexTranscript(JSON.stringify({ version: 1, transcript: '/private/path', items }))).toEqual(items);
  });
  it('rejects out-of-range and malformed probabilities', () => {
    for (const noul of [-0.01, 1.01, NaN, Infinity]) {
      expect(() => noulAnswer({ test: { noul } }, 'test')).toThrow('Invalid Jev answer');
    }
  });
  it('aborts an unresponsive endpoint', async () => {
    const server = createServer((_req, _res) => { /* Intentionally no response. */ });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No TCP address');
      const client = new JevClient({ apiKey: 'synthetic', baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 40 });
      await expect(client.ask({}, {})).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('does not echo an error response containing private text', () => {
    expect(() => parseJevResponse(500, false, 'PRIVATE_CONTENT')).toThrow('Jev request failed (500)');
    try { parseJevResponse(500, false, 'PRIVATE_CONTENT'); }
    catch (error) { expect(String(error)).not.toContain('PRIVATE_CONTENT'); }
  });
});
