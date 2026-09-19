# Explicit-contract automatic comparison results

> **Interpretation corrected 2026-09-19.** The raw measurements below are
> retained, but they do not establish that Jev is slower, more expensive, or
> less effective than stock Codex. All arms hit a 100% quality ceiling, the
> exact contract and stage-2 correction were recoverable from the persistent
> workspace, and the pilot and scored run used different Codex CLI binaries.
> An independent paired audit found no stable latency, token, or proxy-cost
> difference. See
> [`AUTOMATIC-EXPLICIT-RESULTS-AUDIT-2026-09-19.md`](AUTOMATIC-EXPLICIT-RESULTS-AUDIT-2026-09-19.md).

The scored run completed all 36 fresh executions: six task units, two
repetitions, and three arms. Every execution completed, passed its frozen
grader, and passed the integration gate. The independent native transcript
audit found all 36 expected transcripts, no unknown paths, and no flagged
fixture, evaluator, credential, or cross-workspace access.

| Arm | Passed | Median latency | Codex total tokens | Codex input | Cached input | Codex output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock Codex | 12/12 | 160,928.5 ms | 3,680,744 | 3,622,388 | 2,955,776 | 58,356 |
| Local recovery | 12/12 | 139,363.5 ms | 3,832,289 | 3,778,667 | 3,160,320 | 53,622 |
| Jev selection | 12/12 | 155,154 ms | 3,981,581 | 3,925,566 | 3,271,936 | 56,015 |

Jev made 24 successful selection requests with no fallback. Its provider
telemetry reported 301,028 input tokens and 45,037 output tokens. At the
published $0.042 per million input-token rate and zero output-token rate, the
direct Jev charge is approximately **$0.01264** for the complete arm.

Using public GPT-5-Codex API prices only as an illustrative proxy for the
Codex-side counters gives approximately $1.7863 for stock, $1.7042 for local,
and $1.7862 for Jev before the Jev charge. Adding the direct Jev charge gives
approximately $1.7988: 0.7% above stock. These are not actual Luna or Codex
subscription charges.

Relative to stock, Jev's median latency was 3.6% lower and local recovery's
was 13.4% lower. Jev was faster than stock in 6 of 12 paired cells, while local
was faster than stock in 7 of 12. Jev was faster than local in 1 of 12 cells.
Jev used 8.2% more Codex tokens than stock; local used 4.1% more.

All 12 paired quality outcomes were ties in every comparison because every arm
passed every task. Under the frozen success-count thresholds, all three
pairwise decisions are `no-demonstrated-downstream-benefit`. This is a ceiling
result, not evidence of a quality loss: Jev showed no quality regression, but
the tasks were not difficult enough to distinguish it from stock or local
recovery.

Both plugin arms retained exact recovery archives on disk. Across 12 runs,
local recovery stored 1,916,359 bytes and Jev stored 2,090,413 bytes, in
addition to the native Codex transcripts. Jev selection therefore does not
remove the plugin's local archive requirement in this implementation.

The earlier one-task excluded pilot favored Jev on latency and Codex usage.
The scored aggregate did not reproduce the token advantage. Because the exact
same task reversed its token result after the Codex CLI changed, and because
paired uncertainty spans advantages in both directions, neither run should be
used to claim a stable cost or speed ordering. The shared 100% quality rate
shows that this fixture can validate integration and non-regression, but cannot
test whether retrieval improves downstream correctness.

The privacy-safe per-run evidence, frozen hashes, selection telemetry, native
usage counters, audit metadata, and pairwise calculations are in
[`AUTOMATIC-EXPLICIT-RESULTS-2026-09-18.json`](AUTOMATIC-EXPLICIT-RESULTS-2026-09-18.json).
