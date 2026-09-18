# Automatic evaluation amendment — 2026-09-18

## Reason for amendment

Before inspecting any coding quality scores, source review found an ambiguous
SKU quantity contract in the held-out fixture. The original wording did not
make the required quantity domain explicit, so a model and the hidden grader
could reasonably apply different interpretations. This is a contract-validity
defect, rather than evidence about compaction or recovery behavior.

The corrected visible wording states that SKU quantity is a **nonnegative
integer** and preserves the existing SKU behavior and hidden checks. No model,
grader, threshold, budget, arm, or CLI setting changes.

The original experiment is therefore **no-go for the contract-validity gate**.
Its scores and raw local records remain retained as the original experiment;
they are not silently rewritten or promoted as evidence from the corrected
contract.

## Corrected analysis

The amended analysis has the same six task units, two nested repetitions, three
arms, model, runner, budgets, thresholds, and counterbalanced execution design:

| Portion | Task units | Repetitions | Arm runs | Treatment |
| --- | ---: | ---: | ---: | --- |
| Unaffected observations | 5 | 2 | 30 | Reuse the completed observations from the original frozen run |
| SKU replacement | 1 | 2 | 6 | Freshly execute `stockCodex`, `pluginLocal`, and `pluginJev` for both repetitions |
| Corrected analysis | 6 | 2 | 36 | Combine the 30 unaffected observations with the 6 fresh SKU observations |

The SKU replacement runs occur later, in a new isolated execution, with the
single visible quantity wording correction. They replace all six original SKU
observations in the corrected 30-plus-6 analysis, regardless of their eventual
scores. The unchanged five task units are reused by identity and hash.

The original and amended analyses are reported separately. The amendment does
not cherry-pick runs, tune the grader after outcomes, or treat the replacement
as an additional independent experiment. The three predeclared pairwise
decisions and their thresholds remain those frozen in `AUTOMATIC-EVAL.md`.

## Scope and timing

This amendment records a design correction discovered before quality-score
inspection. The original 36-run execution remains an auditable, contract-invalid
record. The corrected SKU execution is scheduled after this amendment and must
complete all six arm runs, including failures, before the amended analysis is
published.
