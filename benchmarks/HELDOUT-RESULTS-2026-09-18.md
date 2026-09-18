# Final held-out coding continuation results — 2026-09-18

The revised Jev reranker did not meet the predeclared project continuation threshold. Stop further Jev feature development for this project and retain native compaction and local retrieval as defaults. This does not prove every possible Jev integration is ineffective.

## Results

| Approach | All exact checks pass | Code tests | Exact fact checks | Recovery calls | Duplicate calls | Continuation + ranking latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native-reference | 4/8 | 64/64 | 14/24 | 0 | 0 | 100.25 s |
| local | 4/8 | 64/64 | 12/24 | 0 | 0 | 112.89 s |
| jev | 4/8 | 64/64 | 18/24 | 0 | 0 | 110.82 s |

The native reference receives no proactive packet but has the same exact
archive recovery tools as both other approaches. It is not unmodified stock
Codex. A fully correct run must pass all eight hidden code tests and all three
typed fact checks. Latency is summed across 8 runs per approach; the Jev total
charges the full ranking latency separately to each repetition. Shared native
checkpoint and compaction time is excluded from these comparable totals.

The frozen fact grader uses literal typed equality. Equivalent wording such
as "half-up to cents" versus "half-up cents" loses literal credit. Those
differences must not be interpreted as forgotten facts. A separately labeled
post-hoc semantic audit accompanies these results; the frozen scores and
decision rule remain unchanged.

| Task | Native reference | Local | Jev |
| --- | ---: | ---: | ---: |
| local-window | 2/2 | 2/2 | 2/2 |
| cent-rounding | 0/2 | 0/2 | 0/2 |
| reservation-ledger | 2/2 | 2/2 | 0/2 |
| csv-identifiers | 0/2 | 0/2 | 2/2 |

## Post-hoc semantic fact audit

This supplementary review was performed after seeing the answers. It does not
replace the frozen exact-match grader or change the continuation threshold.
It accepts the observed equivalent wording for basis points, half-up cents,
identifier normalization, and duplicate rejection. Per-field judgments and
returned values are included in the JSON for inspection.

| Approach | Semantically correct facts | All code and semantic facts |
| --- | ---: | ---: |
| native-reference | 22/24 | 6/8 |
| local | 20/24 | 4/8 |
| jev | 22/24 | 6/8 |

The substantive misses were repeated in both observations:

- Native reference: the CSV header name, vendor_id, was replaced by a description of case-insensitive matching.
- Local: the CSV header name was not supplied, and the historical discount cap of 1250 cents was null.
- Jev: the reservation duration of 20 minutes was null; its packet omitted that original record.

Jev matched the native reference on this semantic count and traded one task's
missing fact for another. All approaches used zero recovery calls, so no
recovery-work saving was demonstrated. The decision to shelve further Jev
development remains the same under this supplementary interpretation.

## Jev overhead and evidence exposure

Four successful calls used provider-reported model jev-1.13.0, with
35,657 input tokens and 1,656 output tokens.
Actual ranking time totaled 1.179 seconds. There were no fallback rankings.
These are Jev usage measurements, not a dollar-cost estimate. Codex usage is
reported per run in the JSON and may include inherited history and caching;
it is not summed into a verified bill.

| Task | Scored fact records in candidate pool | Local packet | Jev packet |
| --- | ---: | ---: | ---: |
| local-window | 3/3 | 3/3 | 3/3 |
| cent-rounding | 2/3 | 1/3 | 2/3 |
| reservation-ledger | 3/3 | 3/3 | 2/3 |
| csv-identifiers | 3/3 | 3/3 | 3/3 |

This measures original record membership, not proof that every fact survives
excerpting. Some scored facts also appear in the task specification. Missing
candidates were not inserted using ground truth, and all original visible
records remained available through the same recovery tools for all approaches.

