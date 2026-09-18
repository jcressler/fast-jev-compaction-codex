#!/usr/bin/env node
/** Live diagnostic on previously exposed cases. Never counted as fresh evidence. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JevClient } from '../dist/client.js';
import { makeHeldoutCases } from './heldout-fixtures.mjs';
import { prepareCase } from './corrected-eval.mjs';

export async function runDevelopmentCheck({ runDir, allowNetwork = false } = {}) {
  if (!allowNetwork || !process.env.TYPESAFE_API_KEY || !runDir) throw new Error('Requires explicit network, environment key and new output directory');
  const root = resolve(runDir);
  await mkdir(root, { recursive: true });
  // Reserve this diagnostic directory before any paid request. Never overwrite a run.
  await writeFile(join(root, 'development.json'), JSON.stringify({ status: 'started' }), { flag: 'wx', mode: 0o600 });
  const requirements = {
    'reservation-ledger': [
      'activeStatuses: the current reservation statuses that consume available stock.',
      'reservationTtlMinutes: the current duration in minutes for new reservations, even though expiration is outside this helper.',
      'duplicatePolicy: the approved behavior for an already active reservation id.',
    ],
    'cent-rounding': [
      'rateBasis: the unit used for tax and discount rates.',
      'rounding: the approved rounding convention for money operations.',
      'discountCapCents: the current historical discount cap in integer cents.',
    ],
  };
  const client = new JevClient();
  let calls = 0;
  const asker = { ask: (state, questions) => {
    if (++calls > 2) throw new Error('Development request budget exceeded');
    return client.ask(state, questions);
  } };
  const report = { status: 'running', kind: 'exposed-development-cases', calls: 0, cases: [] };
  try {
    for (const item of makeHeldoutCases().filter(item => requirements[item.id])) {
      const value = await prepareCase({ ...item, requirements: requirements[item.id] }, root, asker);
      report.cases.push(value.report); report.calls = calls;
      await writeFile(join(root, 'development.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ case: item.id, model: value.report.jev.model,
        localFacts: value.report.packets.local.scoredFactRecordsShown,
        jevFacts: value.report.packets.jev.scoredFactRecordsShown }));
    }
    report.status = 'completed';
  } finally {
    report.calls = calls;
    if (report.status !== 'completed') report.status = 'incomplete';
    await writeFile(join(root, 'development.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  runDevelopmentCheck({ runDir: args.includes('--run-dir') ? args[args.indexOf('--run-dir') + 1] : undefined,
    allowNetwork: args.includes('--allow-network') }).catch(() => {
    console.error('Development check incomplete; no key or remote error body is logged.'); process.exitCode = 1;
  });
}
