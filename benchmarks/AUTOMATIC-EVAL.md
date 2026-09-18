# Automatic hook evaluation — frozen protocol

**Status: FROZEN BEFORE EXECUTION — quality comparison not yet executed.** The execution manifest,
task hashes, and go/no-go rule become frozen before the first scored run.
The task suite and runner passed offline validation. Separate disposable
wiring smokes may make native Codex and Jev calls; they are excluded from quality
scores. No task, prompt, budget, or grader may change after scored execution starts.

## Purpose and prior boundary

The next comparison must test the shipped automatic hook path itself:
`PreCompact` capture and optional selection followed by `SessionStart` context
injection. It must answer three separate questions:

1. Do the bundled plugin hooks load, trust, run, and restore context at every
   tested native compaction?
2. Which captured record IDs are selected, and which IDs are actually present
   in the context delivered after compaction?
3. Does that delivered context change downstream repository work: task success,
   preserved constraints, repeated failed actions, latency, or provider usage?

The corrected and long-task reports do not answer these questions completely.
The corrected comparison used explicit recovery selection and forked
continuations. The long-task run established a useful native-compaction
integration, but its recovery arms used reviewed user hooks invoking an
evaluation bridge, had one independent coding run per arm, and did not compare
the bundled plugin against a true stock Codex profile. The prior facts-ceiling
and coding-regex failures are therefore recorded as limitations, not evidence
of a memory gain or loss.

## Configurations

The only configuration difference is the recovery installation and mode. All
arms use the same pinned Codex CLI, model, reasoning effort, base instructions,
ordinary native tools, approval policy, sandbox, task prompts, stage boundaries,
turn/tool/time budgets, and repository snapshot.

| ID | Profile and recovery path | Additional plugin capability |
| --- | --- | --- |
| `stockCodex` | Fresh isolated Codex profile with no installed plugin, no hook registrations, no `FAST_JEV_*` variables, and no recovery data directory. Native Codex compaction only. | None. |
| `pluginLocal` | Fresh isolated profile with the shipped `.codex-plugin` installed and trusted. The actual bundled `PreCompact` and `SessionStart` hooks run with `FAST_JEV_MODE=local`, network disabled, and a run-unique data directory. | Automatic local recovery plus the documented CLI search/retrieve path. |
| `pluginJev` | Same as `pluginLocal`, with `FAST_JEV_MODE=jev`, network enabled for the hook process, and a securely supplied TypeSafe key. | Automatic Jev recovery plus the documented CLI search/retrieve path. |

Every arm receives the same ordinary Codex workspace and shell tools, with the
same approval, sandbox, and network policy. No arm receives plugin archive
tools as dynamic tools; plugin-arm calls to the documented CLI search/retrieve
commands are allowed and counted. The stock arm must be checked for both
absence of plugin hooks and absence of plugin archive data. The three approaches
must have distinct `CODEX_HOME` profiles and configs; every individual run must
have a fresh workspace, native thread/transcript, and recovery data directory.

Before freezing the manifest, the profile-isolation plan was clarified: each
approach reuses its own authenticated profile for its twelve runs. Each profile
was authenticated separately through the normal browser login; no credentials
were copied. Profiles are never shared between approaches. Cross-thread memories,
agents, apps, and unrelated skills are disabled; previous threads are archived
and cannot be resumed by the runner. Prior task workspaces and evaluator files
are outside the model's authorized task scope. Native action records are audited
for cross-run access. This is thread/workspace isolation with reused login state,
not 36 separately authenticated OS containers.

## Sampling and task shape

Use six independent, held-out, disposable public/synthetic repository tasks.
Each task has two nested repetitions, each with a fresh repository copy and
session, in every arm: `6 tasks × 2 repetitions × 3 arms = 36 arm runs`.
These are six independent task units with 12 task-repetition cells, not 12
independent tasks or 36 independent observations. Each run has at most three
native compaction boundaries, eight model turns per stage, 120 tool calls, and
15 minutes wall time.

The six-task repository suite must be created or selected and then hashed before
any live call. It is not present merely because `long-task-fixture.mjs` exists.
Each task should exercise a realistic multi-file change (roughly 8–20 files,
tests/configuration/docs where appropriate), at least two native compactions,
and an authoritative earlier tool result or instruction that is buried among
ordinary repository activity. The later stage must require the agent to use
that evidence while editing more than one file. Include explicit constraints
such as no upload/network, no duplicate write, preserve identifiers, or
preserve a migration invariant. Make visible contracts sufficient for the
hidden checks; do not repeat the earlier fact-ceiling design.

