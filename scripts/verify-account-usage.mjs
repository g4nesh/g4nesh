import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAccountPayload, readAccountUsage } from './codex-account-usage.mjs';
const pricing = { usdPerMillionTokens: 1.35 };
const usage = { summary: { lifetimeTokens: 3000000, currentStreakDays: 2 }, dailyUsageBuckets: [
  { startDate: '2026-09-20', tokens: 1000000 }, { startDate: '2026-09-19', tokens: 500000 }
] };
const now = '2026-09-21T00:00:00Z';
const payload = buildAccountPayload(usage, pricing, now);
assert.equal(payload.totals.totalTokens, 3000000);
assert(Math.abs(payload.totals.totalCost - 4.05) < 1e-10);
assert.equal(payload.dailyCoverage.totalTokens, 1500000);
assert.equal(payload.dailyCoverage.lifetimeMinusDailyTokens, 1500000);
assert.equal(payload.daily[0].date, '2026-09-19');
assert.deepEqual(buildAccountPayload(usage, pricing, now), payload); // no additive machine snapshots
assert.equal(payload.summary.peakDailyTokens, null);
assert.equal(buildAccountPayload({ summary: { lifetimeTokens: 0 }, dailyUsageBuckets: null }, pricing).dailyCoverage.available, false);
assert.equal(buildAccountPayload({ summary: { lifetimeTokens: 0 }, dailyUsageBuckets: [] }, pricing).dailyCoverage.available, true);
for (const value of [null, undefined, -1, NaN, Infinity, '3', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => buildAccountPayload({ ...usage, summary: { lifetimeTokens: value } }, pricing));
}
for (const rate of [0, -1, NaN, Infinity, '1']) assert.throws(() => buildAccountPayload(usage, { usdPerMillionTokens: rate }));
for (const buckets of [
  [{ startDate: '2026-02-30', tokens: 1 }], [{ startDate: '2026-09-20', tokens: null }],
  [usage.dailyUsageBuckets[0], usage.dailyUsageBuckets[0]], {},
]) assert.throws(() => buildAccountPayload({ ...usage, dailyUsageBuckets: buckets }, pricing));
// A lagging lifetime summary must not silently alter the returned daily history.
assert.equal(buildAccountPayload({ ...usage, summary: { lifetimeTokens: 1 } }, pricing).dailyCoverage.lifetimeMinusDailyTokens, -1499999);

const dir = mkdtempSync(path.join(os.tmpdir(), 'account-usage-test-'));
try {
  const fake = path.join(dir, 'codex');
  const script = (body) => writeFileSync(fake, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  script(`const rl = require('node:readline').createInterface({ input: process.stdin });
    let initialized = false;
    rl.on('line', line => { const m = JSON.parse(line);
      if (m.method === 'initialize') console.log(JSON.stringify({ id: m.id, result: {} }));
      if (m.method === 'initialized') initialized = true;
      if (m.method === 'account/usage/read') console.log(JSON.stringify(initialized ? { id: m.id, result: ${JSON.stringify(usage)} } : { id: m.id, error: { code: -1 } }));
    });`);
  assert.deepEqual(await readAccountUsage({ binary: fake }), usage);
  script(`console.log(JSON.stringify({ id: 1, error: { code: -32601 } })); setInterval(() => {}, 1000);`);
  await assert.rejects(readAccountUsage({ binary: fake }), /Update Codex/);
  script('process.exit(1);');
  await assert.rejects(readAccountUsage({ binary: fake }), /exited/);
  script('setInterval(() => {}, 1000);');
  await assert.rejects(readAccountUsage({ binary: fake, timeoutMs: 100 }), /timed out/);
  await assert.rejects(readAccountUsage({ binary: path.join(dir, 'missing') }), /Cannot start/);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('Verified account counters, pricing, daily coverage, RPC handshake, and failure handling.');
