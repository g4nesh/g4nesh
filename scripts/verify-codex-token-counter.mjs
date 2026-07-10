#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [readme, dataText, launcher, plist] = await Promise.all([
  read('README.md'),
  read('data/codex-token-usage.json'),
  read('scripts/update-codex-token-counter.sh'),
  read('launchd/com.ganeshtalluri.github-profile-token-counter.plist')
]);
const data = JSON.parse(dataText);

assert(readme.includes('<!-- codex-token-counter:start -->'));
assert(readme.includes('<!-- codex-token-counter:end -->'));
assert(readme.includes(data.totals.totalTokens.toLocaleString('en-US')));
assert(readme.includes(data.totals.activeDays.toLocaleString('en-US')));
assert(readme.includes(data.totals.sessions.toLocaleString('en-US')));
assert(readme.includes(data.totals.favoriteModel?.name || 'unknown'));
assert(readme.includes('auto-refreshes once daily when this Mac is available'));

assert.equal(data.range.endDate, phoenixDate(new Date(data.generatedAt)));
assert(data.daily.some((day) => day.date === data.range.endDate));
assert(data.totals.totalTokens > 0);
assert(data.totals.totalCost > 0);

for (const requiredLauncherBehavior of [
  'last-success-date',
  'already completed for $today; skipping',
  'Recovered today\'s pending token counter commit',
  'printf \'%s\\n\' "$today" > "$SUCCESS_FILE"'
]) {
  assert(launcher.includes(requiredLauncherBehavior), `Missing launcher behavior: ${requiredLauncherBehavior}`);
}

assert(plist.includes('<key>RunAtLoad</key>\n  <true/>'));
assert(plist.includes('<key>StartInterval</key>\n  <integer>3600</integer>'));
assert(plist.includes('/scripts/update-codex-token-counter.sh'));

console.log(`Verified once-daily scheduling and README usage through ${data.range.endDate}: ${data.totals.totalTokens.toLocaleString('en-US')} tokens.`);

function phoenixDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
