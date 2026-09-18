# Fast Jev Compaction for Codex

Fast Jev Compaction is a local evidence-recovery sidecar for Codex's native
compaction. Version 0.2.0 records stable, immutable content-addressed objects
and a cumulative index that survives compaction. It helps you find and inspect
earlier tool evidence after native compaction; it does not rewrite a live
transcript, replace native compaction, or claim live token reduction.

The default path is offline and requires no API key. Jev is an optional,
explicit retrieval-ranking aid. It is never required for recording, indexing,
search, or exact retrieval, and it never deletes records.

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

Hooks are disabled with `FAST_JEV_ENABLED=0`; the older
`FAST_JEV_ALLOW_NETWORK` variable no longer gates hooks. The data directory is
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

No key is needed for the default local recovery path. Optional Jev ranking
requires both `--jev --allow-network` on `search` and `TYPESAFE_API_KEY` in the
process environment. Keep keys out of files and Git.

## CLI

Archive a rollout into a durable local recovery directory:

```sh
node dist/cli.js archive --input rollout.jsonl --output DIRECTORY
```

Search the cumulative index offline:

```sh
node dist/cli.js search --archive DIRECTORY/index.json --query "migration failure" --limit 10
```

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

Jev ranking is opt-in and requires `TYPESAFE_API_KEY` only when explicitly
requested. It sends the query and bounded tool outcome snippets to TypeSafe;
the snippets are not a redactor and may contain sensitive text. Use it only
when that transfer is authorized. The local archive is complete for the
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
Real native-vs-local-vs-Jev benchmark outcomes have not yet been verified, so
this project makes no superiority claim. Synthetic checks do not imply a live
Codex compaction or live Jev result.

The original MIT-licensed scoring engine is retained with attribution in
[NOTICE](NOTICE). This is an independent community project.
