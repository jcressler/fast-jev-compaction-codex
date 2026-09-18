# Automatic recovery integration check — 2026-09-18

Version 0.3.5 brings requirement-coverage ordering into automatic recovery.
The production hook-function check passed with one live Jev request. The separate
native Codex smoke stopped at an authentication error, before native compaction
completed. This is an integration report, not a new quality comparison.

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

## Native host smoke

Codex CLI 0.155.0 recognized both existing reviewed user hooks as trusted. It
dispatched PreCompact with a persistent transcript; the evaluation bridge ran
the current production hook using deterministic offline scores. No live Jev call
was made in this smoke. Runtime hashes remained unchanged.

Native compaction then returned HTTP 401 because the isolated profile lacked
authentication. SessionStart recovery and the model continuation were not reached.
Consequently native host acceptance of the new recovery context remains unverified
in this run. This reviewed user-hook bridge also does not establish acceptance of
the bundled plugin installation. The failed attempt is retained in the local logs.

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