The implemented suite uses six small synthetic repositories with a public
facade, domain implementation, validation helper, history, configuration, and
tests. Each has three staged instructions and two manually requested native
compactions. The same task is repeated from a fresh state. Diagnostic logs are
about 22–24 KB each; this is not a claim to simulate a million-token conversation
or a large production repository. A negative result supports keeping the default
for this tested workflow; it cannot rule out every future Jev design or workload.

The hidden grader runs candidate code in a separate, credential-free Node
process. This is process isolation, not a claim of an OS sandbox around that
grader. The model's own commands run under native Windows workspace-write
sandboxing. Report missing action logs as unknown, not zero side effects; use
native command records for observable failures and repeated commands. Business
idempotency and immutable-file constraints are checked behaviorally. Do not infer
memory failure from an ordinary implementation error.

The evaluator must score behavior from isolated tests and an action log, not a
free-text recollection field. It must separately record code/test failures,
constraint violations, repeated failed fixes, duplicate side effects, and
successful completion. A regex-literal failure, a malformed patch, or a missing
fact is a result category to report; it cannot be converted into a memory claim.
Do not tune tasks, prompts, budgets, or graders after seeing fresh outcomes.

For a matched task/repetition, a common pre-fork checkpoint may be prepared
from the same visible messages and tool records, then forked into the three
arms immediately before the first tested compaction. Every fork must have its
own profile, workspace copy, transcript, archive directory, and tool/action
log. Post-fork model trajectories necessarily diverge when injected context
differs; score each complete arm run and use within-task/repetition deltas only
as paired comparisons. Never reuse one arm's archive, ranking, continuation,
or random seed as a second repetition.

## Frozen run procedure

Before live execution, save a protocol manifest containing the CLI version,
model, effort, configuration values, task/repository hashes, prompts,
instructions, dynamic tool schemas, evaluator hashes, budgets, arm order
schedule, and the plugin/package commit. Counterbalance arm order within each
task/repetition block. Use isolated profiles with no inherited plugin trust or
archive state. Run a one-time wiring smoke before task execution and then
validate the same conditions during every run.

For `pluginLocal` and `pluginJev`, `hooks/list` must show exactly the bundled
`PreCompact` matcher (`manual|auto`) and `SessionStart` matcher (`compact`),
with plugin provenance, enabled state, and trusted state. The runner must wait
for native compaction completion; it must never invoke the hook command itself.
At each boundary, require one matching `PreCompact` capture with a transcript,
one archive generation, and one matching `SessionStart` restoration with
non-empty context. Jev boundaries additionally require one successful Jev
selection or an explicitly recorded run failure; local fallback is not a
successful Jev observation. The Jev key must be present in the host process
environment that dispatches the bundled hook. Verify that the configured
shell-environment policy excludes it from model-launched shells while the hook
can read it; failure to verify that isolation is a no-go.

The smoke must also launch `stockCodex` in its own profile and inspect its hook
list, environment, transcript, and data root. Any plugin hook event, recovery
archive, injected recovery prefix, or plugin data under stock is a contamination
failure. A smoke pass is necessary and cannot be used as task-quality evidence.

## Measuring selected IDs versus injected context

Selection, hook emission, and host acceptance are different measurements and
must not be inferred from one another. For every plugin `PreCompact`, read the run-specific
`selection-<generation>.json` beside `index.json` and record its generation,
mode, selected IDs, candidate count, request count, ranking latency, provider
model, and provider usage. For every subsequent `SessionStart`, capture the
exact `additionalContext` emitted by the app-server hook event, hash it, and
parse only the JSON evidence lines carrying record IDs. Record the delivered
ID set, context character count, truncation/omission indicators, and the
selection-to-delivery difference.

Hook-emitted `selectedIds`, character counts, and hashes (including any
evaluation telemetry added to the hook) prove only what the hook emitted. They
do not prove that the host accepted or delivered that context. Acceptance must
be confirmed separately from the native Codex transcript, event stream, or
other native source containing the `additionalContext` after `SessionStart`.
If that native evidence is unavailable, mark delivery coverage `unknown` and
do not interpret downstream results as retrieval evidence; this is a no-go for
the quality comparison. Reconstructing `recoveryContext()` afterward is not
proof of host acceptance.

