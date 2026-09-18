# Automatic recovery integration check — 2026-09-18

Version 0.3.5 brings requirement-coverage ordering into automatic recovery.
The production hook-function check passed with one live Jev request. After fixing
the isolated test profile's login, the native Codex smoke also passed with a real
Jev request, completed compaction, and a model continuation confirming receipt of
the recovery index. This is an integration report, not a new quality comparison.

## Changes

- Derive at most six short requirement units from original archived user messages.
  Preserve case, numeric values and punctuation; omit oversized units instead of
  splicing away potentially meaningful text. This is heuristic extraction, not
  exhaustive understanding. Fenced code and simple acknowledgements are excluded.
- Score relevance and each candidate/requirement pair using binary Noul questions.
  Automatic recovery and explicit search share the same coverage-ordering function.
- Keep the bounded candidate pool and requirements intact when fitting a request.
  Shorten excerpts to a minimum, then fall back locally if the request still cannot fit.
- Filter nested protected blocks and common structured credential fields, including
  JSON-encoded tool results. This does not redact arbitrary secrets in plain text.
- Record requirement source IDs and omissions. Record the exact IDs, character count,
  and hash emitted by SessionStart separately from the ranker's ordered IDs.

## Live Jev hook-function check

| Measurement | Result |
| --- | --- |
| Provider/model | jev-1.13.0 |
| Actual requests | 1; no fallback |
| Candidates / requirement units | 24 / 6 |
| Binary questions | 168 |
| Serialized request characters | 45629 |
| Selection elapsed time, including local preparation | 711 ms |
| Provider input / output tokens | 15149 / 3703 |
| Hook-emitted references / characters | 17 / 5744 |
| Source transcript unchanged | Pass |
| Single-use SessionStart handoff | Pass |
| Emission metadata matches actual returned context | Pass |
| Original emitted references remain retrievable | Pass |

The checker directly invoked the production hook functions with a previously used
synthetic fixture. It did not launch Codex. The JSON includes the actual synthetic
request state, questions, answers and implementation hashes. Credentials, native
transcripts and opaque reasoning are excluded. Provider token counts are not a
verified dollar bill. Requirement omissions in this fixture are reported, not hidden.

## Native host smoke — authenticated retry passed

The first attempt returned HTTP 401 because the isolated profile had no login.
That attempt used offline equal scores and stopped before recovery delivery. Its
result remains in the JSON under `priorNativeChecks`.

The test profile then completed the standard `codex login` browser flow. Both
the CLI login-status command and the app-server account check confirmed ChatGPT
authentication. No existing credential file was copied. The scratch runner now
checks authentication before starting a test and saves each run separately.
This follows the [official Codex sign-in flow](https://learn.chatgpt.com/docs/auth).

The retry used Codex CLI 0.155.0, `gpt-5.6-luna`, medium reasoning, and unchanged
v0.3.5 production code at commit `43a878aea92e9c6f394c6aea63d15d8973ea0f4e`.
The native host dispatched both trusted, reviewed user hooks through the existing
evaluation bridge. PreCompact made a real Jev request; native compaction completed;
SessionStart restored the index before the next model turn.

| Measurement | Result |
| --- | --- |
| Native compaction / continuation | Both completed |
| Live Jev requests / fallback | 1 / none |
| Jev model | jev-1.13.0 |
| Candidates / extracted requirement units | 3 / 6; 4 units omitted |
| Serialized request characters | 9,901 |
| Selection elapsed time, including local preparation | 722 ms |
| Jev input / output tokens | 4,000 / 454 |
| Hook-emitted references / characters | 3 / 1,883 |
| Compaction elapsed time, including PreCompact | 6,648 ms |
| Model continuation elapsed time | 3,327 ms |
| Matching hook session and context hash | Pass |
| Runtime hashes unchanged | Pass |

The continuation returned `checkpointMarker: HOOK-SMOKE-CANARY-731` and
`recoverySelection: jev`. The continuation prompt supplied neither expected value.
The marker was also in the original checkpoint, so preserving it alone would not
prove hook delivery. The `Selection: jev` line appeared only in the hook context;
the model's reflection supports receipt of that index after native compaction.
All 12 recorded assertions passed.

This was a small injected-checkpoint smoke, not a long coding task. It verifies
native delivery through reviewed user hooks, not bundled plugin installation,
use of every evidence excerpt, or better task outcomes. No archive-retrieval tool
was used. Native transcripts, credentials, and opaque reasoning are not published.
Provider token counts are not a verified dollar bill.

## Verification and next step

All 115 unit tests, typecheck, build, offline benchmark/self-tests, demo and plugin
manifest validation passed. The new hook integration test verifies that complementary
evidence survives alongside many redundant records under the actual context cap.

The [automatic evaluation protocol](AUTOMATIC-EVAL.md) is prepared, not executed.
It specifies six independent repository tasks with repeated runs across ordinary
Codex, local recovery and Jev recovery. It must verify both bundled-hook acceptance
and native delivery before making task-quality claims. Candidate pools, excerpts
and context formatting still differ from the v0.3.4 explicit-search comparison;
these checks do not replace or change that comparison's results.
