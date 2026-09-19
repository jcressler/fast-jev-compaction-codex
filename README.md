# Fast Jev Compaction for Codex

**Experimental. Native integration is verified; a coding-quality benefit has not
been established.** Version 0.3.5 was exercised through the actual installed
plugin in 42 native Codex runs. Every run passed its integration checks,
including live Jev requests and matching delivered-context hashes. The
[contract audit](benchmarks/AUTOMATIC-CONTRACT-AUDIT-2026-09-18.md) found missing
output-schema details in the benchmark's visible instructions, so those coding
scores are retained as contract-invalid and cannot fairly rank the approaches.
A [fresh explicit-contract comparison](benchmarks/AUTOMATIC-EXPLICIT-EVAL.md)
keeps the hidden grader and thresholds while clarifying every required shape.

The earlier [explicit-retrieval comparison](benchmarks/CORRECTED-RESULTS-2026-09-18.md)
found Jev and local retrieval each passing 7/8 runs, versus 6/8 for its native
reference. That small test did not show added value over local retrieval and
used a different design from automatic installed-plugin recovery. Native
compaction and optional local retrieval remain the defaults.

Fast Jev Compaction adds task-aware Jev evidence selection around Codex's native
compaction. It records stable, immutable content-addressed objects
and a cumulative index that survives compaction. It helps you find and inspect
earlier tool evidence after native compaction; it does not rewrite a live
transcript, replace native compaction, or claim live token reduction.

Enable Jev mode with a TypeSafe key to automatically rank recovery evidence at
compaction time. Jev sees a bounded task context plus paired tool inputs and
results; its ordering shapes the next recovery index. The default local mode
requires no key. Both modes preserve all archived records for exact retrieval.

## What the plugin does

The hooks capture local evidence around native Codex compaction. Each record is
stored as an immutable content-addressed object. The cumulative index points to
those objects and remains available after later compactions. Parsed JSON tool
input and tool output are retained as an exact paired record when both are
available. Reasoning is kept opaque: it is stored locally, never injected into
recovery context, and never sent to or scored by Jev. A uniquely valid call and
matching output are stored as one paired record; ambiguous or malformed pairs
remain separate records.

The small index contains heuristic flags for intent, outcome, failure, write,
constraint, and decision. These flags are routing hints, not an exhaustive
semantic guarantee. Raw records remain retrievable by full content ID when a
flag is insufficient. Recovery reads historical evidence only; it does not
authorize repeating a recorded action.

Search inspects the original visible inputs, outputs, and messages, including
structured and JSON-encoded batches. It returns query-centered excerpts with
the original parent ID, record index, and field. This works with existing v2
archives without rebuilding an index or changing stored objects.
Search is lexical and bounded: a missing result is not proof of absence.
Automatic Jev selection at compaction uses bounded paired tool excerpts.
Explicit search reranking uses fuller visible evidence, optional task context,
and stable local ordering on ties or failed requests. Version 0.3.4 uses binary
Noul questions with explicit criteria. Optional `--requirement` values identify
the facts or constraints the answer must cover. Jev judges support separately
for each requirement, and code favors evidence covering different requirements.
This estimates coverage; it does not guarantee that every needed fact is present.
Version 0.3.5 brings the same requirement-coverage ordering into automatic
`PreCompact` recovery. It derives up to six requirement units from archived
user messages, asks separate binary support questions, and favors evidence
covering different requirements. This is a bounded heuristic, not a complete
understanding of the task. Oversized units are omitted instead of spliced into
potentially different instructions; omission counts and source IDs are recorded.
Fenced code and simple acknowledgements are excluded from requirement extraction;
omission counts cover the remaining units rejected by the length or count limits.
Tool and assistant text can supply evidence but cannot define requirements.
Both selection paths share the coverage-ordering implementation. Their candidate
pools, excerpts, and final context formatting still differ, so the v0.3.4 search
results are not evidence of automatic-hook quality.

