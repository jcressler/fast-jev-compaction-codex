# Recovery replay benchmark

For the controlled same-candidate comparison and repeated native continuations,
see [the paired evaluation protocol](PAIRED-EVAL.md). It compares enhanced local
search, the production equal-score ordering control, live Jev, and native-only
answers from forks of a common compacted history.
The [first paired results](PAIRED-RESULTS-2026-09-18.md) found no benefit from the
current Jev search reranker over enhanced local recovery.

`node benchmarks/batched-search.mjs` compares summary search with bounded raw
archive search on the same generated records, entirely offline. It checks
parent IDs, query-centered match fields, exact retrieval, and unchanged objects
across six captures. To replay an existing synthetic archive, provide
`--archive DIRECTORY/index.json --queries queries.json`; descriptors can include
`query`, `entryId` or `callId`, `field`, and an expected `fact`. Repeated `--query`
arguments support discovery checks without expected IDs. Output contains
aggregate counts, never archived text. The
[recorded search results](BATCHED-SEARCH-2026-09-18.md) distinguish coverage from
end-to-end model quality.

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

## Longer live coding task

`long-task.mjs` runs four stages of a synthetic receipt-reconciliation coding
task with three real native Codex compactions. The four arms are native only,
local heuristic recovery, an offline equal-score control using Jev's candidate
generation algorithm, and live Jev selection. Each arm starts from the same
files and prompts. A saved protocol and fixture hash precede any model call.
Hidden final checks assess code behavior, a factual audit artifact, corrected
requirements, and the action log. Simulated writes cannot affect a real system.
The arms generate separate transcripts, so their actual candidate records can
differ; this is not a paired replay of one identical candidate set.

The runner needs Node 22.12+, a built checkout, an authenticated compatible
Codex CLI, and an explicitly supplied Jev key for the Jev arm. It makes real
model/API requests only with both `--live` and `--allow-network`.

```sh
node benchmarks/long-task.mjs --live --allow-network \
  --codex /absolute/path/to/codex --run-dir /new/results/directory \
  --modes native
```

For recovery arms, prepare a separate Codex profile and authenticate it using
Codex's supported login flow. Configure its `hooks.json` with the repository's
PreCompact/SessionStart matchers and limits, replacing each hook command with:

```text
node "/absolute/path/to/checkout/benchmarks/long-task-hook.mjs" "../hook-profile.json"
```

Use the same command for `commandWindows` on Windows. Launch the CLI in that
profile with `--enable plugin_hooks`, review these two exact commands in
`/hooks`, and trust them. Do not bypass trust or hand-edit trust hashes. Set
`LONG_TASK_CODEX_HOME` to that profile and `TYPESAFE_API_KEY` through your local
secret mechanism, then run:

```sh
node benchmarks/long-task.mjs --live --allow-network \
  --codex /absolute/path/to/codex --run-dir /new/recovery/results \
  --modes local,candidate-order,jev \
  --hook-setup benchmarks/long-task-hook-setup.mjs
```

The setup helper only selects the supplied profile. The runner requires exactly
two trusted hooks. The hook bridge calls the production archive/recovery code;
the app-server itself dispatches it. It records capture, selection, and actual
context restoration, and rejects incomplete integration as a valid result.
The equal-score arm uses an in-process scorer and makes zero Jev requests.
Generated module checks run in a child process without inherited credentials.
The evaluator uses syntax checks during the task and hidden behavioral checks
afterward; it does not reveal hidden expected outputs to the model.

Results include per-stage time, cumulative native usage, repeated read counts,
side-effect attempts, Jev usage, and hook telemetry. Re-reading a changed file
can be useful: repeated reads are descriptive, not automatically mistakes.
Dollar cost remains unknown. Raw local archives may include opaque native
records; publish only reviewed aggregate reports, never those archives or any
profile authentication files.

This is a bounded, exploratory task. Compactions are forced at stage boundaries,
not caused by exhausting the context window. One run per arm cannot establish
a causal speed/cost improvement or general coding-quality advantage. User-hook
dispatch also does not, by itself, prove bundled-plugin hook discovery works.
