# Recovery replay benchmark

Run the deterministic local comparison after building the package:

```sh
npm run build
node benchmarks/replay.mjs
```

The output measures two sequential archive captures and public API retrieval.
Its generated tasks check exact
recovery of an old `EACCES` error, a successful `receipt-042` write, and a
second-compaction `PLAN-043` fact. It reports latency, bytes, factual recovery,
per-task results, and duplicate archived call IDs as a retrieval diagnostic.
The local mode has zero
network cost, and the archive mode checks that the source fixture is unchanged.
It does not simulate or label a native Codex model run. Use the emitted task
prompts and expected facts to record a separate native-only run if desired.

This fixture is deliberately synthetic. It is not a benchmark of a live Codex
model, native Codex compaction quality, or production traffic. For an optional
Jev measurement, provide a key and opt in explicitly:

```sh
$env:TYPESAFE_API_KEY = '...'
node benchmarks/replay.mjs --jev --allow-network
```

The optional Jev row ranks the same lossless local archive entries through Jev;
it does not use the legacy lossy compaction path. It reports request and usage
data; `costUsd` remains `null` because account pricing is not known to the
benchmark. Compare factual recovery and actual repeated-side-effect outcomes
against a separately captured native Codex session when evaluating production
behavior.

For recorded real-model runs, write a JSON document containing either an array
of runs or `{ "runs": [] }`. Each run may contain `mode`, `latencyMs`,
`usage`, `costUsd`, and `taskResults` entries shaped as
`{ "taskId": "old-error", "success": true, "repeatedSideEffects": 0, "repeatedMistakes": 0 }`.
Score it with:

```sh
node benchmarks/score.mjs recorded-runs.json
```

The scorer emits machine-readable task success, repeated mistakes, duplicate side effects,
latency, usage, and cost. Missing measurements are `null`; this report is
separate from the deterministic fixture result and does not claim live model
quality.

For a real comparison, fork the same task at the same native compaction boundary
with the same model and settings. Compare native-only, native plus local recovery,
and native plus recovery with optional Jev ranking. Keep original task prompts,
expected facts, constraints, and sandbox tool behavior identical. Do not provide
the expected answers to the agent. Include at least two compactions, an old failed
fix, a successful write receipt, and a later correction to an earlier instruction.
Run side effects against a disposable local fixture with a recorded action log.
Count repeated failed fixes and duplicate writes from that log; measure total
elapsed time and actual usage, including compaction, recovery reads, and Jev.
Record unobserved values as null. Repeat cases before claiming a quality or cost
improvement; the deterministic replay alone cannot establish either.

The scorer's grouped unknown handling can be checked offline with
`node benchmarks/score-self-test.mjs`.
