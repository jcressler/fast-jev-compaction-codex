# Final bounded Jev experiment

The previous paired trial found no advantage for Jev. This trial makes one
focused change: explicit archive-search reranking receives a larger visible
evidence view, the full bounded query, and task context. It preserves the local
candidate order on tied scores or failed requests. Native compaction remains
unchanged. The automatic PreCompact selector is outside this experiment.

## Frozen comparison

Four new coding-maintenance cases each contain three chronological stages of
generated tool evidence, including failed attempts, corrections, and unrelated
work. Codex reviews each stage, then runs native compaction. Thus every case
has an actual model reasoning trajectory and three native compactions before
the final code submission. This is still a generated small-function benchmark,
not real repository work or a natural context-exhaustion test.

The final compacted state is forked for two repetitions of each approach:

- **Native reference:** no proactive evidence packet.
- **Local:** production lexical archive-search order and a bounded packet.
- **Jev:** the same candidates and packet formatter, ordered by live Jev scores.

All three have the same offline archive search and exact-record retrieval
tools. Consequently, the native reference is native compaction with benchmark
recovery tools, not unmodified stock Codex. Tool queries during continuations
use local search for every approach; Jev is called once per case for the initial
packet only. This isolates its proactive ordering.

Up to 20 candidates come from production search. Ground-truth labels never
insert missing candidates. Both packet approaches use the same 6,000-character
budget, 2,000-character entry limit, and source excerpt for a given record.
Equal character caps are not equal token counts. Candidate omissions and
packet membership are recorded separately from task success.

The continuation returns a JavaScript `solve(input)` function and three
historical facts. Code is executed against hidden deterministic tests only
after submission, in a bounded child process with no Jev credential. The model
cannot inspect the expected implementation or hidden test results. Facts are
graded by exact typed equality. Each continuation may use up to eight recovery
calls; attempted calls beyond that return a budget error and are counted.
Repeated identical tool requests and regression-test failures are reported.

The runner uses `gpt-5.6-luna`, medium effort, the same instructions and schema
for all approaches, and order balanced to within one occurrence per position.
Its upper bounds are four Jev
requests, 12 shared checkpoint turns, 12 native compactions, and 24 final
continuations. Repetitions share a compaction trajectory and ranking, so there
are four distinct tasks, not 24 independent experiments.

Fixture, query, source, hidden-test, schema, and implementation hashes are
written before any live request. All rankings are completed before any model
continuation. We do not adjust fixtures, ranking, packet budgets, or grading
after seeing the outcomes. A technical failure makes the comparison incomplete;
it is never counted as a successful Jev fallback.

## Decision rule set before execution

Continue pursuing Jev only if the complete trial satisfies either of these:

1. At least two additional fully correct runs compared with **each** baseline,
   with gains on at least two distinct tasks against each, and no task lost in
   both repetitions while that baseline succeeds in both.
2. Equal or better fully correct counts, passed code tests, and correct facts
   against **each** baseline, with at least 25% fewer recovery calls, at least
   four calls saved across at least two tasks against each, and no more than
   10% added continuation latency including Jev ranking.

Either route also requires no additional hard-constraint regression-test
failures in any matched task/repetition against either baseline. These tests
cover code behavior, not prompt injection or real external side effects.
Each repeated Jev continuation is charged
the full ranking latency, rather than amortizing the one ranking over repeats.
Otherwise, shelve further Jev development for this project. These thresholds
are a practical project stopping rule, not statistical significance. A null
result does not establish that every possible Jev integration is ineffective.

## Run and reporting

```sh
npm run check
npm run benchmark
node benchmarks/heldout-eval.mjs
# Requires an authenticated compatible Codex CLI and a securely supplied key:
node benchmarks/heldout-eval.mjs --live --allow-network \
  --codex /absolute/path/to/codex --run-dir /new/private/run-directory
```

The key comes from `TYPESAFE_API_KEY`, never a command-line argument or tracked
file. The runner removes it from Codex child environments. The existing Codex
login is reused; global configuration is unchanged. Base sessions are archived
after use and answer forks are ephemeral. The [official app-server interface](https://learn.chatgpt.com/docs/app-server)
provides the native compaction, visible-item injection, dynamic tools, and forks.

Reports contain generated visible checkpoints, returned code/facts, packet
text, scores, tool-call counts, latency, and provider-reported usage. Do not
publish native session rollouts, opaque reasoning payloads, authentication
files, or the complete private run directory. Codex usage can include inherited
history and caching; it is not summed into a verified bill. Dollar cost remains
unknown. The four cases had no continuation outcomes in earlier live trials, but their source is
visible to implementers; they are not a blind external evaluation.
Some contract facts also appear in the task specification; the factual score
is not a pure archive-recall measure. Reports distinguish scored fact records
from other historical target records; record presence is not proof that every
fact survives an excerpt cap. Recovery-call counts exclude the separately
reported Jev API request. Calls attempted after the eight-call budget return
errors and remain in the overhead counts.

## Invalidated pilot and protocol correction

The initial protocol at commit `8851411` began with six cases. After twelve
continuations on its cursor and retry cases, review found that hidden tests
required details absent from their visible contracts: initial-null cursor
behavior, the event key field, the location of retry-after, and the precise
backoff exponent. The run was stopped before any continuation on the other
four cases. Those twelve scores are not evidence for or against Jev.

The corrected protocol uses only the four untouched cases (time windows,
money rounding, reservations, and CSV import). Explicit input/output contracts
are audited against their unchanged tests before execution. It makes four new
Jev requests; the six pilot ranking requests are reported as discarded overhead.
The production reranker and numeric continuation thresholds are unchanged.
No ranking prompt, excerpt heuristic, candidate limit, or packet limit was
retuned from the pilot outcomes. The dataset reduction and contract repair are
protocol changes and are disclosed, rather than presenting this as the original
six-case preregistration. Pilot details are retained in
[the invalidated pilot record](HELDOUT-PILOT-INVALIDATED-2026-09-18.json).
