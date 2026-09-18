# Bounded archive search: offline results

Version 0.3.2 fixes a demonstrated retrieval gap. It does not establish a Jev
advantage over native Codex or over local recovery.

| Comparison on identical records | Old summary search | New archive search |
| --- | ---: | ---: |
| Generated queries finding the expected parent record | 30/48 | 48/48 |
| Previously empty searches from the longer trial | 0/3 | 3/3 |

The expected parent was the first result for all 48 generated queries and all
three saved-run queries. Exact record retrieval succeeded. All archived object
hashes remained unchanged. No Codex or Jev model calls were made for this
evaluation; it ran locally without a key.

## What changed

Search now reads bounded original visible records, including structured and
JSON-encoded batched output, and returns excerpts around query matches.
Matches identify the original content ID, record index, and input/output/message
field. Tool calls and results remain paired in their immutable parent object.
Existing v2 archives work without migration.

The CLI, replay benchmark, and longer-task evaluator use the same search API.
The recovery packet explains pagination. Optional explicit Jev search reranks
up to 20 local matches using bounded output/message excerpts; its existing
network and key gates remain. Automatic PreCompact Jev candidate extraction
is unchanged.

Each search page permits 128 eligible entries, 8 MiB of object reads, and 2 MiB
per object. It verifies hashes and excludes protected records. Missing, corrupt,
oversized, or extraction-limited records produce explicit gaps. Pagination
continues through later entries. These bounds exclude cumulative catalog
loading. The three excerpts per result are a preview, not every occurrence.

## Generated fixture

Six separately captured batches contain 90 response items and 48 queries.
Identifiers and quantities differ from the earlier longer trial. Cases include
inputs, user messages, failed results, structured content, nested JSON arrays,
and facts before, between, or after diagnostic text exceeding 17 KB.

The old and new search implementations see the same archive and query text.
The benchmark counts whether the expected parent appears, rather than treating
any returned entry as success. The old search returned 60 total entries across
the queries but found the correct parent for only 30. New search returned 48
entries and found all 48 expected parents, with correct match fields.

Reproduce the generated comparison after building:

```sh
npm run build
node benchmarks/batched-search.mjs
```

## Replay of the observed failure

The local arm of the earlier v0.3.1 longer trial made three searches that
returned no entries: `synthetic_receipt_lookup`, `receiptId`, and `legacy`.
Replaying those queries against its unchanged final archive now finds the
original batched call/result pair first in all three cases. The receipt search
shows `receipt-RR-0918-042-r2`; the legacy search shows the preview failure and
that no mutation occurred. The original records remain retrievable by ID.

Two queries also legitimately match the initial user instruction, so this replay
returns five total entries across three queries. All three find the expected
pair and the correct input/output field. This comparison uses the final saved
archive, not a rerun at each original search timestamp. Raw archives remain
local because they can also contain opaque native records. Only aggregate
results are published in [the machine-readable report](BATCHED-SEARCH-2026-09-18.json).

## What this proves and what remains

This proves that bounded raw search can recover lexical facts the summary
index omitted, including the observed batched-output failure. The saved-run
queries were chosen because they failed earlier; they are regression checks,
not a held-out outcome evaluation. The generated queries likewise test known
identifiers, not broad semantic understanding.

The longer coding task has not been rerun with this fix, and its historical
scores remain unchanged. Ninety-five unit tests, type checking, the build,
existing offline benchmarks, and plugin/skill validation pass.

The next evidence needed for a Jev claim is a repeated comparison against this
stronger local baseline using the same evidence and context budget, followed
by controlled model continuations. Until then, improved retrieval is measured;
better coding accuracy, lower total cost, or superior compaction is not.
