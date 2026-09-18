# Paired evidence ranking and native continuations

This experiment asks whether production Jev reranking adds value over the
v0.3.2 local raw-record search. It fixes the candidate set and recovery budget,
then compares answers from forks of one native-compacted history per case.
It is a synthetic factual-continuation test, not a full coding-agent benchmark.

## Fixed protocol

Six deterministic cases cover receipt corrections, failed deployments followed
by an approved release, and failed migrations with no writes. There are two
seeds per family and 24 paired records per case. IDs use uniform formatting;
they do not identify gold targets. Each case has dated revisions, supersession,
negation, and irrelevant records referring to the same entity. Canonical action
labels are shared across families and every answer field permits unknown/null.
Expected answers and target IDs are evaluator-only data.

The runner writes fixture, query, expected-answer, and implementation hashes
before any live request. Fixtures and rankings are fixed before continuations;
results do not alter the test. Default limits are six Jev calls, six native
compactions, and 48 continuation turns on `gpt-5.6-luna`, medium effort.

1. Archive the exact same generated records and run production local search.
   Freeze up to 20 candidates. Record upstream omissions without using gold
   labels to insert missing records.
2. Compare four arms: native only; enhanced local search; equal-score production
   ranking; and live Jev production ranking. The equal-score arm measures the
   older local ordering inside `rankEvidence`, with no network call.
3. Verify identical candidate ID sets for all recovery arms. Render each through
   the same projection of original visible outputs. Each recovery packet has
   a 1,800-character cap and each entry a 540-character cap. Stop when the next
   entry cannot fit; do not select entries using the hidden answers.
4. Start one synthetic base session per case. Append only generated visible
   message/tool records through the supported app-server interface, then run
   native compaction once. No reasoning or compaction items are constructed.
5. For each of two repetitions, fork that same compacted base for every arm.
   Require confirmed source lineage. Keep the query, model, effort, schema,
   instructions, and tool restrictions fixed. Only the recovery packet differs.
   Each arm occupies each execution position three times across the full run.
6. Score exact typed JSON fields. Missing, unknown, invalid, or incorrect values
   lose credit. Report all answers, field scores, latency, provider usage when
   available, and Jev requests. A technical failure is an incomplete experiment,
   never a silent local fallback counted as Jev.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
describes native compaction, appending visible items, and ephemeral forks. The
runner archives its generated base sessions afterward; answer forks remain
ephemeral. It uses the existing authenticated Codex profile without changing
global configuration. The Jev key is removed from Codex child environments.
Shell, apps, web search, hooks, and multi-agent capabilities are disabled for
the test; no archive tools are supplied during answers.

## Run

Offline checks need no key and make no model calls:

```sh
npm run build
node benchmarks/paired-fixtures.test.mjs
node benchmarks/paired-eval-self-test.mjs
npm run trial:paired
```

Live evaluation requires a compatible authenticated Codex CLI, an explicit
Jev key in `TYPESAFE_API_KEY`, and a new result directory:

```sh
node benchmarks/paired-eval.mjs --live --allow-network \
  --codex /absolute/path/to/codex --run-dir /new/private/run-directory
```

The key must come from secure local input, not the command line or a tracked
file. An existing `protocol.json` is never overwritten. The ordinary output is
aggregate progress; `report.json` contains synthetic answers and measurements,
not raw native compaction records or reasoning. Do not publish the raw run
directory or authentication files. Dollar cost remains null.

## Interpretation limits

Equal candidates do not imply equal internal visibility: production Jev sees
summaries capped at 100 characters and outcome excerpts capped at 120, while
local lexical search inspected the original records. That difference is part
of the implementation under test. Recovery packets use a common bounded
projection; they are not the automatic hook's packet. Automatic PreCompact
selection is not exercised by this test.

The history is scripted and compacted manually, so it has no live pre-compaction
reasoning trajectory. Closed-book answers isolate the supplied evidence but
do not measure iterative tool recovery or coding quality. A record's presence
in a packet does not guarantee all of its facts fit in the excerpt, and the
three historical target records are not all necessary to answer every case.

The two repetitions share one compaction and one Jev ranking; they are not
independent tasks. Seeds share templates. Native-only has no recovery packet.
Character budgets are not token budgets, and provider caches are not reset.
The reported native usage is thread-cumulative and may include inherited
usage; do not add it up as a verified billing estimate. These results cannot
support broad superiority, cost-saving, or statistical-significance claims.
