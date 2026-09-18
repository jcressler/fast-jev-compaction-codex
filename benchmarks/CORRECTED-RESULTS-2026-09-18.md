# Corrected Jev comparison — 2026-09-18

The corrected integration did not meet the predeclared added-value threshold. This run does not demonstrate an advantage over both baselines; it is not evidence that every Jev integration is ineffective.

## What changed

Jev now answers explicit binary Noul propositions with true/false criteria.
It receives the same requested fact fields and descriptions as Codex and the
local candidate search. Separate candidate/requirement probabilities let code
select complementary evidence. Hidden answers and code tests are excluded from
the model requests. These are combined changes, not an ablation of each one.

The earlier results remain intact in [the previous report](HELDOUT-RESULTS-2026-09-18.md).
That report's recommendation to shelve the overall idea was too broad given
the prompt and omitted-requirement flaws found afterward.

## Fresh results

| Approach | All checks pass | Code tests | Fact checks | Recovery calls | Duplicate calls | Continuation + ranking latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native-reference | 6/8 | 59/64 | 24/24 | 0 | 0 | 120.20 s |
| local | 7/8 | 61/64 | 24/24 | 0 | 0 | 110.51 s |
| jev | 7/8 | 61/64 | 24/24 | 0 | 0 | 133.61 s |

Facts are numbers, booleans, or exact identifiers, avoiding the earlier free-text
paraphrase penalty. A fully correct run passes all eight code checks and all
three fact checks. Code tests also verify that input is unchanged. The native
reference has the same archive recovery tools, so it is not stock Codex.
Latency is summed across eight continuations per arm; each Jev repetition is
charged the full ranking latency. Shared checkpoint/compaction time is excluded.

| Task | Native reference | Local | Jev |
| --- | ---: | ---: | ---: |
| cache-expiry | 2/2 | 2/2 | 2/2 |
| batch-partition | 2/2 | 2/2 | 2/2 |
| log-redaction | 0/2 | 1/2 | 1/2 |
| version-migration | 2/2 | 2/2 | 2/2 |

Every imperfect submission was in log-redaction. Failed implementations emitted
doubled backslashes in regular-expression literals, changing their matching
behavior; the policy facts were correct. The reference implementation passes,
and the evaluator compiles the parsed submitted source without re-escaping it.
The coding differences occurred on this one task and do not establish a memory
benefit. Jev also has a matched code regression versus local in one repetition,
offset by the opposite result in the other; the frozen regression guard fails.

## Evidence selection and provider usage

| Task | Current fact records in candidate pool | Local packet | Jev packet |
| --- | ---: | ---: | ---: |
| cache-expiry | 3/3 | 3/3 | 3/3 |
| batch-partition | 3/3 | 3/3 | 3/3 |
| log-redaction | 3/3 | 2/3 | 3/3 |
| version-migration | 3/3 | 3/3 | 3/3 |

These counts describe source-record membership, not guaranteed model use.
Both retrieval arms receive the same 20 candidates and packet formatter.
The character cap means ordering changes packet membership and sometimes entry
count; the final packets are not identical sets. In log-redaction, the local
packet omits the current maxRedactions record while Jev includes it. The other
three tasks have all three current fact records in both packets. All originals
remain available through the same recovery tools. A separate request audit
confirmed that all 12 current fact records were visible in Jev's candidate
evidence, before packet selection.

The four live Jev calls used model jev-1.13.0,
51,017 input tokens and 7,056 output tokens.
Actual ranking latency totaled 1.153 seconds.
Every request contained 80 explicit questions: 20 general relevance questions
and 60 requirement-support questions. All probabilities were valid; no fallback
was counted. The JSON includes the synthetic request state, questions, returned
probabilities, selected packets, final submissions, and scoring.

The separate development check used two previously exposed tasks and no Codex
continuations. The corrected Jev packet retained the reservation duration that
the previous version omitted. Development usage was 25,943
input tokens and 3,528 output tokens across two calls,
with 0.677 seconds of ranking latency. These results are
diagnostic and are excluded from the fresh comparison. Token counts are provider
usage, not a verified dollar bill. Codex usage may include inherited history/cache.

## Frozen decision rule

    {
      "outcome": "no-demonstrated-benefit",
      "comparisons": {
        "native-reference": {
          "quality": false,
          "efficiency": false,
          "noRegression": true,
          "regressionPairs": 0,
          "winCases": 1,
          "repeatedLossCases": 0,
          "recoverySavingCases": 0
        },
        "local": {
          "quality": false,
          "efficiency": false,
          "noRegression": false,
          "regressionPairs": 1,
          "winCases": 0,
          "repeatedLossCases": 0,
          "recoverySavingCases": 0
        }
      }
    }

See [the protocol](CORRECTED-EVAL.md). Quality needs at least two additional fully
correct runs against both baselines, spread over at least two tasks against
each, without a repeated task loss. The alternative is equal quality and
material recovery-call savings within the latency bound. Additional matched
code regressions block either route. A tie does not show added value.

## Imperfect submissions

- log-redaction, jev, repetition 1: code 5/8; facts 3/3; failed tests: basic, quoted, custom.
- log-redaction, native-reference, repetition 1: code 5/8; facts 3/3; failed tests: basic, quoted, custom.
- log-redaction, native-reference, repetition 2: code 6/8; facts 3/3; failed tests: basic, custom.
- log-redaction, local, repetition 2: code 5/8; facts 3/3; failed tests: basic, quoted, custom.

Returned answers are in the JSON. No scoring rule or expected answer was changed
after observing the fresh outcomes.

## Verification and limits

Implementation: ca246b14aaaa06757571bce17bbeee02b1915e5b. All fixture, requirement, schema,
grading and runtime hashes were frozen before requests and verified afterward.
All 24 answers were independently rescored. Verified counts: four Jev requests,
12 checkpoint turns, 12 completed native compactions, 24 continuations, correct
fork lineage and tool accounting. Raw native sessions, opaque reasoning and
credentials are excluded; checkpoint content is represented only by hashes.

There are four distinct generated tasks, not 24 independent experiments.
Two repetitions share a native trajectory and ranking. Each task has 72 paired
scripted tool records and three manually triggered compactions. This is not
natural context exhaustion, real repository acceptance, or an automatic
PreCompact-hook test. The explicit search path is what was evaluated. Equal
character budgets do not equal token budgets, and cache state was not reset.
The small test can reveal failures, but cannot settle Jev's general value.
