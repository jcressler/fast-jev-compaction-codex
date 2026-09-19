# Independent audit of the explicit-contract result

This audit was performed after concern that the published interpretation gave
the scored aggregate more certainty than the evidence supports. The raw report
was re-aggregated independently rather than through the benchmark's result
aggregator.

## What reproduced

- All 36 executions are unique, completed, grader-passing, and
  integration-valid.
- All 24 Jev selections used Jev successfully; none fell back to local ranking.
- The native transcript audit found all 36 expected transcripts and no flagged
  fixture, evaluator, credential, or cross-workspace access.
- The published arm totals and medians reproduce from the raw run report.

These facts support a reliable integration and non-regression result.

## Why the efficacy interpretation is not supported

Every arm passed all 12 tasks. The benchmark therefore has no quality headroom
with which to measure a retrieval benefit. Its frozen decision logic records
12 ties for every comparison.

The v3 fixture also persists the exact behavioral contract in `README.md`.
The stage-2 correction that the agent is asked to retain after compaction is
restated by that contract or otherwise recoverable from files in the current
workspace. Stock Codex can solve the task by rereading the repository, without
recovering unique information from earlier conversation history. This design
primarily measures integration overhead when all arms already have sufficient
current evidence; it does not fairly exercise Jev's intended advantage.

The excluded pilot and scored run did not use the same Codex runtime. The pilot
used CLI `0.155.0`; the scored run used `0.155.0-alpha.9.2` after Codex Desktop
updated and the exact pilot binary was no longer installed. Plugin source,
installed bundle, fixture, evaluation client, profiles, and the task-0
repetition-0 digest were otherwise identical. On that identical task:

| Run | Stock tokens | Jev tokens | Jev minus stock |
| --- | ---: | ---: | ---: |
| Excluded pilot | 276,930 | 266,344 | -10,586 |
| Scored task 0, repetition 0 | 231,099 | 384,342 | +153,243 |

The reversal means the pilot and scored token counters cannot be treated as a
stable estimate of the plugin effect. It may reflect runtime behavior,
stochastic tool trajectories, token-telemetry changes, or a combination.

## Independent paired analysis

Across the 12 scored task/repetition pairs, Jev used fewer Codex tokens than
stock in 4 pairs and more in 8. The mean paired difference was +25,070 tokens,
but a deterministic 100,000-sample bootstrap 95% interval was
[-13,559, +64,740]. The median paired difference was +22,808 with interval
[-16,268, +65,099]. A two-sided sign test gives p=0.388.

Jev was faster than stock in 6 pairs and slower in 6. The mean paired latency
difference was -1,085 ms with bootstrap interval [-18,238, +15,957]; the median
was -4,546.5 ms with interval [-25,648, +30,538]. The two-sided sign test gives
p=1.0.

Under the published GPT-5-Codex pricing proxy plus the direct Jev charge, Jev
was cheaper in 4 pairs and costlier in 8. The aggregate difference was only
$0.01253 across all 12 pairs. The mean per-pair difference was $0.00104 with
bootstrap interval [-$0.01059, +$0.01242]. This proxy is not Luna or Codex
subscription billing.

These intervals are descriptive, not a claim that bootstrap assumptions are
perfect for twelve synthetic tasks. They show that the apparent aggregate
ordering is not robust enough to support a factual product conclusion.

## Correct conclusion

The test demonstrates that the Codex plugin can run Jev selection reliably
across 24 compaction boundaries without a measured correctness regression. It
does not demonstrate that Jev is better or worse than native Codex or local
selection for quality, latency, token usage, or cost.

A fair efficacy trial needs a pinned identical Codex binary, preregistered
paired cost metrics, and tasks where important early facts exist only in prior
messages or tool outputs after compaction. Those facts must not be duplicated
in the current prompt or persistent workspace. The tasks must also be hard
enough that stock does not score 100%, otherwise retrieval cannot improve the
measured outcome.
