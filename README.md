# Fast Jev Compaction for Codex

Preserve exact tool evidence across Codex compaction, using TypeSafe's Jev to
decide which old tool calls and outputs still matter.

Adapted from [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction).
The original MIT-licensed scoring engine is retained with attribution in
[NOTICE](NOTICE). This is an independent community project.

## What works in Codex

**Codex does not expose Claude Code's `session.compact` replacement callback.**
This project has two modes:

| Mode | Behavior |
| --- | --- |
| Codex plugin | `PreCompact` saves a Jev-pruned local archive. `SessionStart` with source `compact` restores bounded evidence after Codex's normal compaction. |
| Library / CLI | Prunes a separate array of Codex response items, preserving retained records and call/result pairs. You control where that result is used. |

The plugin does **not** replace Codex's summary, edit live rollouts, change
compaction thresholds, or claim a reduction in the live context window.
Restored evidence adds context. Archive reduction is a separate measurement.
This is the supported boundary in the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks).

## Install the plugin

Requirements: Node.js **22.12+** on Codex's `PATH`, a current Codex build with
`PreCompact` and `SessionStart` compaction hooks, and a TypeSafe Jev API key.
Built JavaScript is included, so plugin users do not need `npm install`.

```sh
codex plugin marketplace add jcressler/fast-jev-compaction-codex
codex plugin add fast-jev-compaction-codex@fast-jev-compaction-codex
```

Start a new Codex session and use `/hooks` to review and trust both hooks.
Installing a plugin does not automatically trust its hooks. See
[Codex plugin packaging](https://developers.openai.com/plugins/build/plugins).

Set these variables **in the environment that launches Codex**:

```sh
export TYPESAFE_API_KEY='your-typesafe-key'
export FAST_JEV_ALLOW_NETWORK=1
codex
```

PowerShell:

```powershell
$env:TYPESAFE_API_KEY = 'your-typesafe-key'
$env:FAST_JEV_ALLOW_NETWORK = '1'
codex
```

Keep actual keys out of files and Git. A desktop app already running will not
inherit later terminal changes. Fully restart it from an environment containing
these variables. Hooks run when that host supports and loads them; verify their
entries and execution in `/hooks`.

Missing opt-in or missing key makes the hook a no-op. To disable network
operation, unset `FAST_JEV_ALLOW_NETWORK`; disable/remove the plugin to stop
its hooks entirely. Hook failures let native compaction continue.

## Data sent and stored

Jev requests go to `https://api.typesafe.ai/v1/systemone`. They contain visible
user/assistant text, tool names and arguments, and result size/status notes.
Tool output bodies, reasoning records, and system/developer messages are not
sent for scoring. Text or arguments may still contain secrets: this is **not a
redactor**. Only opt in for conversations you are authorized to send to TypeSafe.
This is a separate service and credential from your Codex subscription.

Retained records, including opaque records, are stored locally. Treat archives
as sensitive. They live under `PLUGIN_DATA`, or
`$CODEX_HOME/fast-jev-compaction-codex` (default `~/.codex/...`). Override with
`FAST_JEV_DATA_DIR`. Keep that directory outside public repositories. POSIX
permissions are private; Windows relies on the parent directory's ACLs.

Each session/transcript/workspace identity retains one `latest.json` archive.
Pending recovery expires after ten minutes and is consumed once; archives remain
until you remove them. A subsequent failed preparation invalidates the old
pending handoff. API requests time out after 15 seconds. Hook errors report
only a generic fallback message, without echoing transcript or API response bodies.

The preview is capped at about 12,000 characters, includes whole records where
they fit, and points to the full local archive. It labels records as historical
data, not instructions. Large records may appear only in the archive.

## CLI and library

From a checkout:

```sh
git clone https://github.com/jcressler/fast-jev-compaction-codex.git
cd fast-jev-compaction-codex
npm ci
npm run check
npm run demo
node dist/cli.js inspect --input examples/rollout.jsonl
node dist/cli.js compact --input path/to/rollout.jsonl --output pruned.json --allow-network
```

`inspect` and the demo are offline. `compact` requires `TYPESAFE_API_KEY` and
network opt-in on that command. It writes a **new JSON array of response items**,
not a resumable Codex session. Existing output files and using the input as the
output are refused. Do not copy archives over Codex's session files.

`inspect` also accepts a hook's `latest.json` checkpoint. Its `items` array
contains the pruned records; `transcript` points to the original rollout if exact
evidence was removed. Read that specific file when authorized, rather than
repeating a deploy or other write to recreate missing output.

```js
import { compactCodexItems, JevClient, parseCodexTranscript } from './dist/index.js';
import { readFile } from 'node:fs/promises';

const items = parseCodexTranscript(await readFile('rollout.jsonl', 'utf8'));
const result = await compactCodexItems(items, new JevClient(), {
  preserveRecentMessages: 6,
  keepThreshold: 0.5,
  truncateHeadChars: 300,
});
console.log(result.stats); // Archive estimates, not live Codex token savings
```

Supply your own `JevAsker` to test without network calls. The upstream
`compact`, `compactMessages`, state-fitting, request, and decision helpers
remain exported. Use the Codex adapter for Codex data.

## Retention rules and limitations

- Paired `function_call` / `function_call_output` and `custom_tool_call` /
  `custom_tool_call_output` records are candidates. A dropped call loses its
  output. A retained call can have a shortened **text** output.
- All message content and unknown/structured records remain unchanged in the
  archive. Unsupported, unmatched, or ambiguous calls are protected.
- The first and most recent six normalized items are pinned by default; these
  are response items, not necessarily six conversation turns.
- Scoring uses both keep-call and keep-result probabilities. Missing, invalid,
  or out-of-range answers fail rather than silently remove evidence.
- JSON arrays, raw response-item JSONL, and Codex `response_item` rollout
  envelopes are supported. `compacted.replacement_history` resets the active
  history. An unsupported compaction boundary fails safely instead of reviving
  discarded history. Codex's rollout format is **not a stable hook API**.
- Known rollout bookkeeping envelopes (`session_meta`, `event_msg`,
  `turn_context`, world-state and token-usage records) are excluded. Retention
  guarantees describe response items, not every event in the original log.
- Reasoning and system/developer records are preserved locally but excluded
  from Jev scoring and recovery previews. Hosted tools remain opaque.
- Token counts are heuristic estimates. There is no guarantee that model
  scores identify every important record, or that restoration improves a task.
- Only root-session compaction recovery is covered by Codex's documented
  `SessionStart` contract. This plugin does not promise subagent recovery.

## Development and verification

```sh
npm ci
npm run check
npm run demo
npm audit
```

Tests use synthetic transcripts and fake Jev responses. CI checks Linux,
Windows, and macOS and checks that committed `dist/` matches TypeScript.
The hook contract was checked against Codex CLI `0.142.3` and official docs.
Offline tests do not constitute a live TypeSafe or real model-compaction test.
No private sessions, credentials, or business data are included in this repository.