Hooks are disabled with `FAST_JEV_ENABLED=0`. `FAST_JEV_ALLOW_NETWORK=1` enables
network use only together with `FAST_JEV_MODE=jev` and a key. It does not gate
local capture. The data directory is
selected exactly from `FAST_JEV_DATA_DIR`, then `PLUGIN_DATA`, then
`CODEX_HOME/fast-jev-compaction-codex`, with a `homedir/.codex` fallback.
Pending recovery is single-use and valid for ten minutes. Objects have no
automatic deletion policy, so disk usage grows until the operator removes old
data. The hook fails open so native Codex compaction can continue.

Each archive keeps `index.json`, immutable `objects`, and immutable `captures`
together. Publication uses filesystem hardlinks for its local snapshot; a
filesystem without hardlink support cannot create that snapshot. On Windows,
local privacy depends on the ACLs of the selected parent directory.

## Install

Requirements: Node.js **22.12+** on Codex's `PATH`, and a Codex build that
supports the configured compaction hooks. Built JavaScript is included, so
plugin users do not need `npm install`.

```sh
codex plugin marketplace add jcressler/fast-jev-compaction-codex
codex plugin add fast-jev-compaction-codex@fast-jev-compaction-codex
```

Start a new Codex session and use `/hooks` to review and trust the hooks.
Installing a plugin does not automatically trust its hooks.

This package uses `.codex-plugin/plugin.json` and the default `hooks/hooks.json` path.
CLI 0.155.0 recognizes these bundled hooks, but skips hook loading when a root
portable `plugin.json` takes precedence. Version 0.3.1 removes that conflicting
manifest. After updating, verify that `/hooks` lists both `PreCompact` and
`SessionStart`; enable `plugin_hooks` on builds that gate hook support behind
that feature. Hook discovery and trust are separate from a successful Jev API call.

## Test Jev

Start with synthetic data from a checkout. On Windows, this script prompts for
the key with hidden input, runs the live comparison, and removes the temporary
process environment setting when it finishes:

```powershell
.\scripts\test-jev.ps1
# If you have already copied the key, use .\scripts\test-jev.ps1 -FromClipboard
```

On other platforms, provide `TYPESAFE_API_KEY` through your shell's secret input
or secret manager, then run `node benchmarks/jev-trial.mjs --live --allow-network`.
Running `node benchmarks/jev-trial.mjs` alone is the offline smoke test.
See [the trial protocol](benchmarks/JEV-TRIAL.md). The test sends only generated
synthetic data, never your existing Codex sessions.

## Use Jev automatically in Codex

After installing and trusting the hooks, start Codex with these environment
variables in the **Codex process**, not just a separate terminal:

| Variable | Value |
| --- | --- |
| `TYPESAFE_API_KEY` | Your TypeSafe key, provided securely |
| `FAST_JEV_MODE` | `jev` |
| `FAST_JEV_ALLOW_NETWORK` | `1` |
| `FAST_JEV_TIMEOUT_MS` | Optional, default `8000`, clamped to `100..15000` |

For example, after setting the key with hidden input in PowerShell:

```powershell
$env:FAST_JEV_MODE = 'jev'
$env:FAST_JEV_ALLOW_NETWORK = '1'
codex
```

At `PreCompact`, the hook saves all evidence, then makes at most one bounded Jev
request. `SessionStart` with source `compact` reads the saved ordering and
restores a small index before continuation; it makes no network call. Recent
user instructions remain prioritized independently of Jev's scores. Native
compaction, its reasoning state, and the live transcript are unchanged.
Missing authorization/key, network errors, invalid scores, and timeouts use
local recovery instead. Inspect what actually ran using the archive path shown
in the recovery context:

```sh
node dist/cli.js status --archive DIRECTORY/index.json
```

