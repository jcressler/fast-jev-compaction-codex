// Child-only evaluator. No host objects or Node APIs are exposed to generated code.
// This bounded VM is for these synthetic trials, not a general untrusted-code service.
import { createContext, Script } from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 200_000) process.exit(2);
}
try {
  const { source, tests } = JSON.parse(input);
  if (typeof source !== 'string' || source.length > 20_000 || !Array.isArray(tests)) process.exit(2);
  const results = tests.map((test, index) => {
    try {
      const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
      const code = `"use strict";\n${source}\nJSON.stringify(solve(JSON.parse(${JSON.stringify(JSON.stringify(test.input))})));`;
      const encoded = new Script(code).runInContext(context, { timeout: 150 });
      return { index, passed: isDeepStrictEqual(JSON.parse(encoded), test.expected) };
    } catch { return { index, passed: false }; }
  });
  process.stdout.write(JSON.stringify(results));
} catch { process.exitCode = 2; }