## Decision under the frozen rule

    {
      "outcome": "shelve",
      "comparisons": {
        "native-reference": {
          "quality": false,
          "efficiency": false,
          "noRegression": true,
          "regressionPairs": 0,
          "winCases": 1,
          "repeatedLossCases": 1,
          "recoverySavingCases": 0
        },
        "local": {
          "quality": false,
          "efficiency": false,
          "noRegression": true,
          "regressionPairs": 0,
          "winCases": 1,
          "repeatedLossCases": 1,
          "recoverySavingCases": 0
        }
      }
    }

See [the protocol](HELDOUT-EVAL.md) for the numeric quality/efficiency thresholds.
The complete comparison used four distinct tasks, two paired observations per
approach per task, 12 actual native compactions, 12 shared model checkpoint
turns, and 24 final coding continuations on gpt-5.6-luna, medium effort.
All four Jev rankings were completed before any native continuation outcomes.

## Invalidated pilot

An earlier six-case protocol was stopped after 12 answers on its first two
cases because their visible task contracts omitted details required by hidden
tests. Those scores are excluded, with the reason retained in
[the pilot record](HELDOUT-PILOT-INVALIDATED-2026-09-18.json). The four remaining
cases had no prior continuation outcomes. Their input/output contracts were
clarified before this corrected run; sources, tests, and the production Jev
reranker were unchanged. This is a disclosed protocol amendment, not the
original six-case preregistration. The discarded pilot consumed six Jev calls,
52,020 input tokens and 2,484 output tokens in addition to the usage above.

## Imperfect submissions

- cent-rounding, local, repetition 1: code 8/8; facts 0/3; failed tests: none.
- cent-rounding, jev, repetition 1: code 8/8; facts 1/3; failed tests: none.
- cent-rounding, native-reference, repetition 1: code 8/8; facts 1/3; failed tests: none.
- cent-rounding, jev, repetition 2: code 8/8; facts 1/3; failed tests: none.
- cent-rounding, native-reference, repetition 2: code 8/8; facts 1/3; failed tests: none.
- cent-rounding, local, repetition 2: code 8/8; facts 0/3; failed tests: none.
- reservation-ledger, jev, repetition 1: code 8/8; facts 2/3; failed tests: none.
- reservation-ledger, jev, repetition 2: code 8/8; facts 2/3; failed tests: none.
- csv-identifiers, native-reference, repetition 1: code 8/8; facts 0/3; failed tests: none.
- csv-identifiers, local, repetition 1: code 8/8; facts 0/3; failed tests: none.
- csv-identifiers, local, repetition 2: code 8/8; facts 0/3; failed tests: none.
- csv-identifiers, native-reference, repetition 2: code 8/8; facts 0/3; failed tests: none.

These are the frozen grader results. Returned implementations and facts are
included in the accompanying JSON so failures can be inspected directly.

## Verification and practical limits

Implementation commit: 7044602c85d2323f274d53839d64339c6c7637af. Fixture, query, task context, source,
expected implementation, hidden tests, schemas, and runtime hashes were frozen
before live requests and checked again afterward. All 24 answers were rescored;
fork lineage, tool accounting, and the exact stage counts were verified. The
published JSON excludes raw native sessions, opaque reasoning, credentials,
and checkpoint text (only checkpoint hashes and timing are retained).

These are generated maintenance functions with scripted visible tool history,
not real repository tasks. Each history contains roughly 52–53 KB of generated
evidence and three manual native compactions. Actual model checkpoint reasoning
is shared across approaches. Repetitions share trajectories and rankings and
are not independent tasks. Models can recover evidence but cannot execute the
hidden tests or revise after grading. Regression checks cover code behavior,
not prompt injection or real external side effects. Character budgets differ
from token budgets; cache state is not reset. This tests explicit search
reranking with a common packet, not the automatic PreCompact selector.
The reranker receives query and task context but not Codex's output schema;
schema-only audit fields are therefore not explicit ranking requirements.
This limits attribution of missing audit facts to Jev's model ability.

The stopping rule is a practical investment decision for this project, not a
claim of statistical significance or a universal conclusion about Jev.