The plugin caps its index at 6,000 characters. Codex's separate
`additionalContextLimit: 4000` setting is an approximate token threshold,
as described in the [official hook documentation](https://developers.openai.com/codex/hooks).

The local `selection-<generation>.json` report records `mode`, selected IDs,
request count, latency, request character count, and available model/token usage.
Automatic Jev reports also include requirement counts and source IDs. After
`SessionStart`, `emittedIds`, `emittedContextChars`, and `emittedContextSha256`
describe the actual bounded index returned by the hook. Emission does not prove
that the native host accepted the context or that the model used every excerpt.
Mode `local-fallback` means Jev selection did not complete successfully; it is
not a successful Jev experiment. Reports contain no API key or raw task text.
Set `FAST_JEV_MODE=local` to turn off automatic Jev requests. Explicit CLI
search ranking still requires `--jev --allow-network` and a key.

Check the production hook functions with synthetic data:

```sh
node benchmarks/automatic-hook-check.mjs
# Exactly one live Jev request; requires TYPESAFE_API_KEY:
node benchmarks/automatic-hook-check.mjs --live --allow-network --output hook-check.json
```

This check validates requirement propagation, metadata, immutable originals,
and the single-use handoff. It does not launch Codex or measure coding quality.
The [frozen automatic evaluation protocol](benchmarks/AUTOMATIC-EVAL.md) describes
a separate comparison with ordinary Codex, local recovery, and Jev recovery.

## CLI

Archive a rollout into a durable local recovery directory:

```sh
node dist/cli.js archive --input rollout.jsonl --output DIRECTORY
```

Search the cumulative archive offline:

```sh
node dist/cli.js search --archive DIRECTORY/index.json --query "migration failure" --limit 10
```

Each scan reads at most 128 eligible entries and 8 MiB of object bytes, with a
2 MiB per-object limit. It scans full eligible objects, not just their prefixes.
Inspect `scan.complete`, `scan.skipped`, and `scan.nextOffset`; continue using
`--offset NEXT_OFFSET` when present. Cursors address catalog entries, not ranked
results, so each page ranks only its scanned entries. `scan.resultsTruncated`
means the result limit omitted matching entries; increase `--limit` up to 100.
Each result includes up to three 280-character match excerpts and a visible
`rerankEvidence` view capped at 1,800 characters.
Oversized, missing, corrupt, or extraction-limited objects are reported as gaps;
they do not prevent later objects from being searched. A final page can have
`nextOffset: null` and `complete: false` when gaps remain. Exact retrieval uses
the existing separate limits. These scan limits exclude catalog loading, which
merges cumulative capture manifests. Queries allow up to 4,000 characters and
64 distinct terms.

Use optional Jev ranking only when the transfer is authorized:

```sh
node dist/cli.js search \
  --archive DIRECTORY/index.json --query "migration failure" \
  --task-context "Continue the approved schema repair; preserve earlier constraints" \
  --requirement "The currently approved schema version" \
  --requirement "The previous failed migration and its cause" \
  --limit 10 --jev --allow-network
```

Supply `TYPESAFE_API_KEY` through secure shell input or your secret manager.
Pass up to six distinct requirements, each 1–240 characters. Describe what the
answer needs to establish; do not supply evaluator answers. Requests without
requirements use a single binary relevance question per candidate.

Retrieve exact raw content by its full content ID. Retrieval is bounded and
paginated; it never reruns a tool or writes to recover missing evidence:

```sh
node dist/cli.js retrieve --archive DIRECTORY/index.json \
  --id FULL_CONTENT_ID --offset 0 --max-chars 12000
```

`inspect --input <path>` remains an offline diagnostic for supported transcript
shapes. The legacy `compact --input <path> --output <path> --allow-network`
workflow remains documented as an isolated archival experiment. It is
incompatible with guaranteed live replay and is not the recommended workflow.

## Jev boundary

Jev hooks send bounded user objectives, recent user/assistant discussion, and
candidate tool input/output excerpts to TypeSafe. Explicit Jev search sends the
query (up to 1,000 characters), optional task context (up to 2,000), and bounded
visible output/message excerpts (at most 20 candidates, up to 1,800 evidence
characters plus 300 outcome characters per candidate). Structured corrections,
status, and chronology are retained when they fit. State plus questions are
capped at 48 KiB, shrinking evidence if necessary while retaining every
candidate. Search reranking excludes raw tool input, objects, and match arrays.
Tied scores and failures preserve the original local search order.
These excerpts are not a redactor and
may contain sensitive text; configure Jev only for tasks whose transfer is
authorized. Opaque reasoning and system/developer records are excluded. The local archive is complete for the
records it received and is the source of truth for retrieval. Jev may influence
result ordering; it does not decide whether records exist, does not rewrite the
transcript, and does not delete objects. Missing keys, network errors, or
invalid rankings leave local search and native compaction available.

Stable references use full content IDs and the cumulative archive path. Keep
`index.json`, `objects`, and `captures` together when moving an archive.
Archives from v0.1 are left untouched and were lossy; v0.2 does not recreate
items that were already removed when the active transcript no longer contains
them.

## Development and benchmark status

The build and transcript runtime target Node.js 22.12+. Run the ordinary local
checks from a checkout:

```sh
npm ci
npm run check
```

`npm run benchmark` checks local recovery across two synthetic compaction
boundaries, including large outputs and irrelevant tool results. It also checks
the scorer for separately recorded real-model runs. Optional Jev ranking needs
an explicit network flag. See [the evaluation protocol](benchmarks/README.md).
The live Jev trial checks evidence selection against the local heuristic with
the same recovery character budget. It reports real API calls separately from
offline checks. It is not an end-to-end native-vs-local-vs-Jev Codex benchmark
and does not establish better coding accuracy or lower total cost.
The [initial live results](benchmarks/RESULTS-2026-09-18.md) include a local
control using the same candidate pool, which matched Jev on the tested targets.

A separate [longer native coding trial](benchmarks/LONG-TASK-2026-09-18.md)
completed four stages and three native compactions per arm. Native Codex and
Jev-assisted recovery both scored 100/100; local recovery and the candidate-order
control scored 84/100 after losing receipt facts in their final audits. All three
automatic Jev calls and restorations succeeded. This single task demonstrates
integration, not an advantage over native defaults, and exposed a batched-output
search weakness. Version 0.3.2 addresses that retrieval failure; the longer model
trial has not been rerun with the fix. See the
[offline search evaluation](benchmarks/BATCHED-SEARCH-2026-09-18.md) for the
same-record comparison. Neither evaluation establishes that Jev improves Codex.

A subsequent [paired reranking evaluation](benchmarks/PAIRED-RESULTS-2026-09-18.md)
used six real native compactions, identical candidate sets, equal recovery
character caps, and 48 continuations from confirmed common-base forks. Native
and enhanced local recovery each answered 12/12 correctly; Jev and the
equal-score production-order control each answered 8/12. This tests explicit
search reranking with a custom evidence packet, not automatic PreCompact
selection. It provides no basis to recommend the tested v0.3.2 Jev reranker by
default; Jev remains experimental.

The [earlier bounded protocol](benchmarks/HELDOUT-EVAL.md) tested the revised
reranker on four new coding-maintenance cases with three native compactions
per case and shared exact recovery tools. Its stopping rule is fixed before
live execution; improved excerpt fidelity alone is not evidence of better
Codex outcomes. [The completed comparison](benchmarks/HELDOUT-RESULTS-2026-09-18.md)
passed all 64 code checks per approach but found no reliable Jev advantage over
the native reference. Literal fact scores include wording differences; a
separate post-hoc semantic audit distinguishes those from missing facts.
An initial two-case pilot was invalidated because its visible
task contracts omitted details expected by hidden tests; the corrected protocol
discloses that repair and excludes those outcomes.

The subsequent implementation audit found an additional limitation: the Noul
question requested an ordinal utility rating, and the ranker lacked the exact
fact fields requested from Codex. Version 0.3.4 corrects those issues. The
[fresh comparison protocol](benchmarks/CORRECTED-EVAL.md) gives every approach
the same explicit requirements and evaluates complementary evidence selection
on four new tasks. [Completed results](benchmarks/CORRECTED-RESULTS-2026-09-18.md)
show 7/8 fully correct runs for Jev and local retrieval, 6/8 for the native
reference, and 24/24 factual answers for every approach. Coding differences
were regex-escaping errors on one task. No approach needed a recovery call;
Jev did not meet the preregistered added-value threshold. The report records
actual synthetic Jev requests and probabilities for inspection.
Old results remain available; the earlier recommendation to
shelve the overall idea should not be treated as a verdict on every Jev design.

The original MIT-licensed scoring engine is retained with attribution in
[NOTICE](NOTICE). This is an independent community project.
