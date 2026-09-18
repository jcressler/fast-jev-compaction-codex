#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixtureItems, evaluateSelection, runTrial } from './jev-trial.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const items = fixtureItems();
assert(items.length >= 100, 'fixture should include rich tool history and noise');
assert(items.some((item) => item.call_id === 'failed-greenhouse-patch'), 'fixture should include failed patch');
assert(items.some((item) => item.call_id === 'write-greenhouse-receipt'), 'fixture should include successful write');
const itemText = JSON.stringify(items);
assert(itemText.includes('PIN-CONSTRAINT-LOCAL-STORAGE'), 'fixture should include pinned constraint');
assert(itemText.includes('LATEST-CORRECTION-LOCAL-PICKUP'), 'fixture should include later correction');
assert(itemText.includes('HIDDEN-INVOICE-APPROVED-PICKUP'), 'fixture should include the non-write target');

const fakeCatalog = {
  entries: [
    { id: 'write-id', callId: 'write-greenhouse-receipt', summary: 'write receipt', outcome: 'success', kind: 'tool' },
    { id: 'failure-id', callId: 'failed-greenhouse-patch', summary: 'patch', outcome: 'EACCES failure', kind: 'tool' },
    { id: 'constraint-id', summary: 'PIN-CONSTRAINT-LOCAL-STORAGE keep supplier documents local', outcome: '', kind: 'message' },
    { id: 'correction-id', summary: 'LATEST-CORRECTION-LOCAL-PICKUP use local pickup', outcome: '', kind: 'message' },
  ],
};
const score = evaluateSelection(['write-id', 'constraint-id', 'correction-id'], fakeCatalog, {
  targetCalls: ['write-greenhouse-receipt', 'failed-greenhouse-patch'],
  targetMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP'],
  pinnedMarkers: ['PIN-CONSTRAINT-LOCAL-STORAGE', 'LATEST-CORRECTION-LOCAL-PICKUP'],
});
assert(score.targetHitCount === 3, 'coverage scorer should count call and marker targets');
assert(score.pinnedConstraintHitCount === 2, 'coverage scorer should count pinned constraints');

const report = await runTrial({ live: false });
assert(report.liveModelEvaluation === false, 'offline report must not claim live model evaluation');
assert(report.jev.mode === 'disabled', 'offline report should disable Jev');
assert(report.local.trials.length === 3, 'offline report should contain three trials');
assert(report.local.requests === 0, 'offline report should make no Jev requests');
assert(report.candidateOrder.mode === 'candidate-order', 'offline report should include candidate-order ablation');
assert(report.candidateOrder.requests === 0, 'candidate-order ablation must make no network requests');
assert(report.candidateOrder.trials.every((trial) => trial.reason.includes('no network')), 'ablation must identify its injected asker');
assert(report.local.trials.every((trial) => trial.contextChars <= report.budgetChars), 'local context must honor the character budget');
assert(report.local.trials.every((trial) => typeof trial.context === 'string' && !trial.context.includes('fast-jev-trial-')), 'report should include redacted synthetic contexts');
assert(report.fixture.hiddenTargetsSentInQuery === false, 'hidden targets must stay out of queries');

const script = fileURLToPath(new URL('./jev-trial.mjs', import.meta.url));
const blocked = spawnSync(process.execPath, [script, '--live', '--allow-network'], {
  encoding: 'utf8',
  env: { ...process.env, TYPESAFE_API_KEY: '' },
});
assert(blocked.status !== 0, 'live mode should reject a missing key');
assert(`${blocked.stdout}\n${blocked.stderr}`.includes('TYPESAFE_API_KEY'), 'missing-key guard should be explicit');

await stat(script);
console.log('jev-trial self-test passed');
