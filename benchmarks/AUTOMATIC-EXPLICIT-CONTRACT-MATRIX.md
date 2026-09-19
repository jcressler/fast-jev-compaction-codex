# Explicit-contract review matrix

This is pre-execution review evidence for the v3 fixture. It maps the frozen
v1 grader categories to requirements visible in each v3 task README/contract
and its staged history. It records categories and representations rather than
held-out inputs, expected outputs, or reference implementation details. It is
not a claim that these six synthetic tasks cover every implementation edge.

## Shared checks

| Frozen grader category | Visible requirement | Source visible to the model |
| --- | --- | --- |
| Public execution/export | Implement the named function and export it through `src/index.mjs`; complete the shared module. | README public-facade sentence; stage 1/3 prompts |
| Shared validation | `hasOwn(value, key)` is true only for own properties, including falsy values, and false for missing/inherited properties. | README shared-helper sentence; stage 1 prompt |
| Input immutability | Do not mutate the supplied input objects/arrays. | Each v3 contract |
| Immutable files | Preserve `history/*`, `package.json`, `config/runtime.json`, `docs/OPERATIONS.md`, and `fixtures/README.md`. | README immutable-path sentence; stage 3 prompt |
| Allowed paths | Changes are limited to `src/**`, `tests/**`, `docs/DECISIONS.md`, and permitted helper paths under those directories. | README allowed-path sentence; stage 3 prompt |
| Execution isolation | Public facade must load in the evaluator's isolated child process and return the named function. | Stage 3 prompt |
| Side effects/action log | No network, upload, external write, delete, or duplicate side effect; repository is offline. | `docs/OPERATIONS.md`; README/stage prompts |

## Task contracts

| Task | Graded categories | Visible v3 requirements covering those categories |
| --- | --- | --- |
| `ledger-idempotency` | Exact output/state shape; deposit/withdraw transitions; duplicate idempotency; validation/error codes; immutability | Exact `{ state, applied, duplicate }` and state fields; nonempty string id; exact types and nonnegative integer amount; validate fields before duplicate check; duplicate before balance check; ordered `processedIds`/`entries`; exact thrown `.code` values |
| `config-migration` | Renaming; canonical/legacy collision; target upgrade/downgrade; unknown-key policy; warning array; exact output; immutability | Non-object config becomes empty; non-positive/non-integer target defaults to 4; canonical wins and legacy is removed; unknown keys preserved unless `preserveUnknown:false`; missing/non-integer current version treated as 0; upgrade without downgrade; `changed` compares resulting config fields/values; warnings exactly empty except exact downgrade warning |
| `sku-index` | Input/field validation; exact identifiers; grouping/order/sums; output record shape; `__proto__`; error codes; immutability | Array input; nonempty exact string identifiers with no coercion; nonnegative integer quantity; exact-key grouping and first-seen order; source-order variant IDs; every value exactly `{ sku, variantIds, totalQuantity }`; own-property-safe `__proto__` data; exact thrown `.code` values |
| `config-precedence` | Defaults; layer precedence; own-property semantics; falsy values; unknown keys; exact output/source mapping; immutability | Four named layers in order; exact defaults; later own known properties override; false/zero are valid; unknown keys ignored; config has exactly three known keys and sources names the winning layer |
| `correction-ledger` | Exact output/rejection shape; document preservation; revision/id history; invalid/duplicate/conflict policy; order/continuation; immutability | Exact `{ document, applied, rejected }`; preserve unknown properties; missing history/revision defaults; copied `appliedCorrectionIds` persists when empty; nonempty string id and string field (empty field allowed); duplicate before expected-revision conflict; exact rejection reasons; continue after rejections; increment/apply/append once per accepted correction |
| `receipt-reconciliation` | Inventory/history representation; receipt id/line validation; duplicate replay; transactional validation; reserved key; exact output/error codes; immutability | Exact nonempty receipt-id strings in `inventory.receipts`, in first-application order; validate receipt id, then lines-array shape, then duplicate; duplicate is no-op; validate line contents only for new receipt; exact SKU/quantity rules; reserved `receipts` key error; append once and add exact quantities; preserve unknown inventory properties; exact thrown `.code` values |

## Review result

The matrix covers every frozen v1 quality check: isolated execution, named
export, shared `hasOwn`, each graded behavior/error representation,
immutability, immutable-file hashes, action-log safety/idempotency, and allowed
paths. The v3 wrapper changes only visible contract text and README text; its
cases, invalid cases, reference files, stages, immutable hashes, task IDs, and
the v1 grader remain delegated unchanged.

No blocking contract gap remains in the final v3 wording. The receipt ordering
is intentionally stated precisely: receipt ID validation first, then
`lines`-array validation, then duplicate short-circuit, then line-content
validation for a new receipt.
