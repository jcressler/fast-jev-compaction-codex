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
  it('inspects a transcript offline without an API key or source mutation', async () => {
    const value = await transcriptFixture();
    const before = await readFile(value.input);
    const result = await invoke(['inspect', '--input', value.input], { env: environment(value.directory) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ items: 2, byType: { message: 2 } });
    expect(await readFile(value.input)).toEqual(before);
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
