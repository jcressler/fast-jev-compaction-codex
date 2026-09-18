# Synthetic Jev recovery trial

`jev-trial.mjs` compares the local `recoveryContext` selection with the
recovery module's Jev-ranked selection. It builds three disposable
synthetic archives containing useful earlier tool calls, a failed patch, a
successful write, many noisy recent outputs, a later instruction correction,
and a final reminder not to repeat side effects. Each independent capture
ends with one visible task goal, so the recovery selector receives the goal
for that trial. Live mode therefore makes at most three Jev requests.

Run the offline comparison after building the package:

```sh
npm run build
node benchmarks/jev-trial.mjs
```

The default path never uses the network. It also includes a
`candidate-order` ablation: the real selector builds the same candidate pool,
then receives equal scores from an injected in-process asker. That ablation
makes zero network requests and measures candidate ordering separately from
model re-ranking; it is not a simulated live Jev result.

To run the live path, use the repository helper, which reads a key through
hidden input or `-FromClipboard` and does not put it in the command line:

```powershell
pwsh -File scripts/test-jev.ps1 -OutputPath work/jev-live-trial.json
```

Use `-FromClipboard` when the key is already copied.

The live path sends only the synthetic fixture through `selectRecovery`. It
passes each visible task goal as the selection goal; hidden fixture target
records are used by the local scorer and are not put in the query. A live
selection that falls back to local ranking is an error and exits nonzero.
The harness also exits nonzero for malformed selection results, more than one
request per trial, or more than three requests in total.

Use `--output PATH` to write a machine-readable report. The write is exclusive:
an existing path is never overwritten.

```sh
node benchmarks/jev-trial.mjs --output work/jev-trial.json
```

The report records local, candidate-order, and Jev mode, selected-record counts, hidden-target
coverage, pinned-constraint coverage, latency, candidate count, request
characters, request count, returned model, returned usage when available, and
the generated synthetic recovery contexts with their temporary archive path
redacted. It deliberately omits raw transcript records, Jev responses,
credentials, and cost estimates. `liveModelEvaluation` is `false`: this measures evidence
selection against a known synthetic fixture, not whether a Codex model gives
the right final answer, preserves all task behavior, or improves production
reliability. The candidate-order row shares the selector's candidate pool but
does not isolate every possible local ranking strategy. Coverage is an ID-set
check and is not a semantic judgment.

Run the offline harness self-test after building:

```sh
node benchmarks/jev-trial-self-test.mjs
```

The self-test validates the fixture shape and report contract without making a
network request. It should be used as a smoke test for benchmark changes, not
as evidence of live Jev quality or cost. Compare the offline report's
`candidateOrder` section with a previously saved live report when you want to
separate shortlist ordering effects from Jev's score ordering; no new live
requests are needed for that comparison.
