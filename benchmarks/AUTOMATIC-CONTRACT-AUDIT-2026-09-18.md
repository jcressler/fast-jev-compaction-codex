# Automatic evaluation contract audit

The original 36 executions and six SKU replacements completed with valid native
integration. Their coding-quality ranking is **no-go for contract validity**.
The original raw runner records are retained. This audit does not alter their
checks, change a failed check to a pass, or attribute the failures to Jev.

The [original 36-run packet](AUTOMATIC-ORIGINAL-RESULTS-2026-09-18.json) and
[SKU-amended packet](AUTOMATIC-RESULTS-2026-09-18.json) retain the raw scores,
timings, native usage counters, and delivery evidence. Both explicitly mark
quality decisions `no-go-contract`.

After all 42 executions finished, the reported all-check pass counts were
stock Codex 4/12, local recovery 4/12, and Jev recovery 3/12 in the amended
30-plus-6 comparison. Inspection of failed checks then identified these gaps:

| Task | Hidden expectation missing or incomplete in visible instructions |
| --- | --- |
| SKU index | Every `bySku` value must include `sku`, as well as `variantIds` and `totalQuantity`. All six replacement runs failed the undisclosed shape checks. |
| Correction ledger | Returned documents must persist `appliedCorrectionIds`, including the empty/default form. The field was not specified. |
| Receipt reconciliation | `inventory.receipts` must be an array of exact receipt ID strings. Its type was not specified, making a receipt map a reasonable interpretation. |
| Configuration migration | Canonical/legacy key collisions must produce no warning. The visible instructions allowed an array of warning strings without defining this case. |
| Ledger idempotency | The evaluator requires the thrown object's `.code` property. The phrase “throw codes” did not explicitly distinguish that from an error message. Jev's extra failed run used error messages. |

Configuration precedence had no identified contract gap and all approaches
passed both repetitions. Several other failures may include implementation
errors, but the incomplete contracts prevent a fair overall quality ranking.
The earlier SKU amendment clarified nonnegative quantities and did not address
the undisclosed output field.

The integration evidence remains useful: all 42 runs completed; installed hooks
delivered their recorded context hashes; Jev selections used real requests with
no fallback; the native metadata audit found consistent model/effort/sandbox
settings and no flagged literal references to credentials, evaluators, or other
trial workspaces. The audit does not prove the absence of indirect access.

## Next comparison

[The explicit-contract protocol](AUTOMATIC-EXPLICIT-EVAL.md) specifies a fresh
36-run comparison. It keeps the hidden grader, task cases, model, budgets,
plugin, and decision thresholds unchanged, while making the visible contracts
complete. It reuses no coding outcomes. This revision was designed **after
observing the preceding outcomes** and is reported as such; it is not an
outcome-blind amendment or an independent replication of an untouched design.

Passing reference implementations had not been sufficient validation: they
shared the evaluator author's assumptions. The revised review must map each
graded expectation to a statement visible to the tested model.
