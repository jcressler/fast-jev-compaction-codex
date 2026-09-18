#!/usr/bin/env node
/**
 * Paired v2 fixture wrapper. v1 remains frozen; only the visible SKU quantity
 * wording is clarified for the fresh paired slot.
 */
import * as v1 from './automatic-fixtures.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createTask(taskIndex, repetition = 1) {
  const task = v1.createTask(taskIndex, repetition);
  if (task.baseId !== 'sku-index') return task;
  const updated = clone(task);
  updated.contract = updated.contract.replace('sum integer quantities', 'sum nonnegative integer quantities');
  updated.files['README.md'] = updated.files['README.md'].replace('sum integer quantities', 'sum nonnegative integer quantities');
  // README is intentionally not in immutableHashes; all hidden expected data,
  // starter/reference files, stages, and task identity remain unchanged.
  return updated;
}

export const materializeTask = v1.materializeTask;
export const scoreTask = v1.scoreTask;
export const taskCount = v1.taskCount;
export function taskHashes(task) { return v1.taskHashes(task); }

