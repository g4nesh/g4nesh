#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, decision, pauses, run, validate } from './profile-publication-schedule.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'profile-publication-test-'));
const base = { version: 1, seed: 'a'.repeat(64), startDate: '2026-09-09', lastClaimDate: null };
const at = (day, minute = '22:59') => new Date(`${day}T${minute}:00-07:00`);
const dateAt = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const anchor = Date.parse(base.startDate) / 86400000;
const quietRun = (...args) => {
  const original = console.log;
  console.log = () => {};
  try { return run(...args); } finally { console.log = original; }
};

try {
  assert.deepEqual(context(new Date('2026-09-12T06:59:00Z')), { date: '2026-09-11', minute: 1439 });
  assert.deepEqual(context(new Date('2026-09-12T07:00:00Z')), { date: '2026-09-12', minute: 0 });
  assert.throws(() => context(new Date('invalid')));
  assert.throws(() => validate({ ...base, startDate: '2026-02-30' }));
  assert.throws(() => validate({ ...base, version: 2 }));

  let availableWeekends = 0;
  let activeWeekends = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const state = { ...base, seed: seed.toString(16).padStart(64, '0') };
    const plannedPauses = pauses(state, dateAt(anchor + 730));
    assert(plannedPauses.some((pause) => pause.length === 1));
    assert(plannedPauses.some((pause) => pause.length === 2));
    assert(plannedPauses.some((pause) => pause.length === 14));
    assert(plannedPauses.every((pause) => [1, 2, 14].includes(pause.length)));
    const longPauses = plannedPauses.filter((pause) => pause.length === 14);
    assert(longPauses[0].start - anchor >= 180 && longPauses[0].start - anchor <= 365);
    for (let index = 1; index < longPauses.length; index++) {
      const interval = longPauses[index].start - longPauses[index - 1].start;
      assert(interval >= 365 && interval <= 395, 'Long pauses are not annual');
    }
    for (const pause of plannedPauses.filter((pause) => pause.length < 14)) {
      assert([2, 3].includes(new Date(pause.start * 86400000).getUTCDay()), 'Brief pause touches weekend');
    }
    const weekendCounts = new Map();
    let activeDays = 0;
    let inactiveStart = null;
    for (let offset = 0; offset < 730; offset++) {
      const day = anchor + offset;
      const date = dateAt(day);
      const weekday = new Date(date).getUTCDay();
      if (weekday === 6 && day + 1 < anchor + 730 &&
          !longPauses.some((pause) => day < pause.end && day + 1 >= pause.start)) {
        availableWeekends++;
        if (decision(state, at(date)).due || decision(state, at(dateAt(day + 1))).due) {
          activeWeekends++;
        }
      }
      const result = decision(state, at(date));
      assert.deepEqual(decision(JSON.parse(JSON.stringify(state)), at(date)), result, 'Restart changed schedule');
      if (plannedPauses.some((pause) => day >= pause.start && day < pause.end)) {
        assert.equal(result.due, false, `Published inside a pause on ${date}`);
      }
      if (!result.due) {
        inactiveStart ??= day;
        if (day - inactiveStart >= 2) {
          assert(longPauses.some((pause) => inactiveStart < pause.end && day >= pause.start),
            `Routine gap exceeds two days on ${date}`);
        }
        continue;
      }
      inactiveStart = null;
      activeDays++;
      assert.equal(decision(state, at(date, '00:00')).due, false, 'Midnight publication');
      assert.equal(decision(state, at(date, '23:00')).due, false, 'Expired date ran late');
      assert.equal(decision({ ...state, lastClaimDate: date }, at(date)).due, false, 'Repeat date accepted');
      if ([0, 6].includes(weekday)) {
        const saturday = day - (weekday === 0 ? 1 : 0);
        weekendCounts.set(saturday, (weekendCounts.get(saturday) || 0) + 1);
      }
    }
    assert(activeDays > 300 && activeDays < 620, 'Unexpected overall cadence');
    assert(weekendCounts.size > 0 && weekendCounts.size < 32, 'Weekend publication is not occasional');
    assert([...weekendCounts.values()].every((count) => count <= 1), 'Multiple dates in one weekend');
  }
  const weekendRate = activeWeekends / availableWeekends;
  assert(weekendRate > 0.12 && weekendRate < 0.18, `Weekend participation drifted: ${weekendRate}`);

  const file = path.join(temp, 'publication-schedule.json');
  writeFileSync(file, JSON.stringify(base));
  const beforePreview = readFileSync(file, 'utf8');
  assert.equal(quietRun(['--initialize', file], at(base.startDate)), 0);
  assert.equal(readFileSync(file, 'utf8'), beforePreview, 'Policy update reset existing state');
  assert.equal(quietRun(['--preview', file], at(base.startDate)), 0);
  assert.equal(readFileSync(file, 'utf8'), beforePreview, 'Preview mutated state');
  const eligibleDate = Array.from({ length: 30 }, (_, i) => dateAt(anchor + i))
    .find((date) => decision(base, at(date)).due);
  assert.equal(quietRun(['--claim', file], at(eligibleDate)), 0);
  assert.equal(quietRun(['--claim', file], at(eligibleDate)), 3, 'Crash/retry claimed twice');
  assert.equal(quietRun(['--claim', file], at('2026-09-08')), 3, 'Clock rollback accepted');
  const claimed = JSON.parse(readFileSync(file, 'utf8'));
  const future = dateAt(Date.parse(eligibleDate) / 86400000 + 100);
  assert.deepEqual(decision(claimed, at(future)), decision(base, at(future)), 'Missed dates caused catch-up');
  writeFileSync(file, '{broken');
  assert.throws(() => quietRun(['--claim', file], at(eligibleDate)));
  assert.equal(readFileSync(file, 'utf8'), '{broken', 'Corrupt state silently reset');

  // Exercise the real zsh wrapper: neither a pause nor corrupt state may reach Git,
  // even with the old force switch and environment flag present.
  const gitCalls = path.join(temp, 'git-calls');
  const fakeGit = path.join(temp, 'git');
  writeFileSync(fakeGit, `#!/bin/sh\nprintf called >> '${gitCalls}'\nexit 99\n`, { mode: 0o700 });
  const env = {
    ...process.env, NODE: process.execPath, GIT: fakeGit,
    TOKEN_COUNTER_STATE_DIR: temp, GITHUB_PROFILE_TOKEN_COUNTER_LOG_DIR: temp,
    TOKEN_COUNTER_FOREGROUND: '1', TOKEN_COUNTER_FORCE: '1'
  };
  writeFileSync(file, JSON.stringify({ ...base, lastClaimDate: context(new Date()).date }));
  let result = spawnSync('/bin/zsh', [path.join(scripts, 'update-codex-token-counter.sh'), '--force'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already attempted/);
  assert.throws(() => readFileSync(gitCalls));
  writeFileSync(file, '{broken');
  result = spawnSync('/bin/zsh', [path.join(scripts, 'update-codex-token-counter.sh')], { env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.throws(() => readFileSync(gitCalls));

  rmSync(file);
  const today = context(new Date()).date;
  writeFileSync(path.join(temp, 'last-success-date'), `${today}\n`);
  assert.equal(quietRun(['--initialize', file]), 0);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).lastClaimDate, today);
  assert.equal(quietRun(['--claim', file]), 3, 'Migration duplicated today’s update');
  console.log(`Verified 12 two-year schedules: ${(weekendRate * 100).toFixed(1)}% active weekends, one-update weekend limit, 1/2-day pauses, annual 14-day spacing, no extended routine gaps, preserved state, reservations, read-only preview, and fail-closed wrapper behavior.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
