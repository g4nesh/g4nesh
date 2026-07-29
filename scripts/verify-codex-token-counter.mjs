#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyProfileTokenVisuals } from './token-visual-contract.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [readme, dataText, counterSvg, trendSvg, launcher, syncLibrary, plist] = await Promise.all([
  read('README.md'),
  read('data/codex-token-usage.json'),
  read('assets/codex-token-counter.svg'),
  read('assets/codex-token-trend.svg'),
  read('scripts/update-codex-token-counter.sh'),
  read('scripts/token-counter-git-sync.zsh'),
  read('launchd/com.ganeshtalluri.github-profile-token-counter.plist')
]);
const data = JSON.parse(dataText);
const visualContract = verifyProfileTokenVisuals({ payload: data, readme, counterSvg, trendSvg });

assert(readme.includes('<!-- codex-token-counter:start -->'));
assert(readme.includes('<!-- codex-token-counter:end -->'));
assert(readme.includes(data.totals.totalTokens.toLocaleString('en-US')));
assert(readme.includes(data.totals.activeDays.toLocaleString('en-US')));
assert(readme.includes(data.totals.sessions.toLocaleString('en-US')));
assert(readme.includes(data.totals.favoriteModel?.name || 'unknown'));
assert(readme.includes('auto-refreshes once daily when this Mac is available'));

assert.equal(data.range.endDate, phoenixDate(new Date(data.generatedAt)));
assert(visualContract.lastDailyDate <= data.range.endDate);
assert(data.totals.totalTokens > 0);
assert(data.totals.totalCost > 0);

for (const requiredLauncherBehavior of [
  'last-success-date',
  'already completed for $today; repository sync complete',
  'Recovered today\'s pending token counter commit',
  'printf \'%s\\n\' "$today" > "$SUCCESS_FILE"',
  'source "$SCRIPT_DIR/token-counter-git-sync.zsh"'
]) {
  assert(launcher.includes(requiredLauncherBehavior), `Missing launcher behavior: ${requiredLauncherBehavior}`);
}

assert(
  launcher.indexOf('sync_main') <
    launcher.indexOf('already completed for $today; repository sync complete'),
  'Repository synchronization must happen before the daily-success skip.'
);
for (const requiredSyncBehavior of [
  '"$GIT" fetch origin main',
  '"$GIT" merge --ff-only origin/main',
  'rebase_main_onto_origin',
  'Initial push failed; fetching and rebasing once before retrying.'
]) {
  assert(syncLibrary.includes(requiredSyncBehavior), `Missing Git sync behavior: ${requiredSyncBehavior}`);
}

assert(plist.includes('<key>RunAtLoad</key>\n  <true/>'));
assert(plist.includes('<key>StartInterval</key>\n  <integer>3600</integer>'));
assert(plist.includes('/scripts/update-codex-token-counter.sh'));
assert(plist.includes('/Users/ganstlr/.local/share/codex-usage-tools/runtime/node/bin/node'));
assert(plist.includes('/Users/ganstlr/.local/share/codex-usage-tools/runtime/bin/fallback/git'));
assert(plist.includes('/Users/ganstlr/.local/share/codex-usage-tools/runtime/python/bin/python3'));
assert(plist.includes('<key>CODEX_USAGE_MACHINE_ID</key>\n    <string>ganstlr-macbook-2026</string>'));
assert(!plist.includes('/Users/ganeshtalluri/'));
assert(launcher.includes('TOOL_ROOT="${CODEX_USAGE_TOOL_ROOT:-$HOME/.local/share/codex-usage-tools}"'));

console.log(`Verified once-daily scheduling and synchronized README graph through ${visualContract.lastDailyDate}: ${data.totals.totalTokens.toLocaleString('en-US')} tokens.`);

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
