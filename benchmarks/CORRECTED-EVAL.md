# Corrected Jev evaluation

This experiment follows the implementation audit of the September 18 trial.
The earlier data and frozen decision remain in `HELDOUT-RESULTS-2026-09-18.*`.
The recommendation to shelve the overall idea was too broad: that implementation
asked Noul for an ordinal utility rating and did not supply the requested fact
fields to the reranker. Those flaws prevent a clean assessment of a properly
specified, task-aware Jev integration.

## Corrections being tested

- Noul questions ask a specific yes/no proposition and define true and false.
  A probability of yes is used for ranking, not treated as a calibrated amount
  of usefulness. This follows TypeSafe's [Noul documentation](https://docs.typesafe.ai/primitives/noul)
  and [reranking example](https://docs.typesafe.ai/cookbooks/rerank_typesafe).
- The three required historical fact fields and their meanings are visible in
  every arm's task, in the local search query, and in Jev's state. Expected
  answers and hidden code tests are never supplied to the ranker or Codex.
- Separate questions ask whether each candidate supplies evidence for each
  requirement. Code greedily selects the largest marginal increase in the sum
  of per-requirement maximum support probabilities. Ties use general relevance,
  then original local order. These are selection estimates, not verified recall.
- Invalid or incomplete probabilities cause a complete local fallback. A live
  evaluation rejects fallback and is reported incomplete instead of treating it
  as a successful Jev run. Privacy filters and bounded requests remain enabled.

## Validation before the fresh trial

Offline tests check candidate association, propagation of requirements, useful
failure evidence, complementary versus redundant records, malformed responses,
request bounds, and privacy exclusions. Fixture tests execute the reference and
buggy source. Every reference must pass eight code checks; every buggy source
must fail at least two. Requested facts are numbers, booleans, or exact identifiers
so equivalent prose cannot accidentally lose credit.

A bounded development check may use the previously exposed reservation and
money tasks to inspect actual Jev probabilities and selected evidence. It has
at most two Jev calls and no Codex continuations. Its outcomes are diagnostic,
excluded from the fresh comparison, and reported separately. The four fresh
tasks are not tuned against live outcomes.

## Frozen comparison

Four new coding-maintenance tasks each contain three chronological stages of
24 paired, generated tool records, with irrelevant observations, earlier
policies, failures, and explicit corrections. Historical configuration affects
the implementation as well as the three factual answers. Codex reviews each
stage and completes an actual native compaction.

The same final base is forked into three arms, twice each:

1. **Native reference:** native compaction plus the same archive recovery tools;
   no proactive evidence packet. This is not unmodified stock Codex.
2. **Local:** production lexical search with all requested requirements in the
   query, and the common evidence packet formatter.
3. **Jev:** the identical candidate pool and packet formatter, ordered by the
   corrected requirement-aware Jev selection.

The runner uses `gpt-5.6-luna`, medium effort. Limits are four live Jev requests,
12 checkpoint turns, 12 native compactions, and 24 final continuations. Each
continuation can make eight archive recovery calls. The common candidate limit
is 20, packet budget 6,000 characters, entry budget 2,000 characters. All arms
see the same requested facts and final schema. No hidden test feedback is
returned to Codex; submitted code runs afterward in the bounded evaluator.

Numeric success criteria are retained from the prior comparison:

- At least two more fully correct runs than **both** baselines, gains across at
  least two tasks against each, and no task lost in both repetitions while the
  comparator succeeds in both; or
- Equal or better quality against both, at least 25% and four fewer recovery
  calls across at least two tasks versus each, with continuation plus ranking
  latency no more than 10% higher.

Both require no additional hard-constraint regression failures in any matched
task/repetition. Full completion is mandatory. Passing is an `added-value-signal`;
otherwise the result is `no-demonstrated-benefit`. Neither label establishes
general effectiveness or ineffectiveness. A perfect tie does not show added value.

Hashes of fixtures, requirements, schemas, evaluators, and implementation are
saved before requests. All rankings finish before continuation outcomes. Do not
retune the implementation, tasks, budgets, or scoring after seeing fresh results.
Report all cases, original returned facts, failed code checks, packet membership,
tool calls, usage, and latency. Synthetic request/answer payloads make the Jev
question semantics auditable; native opaque payloads and credentials stay private.

## Limits

This is four distinct generated tasks, with shared trajectories and rankings
across repetitions. It is not a blind external benchmark, natural context
exhaustion, real repository acceptance, or an automatic PreCompact-hook test.
It tests the combined corrections, not a causal ablation of each component.
Candidate omissions can limit both retrieval approaches. Character caps do not
equal token caps. No verified dollar-cost claim follows from inherited/cache
usage; actual provider token counts and ranking time are reported separately.

## Run

```sh
npm run check
npm run benchmark
node benchmarks/corrected-eval.mjs
# Requires an authenticated compatible Codex CLI and TYPESAFE_API_KEY:
node benchmarks/corrected-eval.mjs --live --allow-network \
  --codex /absolute/path/to/codex --run-dir /new/private/run-directory
```

The key is never a command-line argument, is removed from Codex child processes,
and is absent from reports. The run reuses the existing Codex login. Base sessions
are archived after use; continuations are ephemeral.
