// Bounded synthetic-code evaluator: output and the no-mutation contract are checked.
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
      const code = `"use strict";\n${source}\nconst fixtureInput = JSON.parse(${JSON.stringify(JSON.stringify(test.input))});\nconst fixtureResult = solve(fixtureInput);\nJSON.stringify({ result: fixtureResult, input: fixtureInput });`;
      const encoded = new Script(code).runInContext(context, { timeout: 150 });
      const actual = JSON.parse(encoded);
      return { index, passed: isDeepStrictEqual(actual.result, test.expected) && isDeepStrictEqual(actual.input, test.input) };
    } catch { return { index, passed: false }; }
  });
  process.stdout.write(JSON.stringify(results));
} catch { process.exitCode = 2; }
