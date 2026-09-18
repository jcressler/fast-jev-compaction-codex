# Paired Jev reranking results — September 18, 2026

The current Jev search reranker showed no benefit in this controlled test.
Native Codex and enhanced local recovery answered all 12 continuations
correctly. Jev and the equal-score production-order control each answered 8.
This is evidence against recommending the current reranker by default, not
proof that every possible Jev integration is ineffective.

| Arm | Fully correct answers | Correct fields | Answer latency, total |
| --- | ---: | ---: | ---: |
| Native Codex, no recovery packet | 12/12 | 36/36 | 44.958 s |
| Enhanced local archive search | 12/12 | 36/36 | 56.918 s |
| Equal-score production-order control | 8/12 | 24/36 | 59.849 s |
| Live Jev search reranking | 8/12 | 24/36 | 56.144 s |

Jev also used six real `jev-1.13.0` calls: **29,662 input tokens**, **2,484 output
tokens**, and **1.382 seconds** of measured ranking time in total. These timings
are descriptive. Native compaction was shared within each case; inherited
thread usage and provider caches prevent treating the table as a verified
billing comparison. Dollar cost remains unknown.

## What was controlled and verified

Six synthetic cases span three families with two seeds each: receipt
corrections, deployments with superseded failures, and migration retries with
no writes. Each case has 24 paired records. Fixtures, queries, expected-answer
hashes, and implementation hashes were frozen before live requests.

All three recovery arms received exactly the same 20 candidate IDs per case.
They used identical per-record content and the same 1,800-character recovery
cap. The equal-score control separates Jev scores from the older local ordering
inside the production ranking function. Each candidate set was checked before
the request and after ranking; there were no silent fallbacks.

One native compaction was run for each case. Every answer used a new ephemeral
fork of that case's same compacted base, with confirmed lineage. Query, model
(`gpt-5.6-luna`, medium), instructions, JSON schema, and tool restrictions were
fixed. Arm execution positions were counterbalanced. All six compactions and
48 continuations completed. Every answer was independently rescored against
the frozen fixture; source and fixture hashes were verified afterward.

The [protocol](PAIRED-EVAL.md) and
[machine-readable report](PAIRED-RESULTS-2026-09-18.json) contain the full method,
per-case ranking and packet IDs, synthetic answers, usage, and validation.

## Per-case outcomes

Each cell counts fully correct answers out of two repeated continuations.

| Case | Native | Local | Equal-score control | Jev |
| --- | ---: | ---: | ---: | ---: |
| Receipt, seed 1 | 2 | 2 | 2 | 2 |
| Receipt, seed 2 | 2 | 2 | 0 | 1 |
| Release, seed 1 | 2 | 2 | 1 | 0 |
| Release, seed 2 | 2 | 2 | 1 | 1 |
| Migration, seed 1 | 2 | 2 | 2 | 2 |
| Migration, seed 2 | 2 | 2 | 2 | 2 |

Against enhanced local search, Jev had **0 wins, 4 losses, and 8 ties** in field
accuracy. Against the equal-score control, it had **1 win, 1 loss, and 10 ties**.
The equal totals do not mean the two rankings or individual answers were identical.

The failures were schema-valid unknown/abstaining answers or stale release
values, not JSON parsing failures or a leaked answer key. Repeated identical
prompts sometimes produced different answers, demonstrating why one favorable
continuation is insufficient evidence.

## What the result means

We have demonstrated useful local retrieval in the earlier
[batched-search evaluation](BATCHED-SEARCH-2026-09-18.md). This test did not
demonstrate extra answer quality from Jev. It also shows that adding a recovery
packet can hurt a continuation that native compaction alone handles correctly.

There are two concrete limits to investigate before further spending:

- Candidate recall: the receipt cases included only one of three historical
  target records in the 20-candidate pool. All arms shared that omission; no
  ranker could recover excluded candidates. All three targets were eligible
  for the release and migration cases.
- Evidence visibility: production Jev receives at most 100 summary characters
  and 120 outcome characters per candidate. The local search inspected richer
  original records. Those short Jev views can omit status, supersession, or
  authoritative results. That is a plausible failure mechanism, not a causal
  diagnosis established by this experiment.

Across cases, local packets showed 10 of the 18 historical target records,
the equal-score control showed 4, and Jev showed 3. These are record-coverage
counts, not answer accuracy: some targets are superseded, excerpts are bounded,
and the native summary can already contain the answer.

## Scope and next decision

This tests **explicit search reranking with a custom evidence packet**. It does
not exercise the plugin's automatic PreCompact selector, whose input format
differs. The history is scripted, compactions are forced, and answers are
closed-book factual decisions rather than full coding tasks. Two repeats share
a compaction and ranking; the six cases share three templates. There is no
claim of statistical significance or a universal result about Jev.

Keep native compaction and local recovery as the default. Jev should remain
experimental. The next justified engineering step is to inspect and improve
candidate/excerpt fidelity, then evaluate a changed design on new held-out
cases. Repeating or tuning these same six cases until Jev wins would not be
convincing evidence.

No default Codex settings were changed. The key was used only in the test
process and excluded from Codex children, reports, and tracked files. It was
not persisted by this run.
