# Fast Jev Compaction for Codex

Fast Jev Compaction adds task-aware Jev evidence selection around Codex's native
compaction. Version 0.3.2 records stable, immutable content-addressed objects
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
Automatic Jev selection at compaction still uses bounded excerpts; this release
improves archive search, not that selector's candidate extraction.

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
Mode `local-fallback` means Jev selection did not complete successfully; it is
not a successful Jev experiment. Reports contain no API key or raw task text.
Set `FAST_JEV_MODE=local` to turn off automatic Jev requests. Explicit CLI
search ranking still requires `--jev --allow-network` and a key.

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
Each result includes up to three 280-character match excerpts.
Oversized, missing, corrupt, or extraction-limited objects are reported as gaps;
they do not prevent later objects from being searched. A final page can have
`nextOffset: null` and `complete: false` when gaps remain. Exact retrieval uses
the existing separate limits. These scan limits exclude catalog loading, which
merges cumulative capture manifests. Queries allow up to 4,000 characters and
64 distinct terms.

Use optional Jev ranking only when the transfer is authorized:

```sh
TYPESAFE_API_KEY=your-key node dist/cli.js search \
  --archive DIRECTORY/index.json --query "migration failure" \
  --limit 10 --jev --allow-network
```

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
query and bounded visible tool/message excerpts centered on local search matches
(at most 20 candidates, 120 outcome characters per candidate). It does not send
raw objects or match arrays. Failure falls back to the local search order.
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

The original MIT-licensed scoring engine is retained with attribution in
[NOTICE](NOTICE). This is an independent community project.
