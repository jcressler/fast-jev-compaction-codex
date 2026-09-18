import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let cliPath = '';
let compiledDirectory = '';
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  compiledDirectory = await mkdtemp(join(tmpdir(), 'fast-jev-cli-build-'));
  cliPath = resolve(compiledDirectory, 'cli.js');
  const tsc = resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(process.execPath, [tsc, '--outDir', compiledDirectory, '--declaration', 'false',
    '--declarationMap', 'false', '--sourceMap', 'false'], { cwd: repoRoot });
});

afterAll(async () => {
  await rm(compiledDirectory, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function transcriptFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'fast-jev-cli-'));
  temporaryDirectories.push(directory);
  const input = join(directory, 'rollout.jsonl');
  const output = join(directory, 'pruned.json');
  const transcript = [
    { type: 'session_meta', payload: { id: 'test' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'inspect this' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'done' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(input, transcript, 'utf8');
  return { directory, input, output, transcript };
}

async function archiveFixture(label = 'first') {
  const value = await transcriptFixture();
  const lines = [
    { type: 'session_meta', payload: { id: 'cli-test' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: `request-${label}` } },
    { type: 'response_item', payload: {
      type: 'function_call', call_id: `call-${label}`, name: 'read_file', arguments: '{"path":"evidence.txt"}',
    } },
    { type: 'response_item', payload: {
      type: 'function_call_output', call_id: `call-${label}`, output: `tool evidence for ${label}`,
    } },
  ];
  await writeFile(value.input, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  value.transcript = await readFile(value.input, 'utf8');
  return value;
}

function environment(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FAST_JEV_DATA_DIR: join(directory, 'data') };
  delete env.FAST_JEV_ALLOW_NETWORK;
  delete env.TYPESAFE_API_KEY;
  return env;
}

async function invoke(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolveResult) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: options.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolveResult({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

describe('fast-jev-codex CLI', () => {
  it('documents repeatable Jev requirements in help', async () => {
    const result = await invoke(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/repeatable --requirement/);
    expect(result.stdout).toMatch(/1\.\.240/);
  }, 15_000); // Allow first-process startup on slower Windows CI workers.

  it('inspects a transcript offline without an API key or source mutation', async () => {
    const value = await transcriptFixture();
    const before = await readFile(value.input);
    const result = await invoke(['inspect', '--input', value.input], { env: environment(value.directory) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ items: 2, byType: { message: 2 } });
    expect(await readFile(value.input)).toEqual(before);
  });

  it('archives offline with a configured key but no network opt-in', async () => {
    const value = await archiveFixture();
    const archive = join(value.directory, 'evidence-archive');
    const before = await readFile(value.input);
    const result = await invoke(['archive', '--input', value.input, '--output', archive], {
      env: { ...environment(value.directory), TYPESAFE_API_KEY: 'must-not-be-used' },
    });
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as { archive: string; entries: number };
    expect(output.archive).toContain('index.json');
    expect(output.entries).toBeGreaterThan(0);
    expect(await readFile(value.input)).toEqual(before);
  });

  it('searches and retrieves archive evidence through the CLI', async () => {
    const value = await archiveFixture();
    const archive = join(value.directory, 'evidence-archive');
    const created = await invoke(['archive', '--input', value.input, '--output', archive], {
      env: environment(value.directory),
    });
    expect(created.code).toBe(0);
    const indexPath = join(archive, 'index.json');

    const search = await invoke(['search', '--archive', indexPath, '--query', 'call-first', '--limit', '1'], {
      env: environment(value.directory),
    });
    expect(search.code).toBe(0);
    const matches = JSON.parse(search.stdout) as { entries: unknown[] };
    expect(matches.entries.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(matches.entries)).toContain('call-first');

    const catalog = JSON.parse(await readFile(indexPath, 'utf8')) as { entries: Array<{ id: string }> };
    const evidenceId = (matches.entries[0] as { id: string }).id || catalog.entries[0].id;
    const retrieved = await invoke(['retrieve', '--archive', indexPath, '--id', evidenceId], {
      env: environment(value.directory),
    });
    expect(retrieved.code).toBe(0);
    const result = JSON.parse(retrieved.stdout) as { records: Array<Record<string, unknown>> };
    expect(result.records.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.records)).toContain('tool evidence for first');

    const status = await invoke(['status', '--archive', indexPath], { env: environment(value.directory) });
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ archive: indexPath, selection: null });
  });

  it('allows an existing archive directory to accumulate one transcript and rejects collisions', async () => {
    const value = await archiveFixture('first');
    const archive = join(value.directory, 'evidence-archive');
    const env = environment(value.directory);
    expect((await invoke(['archive', '--input', value.input, '--output', archive], { env })).code).toBe(0);

    await writeFile(value.input, value.transcript.replaceAll('first', 'second'), 'utf8');
    const cumulative = await invoke(['archive', '--input', value.input, '--output', archive], { env });
    expect(cumulative.code).toBe(0);

    const otherInput = join(value.directory, 'other-rollout.jsonl');
    await writeFile(otherInput, value.transcript, 'utf8');
    const collision = await invoke(['archive', '--input', otherInput, '--output', archive], { env });
    expect(collision.code).toBe(1);
    expect(collision.stderr).toMatch(/identity|transcript|different session/i);
  });

  it('finds a buried output fact offline and reports search coverage', async () => {
    const value = await archiveFixture();
    const lines = value.transcript.trim().split('\n').map(line => JSON.parse(line));
    lines[lines.length - 1].payload.output = `${'diagnostic noise '.repeat(2000)} buried-receipt-Z7 quantity=37`;
    await writeFile(value.input, lines.map(line => JSON.stringify(line)).join('\n'));
    const archive = join(value.directory, 'evidence-archive');
    const env = { ...environment(value.directory), TYPESAFE_API_KEY: 'unused-local-test-key' };
    expect((await invoke(['archive', '--input', value.input, '--output', archive], { env })).code).toBe(0);
    const args = ['search', '--archive', join(archive, 'index.json'), '--query', 'buried-receipt-Z7'];
    const result = await invoke(args, { env });
    expect(result.code).toBe(0);
    const found = JSON.parse(result.stdout);
    expect(found).toMatchObject({ mode: 'local', requests: 0, scan: { complete: true, nextOffset: null } });
    expect(found.entries).toHaveLength(1);
    expect(found.entries[0].matches[0].text).toContain('quantity=37');
    const invalid = await invoke([...args, '--offset', '-1'], { env });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('--offset');
  });

  it('requires explicit network opt-in and a key for optional Jev search', async () => {
    const value = await archiveFixture();
    const archive = join(value.directory, 'evidence-archive');
    const env = environment(value.directory);
    expect((await invoke(['archive', '--input', value.input, '--output', archive], { env })).code).toBe(0);
    const indexPath = join(archive, 'index.json');

    const noOptIn = await invoke(['search', '--archive', indexPath, '--query', 'call-first', '--jev'], { env });
    expect(noOptIn.code).toBe(1);
    expect(noOptIn.stderr).toContain('--allow-network');

    const noKey = await invoke(['search', '--archive', indexPath, '--query', 'call-first', '--jev', '--allow-network'], { env });
    expect(noKey.code).toBe(1);
    expect(noKey.stderr).toContain('TYPESAFE_API_KEY');
  });

  it('does not silently ignore requirements on a local-only search', async () => {
    const value = await archiveFixture();
    const archive = join(value.directory, 'evidence-archive');
    const env = environment(value.directory);
    expect((await invoke(['archive', '--input', value.input, '--output', archive], { env })).code).toBe(0);
    const result = await invoke(['search', '--archive', join(archive, 'index.json'), '--query', 'call-first', '--requirement', 'recover the result'], { env });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--requirement requires --jev');
  });

  it('handles malformed hook JSON as a successful empty response', async () => {
    const value = await transcriptFixture();
    const result = await invoke(['hook'], { env: environment(value.directory), input: '{not-json' });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });

  it('refuses compact without the explicit network flag', async () => {
    const value = await transcriptFixture();
    const result = await invoke(['compact', '--input', value.input, '--output', value.output], {
      env: environment(value.directory),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--allow-network is required');
  });

  it('refuses network compaction without TYPESAFE_API_KEY', async () => {
    const value = await transcriptFixture();
    const result = await invoke(['compact', '--input', value.input, '--output', value.output, '--allow-network'], {
      env: environment(value.directory),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('TYPESAFE_API_KEY is required');
  });

  it('refuses to overwrite an existing compact output before contacting Jev', async () => {
    const value = await transcriptFixture();
    await writeFile(value.output, '{"existing":true}\n', 'utf8');
    const before = await readFile(value.output);
    const result = await invoke(['compact', '--input', value.input, '--output', value.output, '--allow-network'], {
      env: { ...environment(value.directory), TYPESAFE_API_KEY: 'test-key' },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Output already exists');
    expect(await readFile(value.output)).toEqual(before);
  });

  it('rejects using the input path as the output path', async () => {
    const value = await transcriptFixture();
    const result = await invoke(['compact', '--input', value.input, '--output', value.input, '--allow-network'], {
      env: { ...environment(value.directory), TYPESAFE_API_KEY: 'test-key' },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Input and output must differ');
  });
});