After completion, compare delivered IDs with IDs of the exact earlier stage-1
and stage-2 user instructions, identified in the archived records. These are
bounded instruction-coverage targets, not a claim to identify every relevant
tool result. Report archive capture coverage, selected-ID coverage,
delivered-ID coverage, omitted records, and the reason for each omission when
observable. These are coverage measures; a delivered record is not proof that
the model read or used every field in it.

Implementation bounds fixed before execution: each run has three model turns
and two manual compactions. Native command/file-change events supply operation,
failure, duplicate-command and write-operation counts. Identical repeated
commands are not automatically errors; duplicate external effects remain
unknown without an action log. No common trajectory is forked in this version:
each arm starts fresh from the identical repository and staged prompts. Stage
latencies measure continuations after compaction. Coverage omission causes are
reported as unknown where not observable. Native hook durations are recorded
separately from Jev request latency. The raw native session records remain local
for access auditing; only aggregates and hashes are published.

## Measurements and report

Report, per arm, task, repetition, and compaction:

- hook smoke status, hook event counts, archive generation, exact-context hash,
  selected IDs, delivered IDs, context size, and any fallback/error;
- repository hidden-test score, final task success, constraint violations,
  repeated failed fixes, duplicate side effects, write attempts, and all
  supplied tool counts;
- stage, compaction, hook, whole-run, and post-fork continuation latency;
- app-server native usage counters with input/cache/output/reasoning fields when
  available; Jev request count, provider model, input/output usage, and ranking
  latency separately; and `costUsd: null` unless an independently verified
  price is supplied.

Do not add cumulative native counters across forked runs as a bill. Do not call
provider-token reductions a cost saving. Publish aggregate reports and hashes,
not transcripts, opaque reasoning, credentials, or private archives.

## Predeclared go/no-go rule

The protocol is **no-go** if any of these is true before scoring: native host
acceptance cannot be observed; stock contamination is detected; the bundled
hooks are not both trusted and enabled; key/shell isolation is unverified; task
contracts do not support their hidden checks; an arm changes model,
instructions, budgets, or ordinary tools; a Jev fallback is counted as success;
or a run reuses a post-fork trajectory/archive as a second repetition.

The integration passes only if every plugin arm has the expected hook pair at
every boundary, every stock arm has zero plugin hook/archive events, and all 36
arm runs finish or are reported as technical failures. The downstream
comparisons have fixed practical thresholds and are evaluated independently:

- `pluginLocal` must gain at least three fully successful task/repetition runs
  over `stockCodex`, with gains on at least two distinct tasks, no task lost in
  both repetitions while stock succeeds in both, and no new hard-constraint
  regression; and
- `pluginJev` must independently gain at least two fully successful
  task/repetition runs over `stockCodex`, with gains on at least two tasks, the
  same repeated-loss guard, no hard-constraint regression, and no more than
  20% higher median whole-run latency than stock including ranking; and
- the separate `pluginJev` versus `pluginLocal` comparison uses the same
  two-run, two-task, no-regression rule. A Jev pass does not depend on a local
  pass.

If a threshold is not met, report `no-demonstrated-downstream-benefit` and keep
stock Codex as the default. Improved ID coverage without downstream success is
`coverage-only`; successful wiring without native acceptance is
`integration-only`. A Jev result cannot be recommended from latency or provider
usage alone. The execution manifest freezes these rules before any live result
is seen.

## Reuse candidates and required adaptations

- `benchmarks/long-task.mjs` and `codex-eval-client.mjs` are the best starting
  points for app-server turns, native compaction waits, usage, isolated
  workspaces, and action logs. The current runner has four stages and one
  synthetic garden task; it is not the six-task fixture specified here.
- `benchmarks/long-task-hook.mjs` has useful capture/selection/context telemetry,
  but it is an evaluation bridge for reviewed user hooks. Reuse its fields only
  after adapting the measurement to the bundled plugin path; its existing use
  cannot establish plugin discovery.
- `benchmarks/long-task-hook-setup.mjs` demonstrates isolated profile selection
  and trust preconditions. It must not be used to silently replace bundled
  plugin hooks with user-hook commands.
- `benchmarks/long-task-fixture.mjs` provides an action-log evaluator and
  constraint checks. Its single-file reconciliation fixture should be treated
  as an implementation pattern, not as the claimed multi-file held-out suite.
- `src/hooks.ts`, `hooks/hooks.json`, and `.codex-plugin/plugin.json` define the
  production capture, selection, and restoration path to verify. The corrected,
  held-out, and paired protocols provide reusable hashing, fork-lineage, and
  no-fallback reporting patterns, but their explicit search packets are outside
  this evaluation.
