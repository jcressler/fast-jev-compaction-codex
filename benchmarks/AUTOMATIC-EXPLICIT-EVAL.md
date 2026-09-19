# Fresh automatic comparison with explicit contracts

This protocol is frozen before the new execution. It follows the
[contract audit](AUTOMATIC-CONTRACT-AUDIT-2026-09-18.md), which found that the
prior comparison's visible instructions omitted details required by its hidden
grader. Those raw results remain retained and contract-invalid.

## Design

Run all six tasks twice under all three approaches: stock Codex, installed
plugin with local recovery, and installed plugin with live Jev selection.
There are **36 fresh executions**, six task units, and two repetitions nested
within each task. None of the previous 42 coding outcomes is reused.

`automatic-fixtures-v3.mjs` delegates execution and grading to the frozen v1
fixture. Only each task's visible contract and README change. Hidden cases,
expected values, reference implementations, stage prompts, immutable files,
and task identifiers remain unchanged. The explicit contracts specify output
fields, receipt/correction history arrays, warning policy, and error `.code`
properties. They do not disclose hidden input examples or reference code.

`automatic-explicit-eval.mjs` preserves the original runner's execution order,
three stages, two manual native compactions per run, and isolation checks. It
uses a new directory and manifest, with hashes of both fixture files and this
protocol. Every run gets a fresh workspace, session, and recovery archive.
The three already authenticated profiles are reused, one per approach.

The scored run uses Codex CLI `0.155.0-alpha.9.2`, the current Codex Desktop
binary available after the application updated between the excluded pilot and
the scored run. The pilot's exact `0.155.0` binary is no longer installed. All
three scored arms use the same frozen binary. Model `gpt-5.6-luna`, effort
`medium`, and plugin version 0.3.5 are unchanged.
The source plugin, installed bundles, base instructions, writable sandbox,
approval policy, disabled apps/memories/multi-agent/web search, and secret
exclusion policy are unchanged. Each boundary allows at most one Jev selection
request and 6,000 emitted context characters; each run allows 120 completed tool
operations and 15 minutes. The original protocol defines the remaining
settings and [acceptance criteria](AUTOMATIC-EVAL.md).

## Unchanged decisions

| Comparison | Required net successful-run gain | Distinct task units with gains |
| --- | ---: | ---: |
| Local vs stock | 3 | 2 |
| Jev vs stock | 2 | 2 |
| Jev vs local | 2 | 2 |

All comparisons additionally require no new hard-constraint regression and no
task where both candidate repetitions fail while both baseline repetitions
succeed. Jev vs stock also requires median whole-run latency at most 1.2 times
stock. Technical failures and fallback selections cannot count as Jev success.
Each pairwise decision is evaluated separately. Report every run, including
failures, with no score-based substitution.

## Review before execution

Use the [contract-to-check review matrix](AUTOMATIC-EXPLICIT-CONTRACT-MATRIX.md).
Verify the only fixture changes are visible contract text; all hidden data and
grading functions remain identical. Map each checked output field and error
representation to visible instructions. Verify all six references pass and
starters fail. Freeze source, runner, CLI, installed plugin, task, profile,
protocol, and native-smoke hashes. Publish this protocol before execution.

## Interpretation

This revision is **outcome-aware**: the previous errors informed the contract
clarifications. The fresh results can compare the three approaches under the
now-explicit tasks, but are not independent confirmation on unseen task designs.
Do not pool previous runs or call the total number of executions independent
samples. Six small synthetic repositories with manual compactions do not test
natural context exhaustion, production repositories, other Codex models, or a
million-token workload. Native token counters are not dollar costs.

No coding-quality scores will be inspected during the new execution. Review
complete results only after all 36 executions finish. If a further material
contract defect is discovered, report it transparently rather than silently
changing grades or selecting favorable runs.
