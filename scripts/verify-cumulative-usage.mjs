import assert from 'node:assert/strict';
import { mergeCumulativeUsage } from './merge-cumulative-usage.mjs';

const baseline = payload({
  generatedAt: '2026-07-27T20:00:00.000Z',
  tokens: 100,
  cost: 10,
  model: 'legacy-model',
  date: '2026-07-26',
  sessionId: null
});
const firstLocal = payload({
  generatedAt: '2026-07-27T21:00:00.000Z',
  tokens: 20,
  cost: 2,
  model: 'new-model',
  date: '2026-07-27',
  sessionId: 'machine-a/session-1'
});
const firstMerge = mergeCumulativeUsage(baseline, firstLocal, 'machine-a');

assert.equal(firstMerge.totals.totalTokens, 120);
assert.equal(firstMerge.totals.totalCost, 12);
assert.equal(firstMerge.totals.sessions, 2);
assert.equal(firstMerge.totals.activeDays, 2);
assert.equal(firstMerge.models.find((row) => row.name === 'new-model')?.totalTokens, 20);
assert.equal(firstMerge.sessions.at(-1).sourceMachine, 'machine-a');
assert.equal(firstMerge.collection.machines['machine-a'].totals.totalTokens, 20);

const updatedLocal = payload({
  generatedAt: '2026-07-27T22:00:00.000Z',
  tokens: 35,
  cost: 3.5,
  model: 'new-model',
  date: '2026-07-27',
  sessionId: 'machine-a/session-1'
});
const secondMerge = mergeCumulativeUsage(
  firstMerge,
  updatedLocal,
  'machine-a'
);

assert.equal(secondMerge.totals.totalTokens, 135);
assert.equal(secondMerge.totals.totalCost, 13.5);
assert.equal(secondMerge.totals.sessions, 2);
assert.equal(secondMerge.daily.find((day) => day.date === '2026-07-27')?.totalTokens, 35);

const otherMachine = payload({
  generatedAt: '2026-07-27T23:00:00.000Z',
  tokens: 5,
  cost: 0.5,
  model: 'other-model',
  date: '2026-07-27',
  sessionId: 'machine-b/session-1'
});
const thirdMerge = mergeCumulativeUsage(
  secondMerge,
  otherMachine,
  'machine-b'
);

assert.equal(thirdMerge.totals.totalTokens, 140);
assert.equal(thirdMerge.totals.totalCost, 14);
assert.equal(thirdMerge.totals.sessions, 3);
assert.equal(thirdMerge.daily.find((day) => day.date === '2026-07-27')?.totalTokens, 40);
assert.deepEqual(Object.keys(thirdMerge.collection.machines).sort(), [
  'machine-a',
  'machine-b'
]);

console.log('Verified cumulative baseline cutover, idempotent machine refresh, and multi-machine addition.');

function payload({ generatedAt, tokens, cost, model, date, sessionId }) {
  const session = {
    index: 1,
    date,
    lastActivity: generatedAt,
    sessionId,
    totalTokens: tokens,
    totalCost: cost,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 0,
    modelsUsed: [model],
    topModel: model,
    agent: 'codex'
  };
  const breakdown = {
    modelName: model,
    totalTokens: tokens,
    totalCost: cost,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 0
  };
  return {
    generatedAt,
    source: 'synthetic',
    scope: 'year-to-date',
    range: {
      firstDay: date,
      lastDay: date
    },
    totals: {
      totalTokens: tokens,
      totalCost: cost,
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 0,
      sessions: 1,
      activeDays: 1,
      favoriteModel: {
        name: model,
        totalTokens: tokens
      }
    },
    models: [{
      name: model,
      totalTokens: tokens,
      totalCost: cost,
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 0
    }],
    daily: [{
      date,
      totalTokens: tokens,
      totalCost: cost,
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningOutputTokens: 0,
      modelsUsed: [model],
      topModel: model,
      modelBreakdowns: [breakdown]
    }],
    sessions: [session]
  };
}
