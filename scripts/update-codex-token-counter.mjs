#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const readmePath = path.join(repoRoot, 'README.md');
const dataPath = path.join(repoRoot, 'data', 'codex-token-usage.json');
const svgPath = path.join(repoRoot, 'assets', 'codex-token-counter.svg');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const startDate = process.env.TOKEN_COUNTER_START_DATE || '2026-01-01';
const timezone = process.env.TZ || 'America/Phoenix';
const endDate = process.env.TOKEN_COUNTER_END_DATE || currentDate(timezone);
const noCommit = process.argv.includes('--no-commit');
const noPush = process.argv.includes('--no-push');

const ccusage = resolveCcusageCommand();
const dailyRaw = runCcusage('daily');
const sessionRaw = runCcusage('session');
const payload = buildPayload(dailyRaw, sessionRaw);

mkdirSync(path.dirname(dataPath), { recursive: true });
mkdirSync(path.dirname(svgPath), { recursive: true });
writeFileSync(dataPath, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(svgPath, `${renderSvg(payload)}\n`);
writeFileSync(readmePath, updateReadme(readFileSync(readmePath, 'utf8'), payload));

console.log(`Generated README counter, ${path.relative(repoRoot, dataPath)}, and ${path.relative(repoRoot, svgPath)}`);
console.log(`Range: ${payload.range.startDate} to ${payload.range.endDate}`);
console.log(`Total tokens: ${payload.totals.totalTokens.toLocaleString('en-US')}`);
console.log(`Estimated cost: $${payload.totals.totalCost.toFixed(2)}`);

if (!noCommit) {
  commitAndPush();
}

function runCcusage(report) {
  const stdout = execFileSync(ccusage.command, [...ccusage.args, 'codex', report, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    },
    maxBuffer: 128 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

function buildPayload(dailyRaw, sessionRaw) {
  const daily = (dailyRaw.daily || [])
    .map(normalizeDay)
    .filter((day) => day.date >= startDate && day.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sessions = (sessionRaw.sessions || sessionRaw.session || [])
    .map(normalizeSession)
    .filter((session) => session.date >= startDate && session.date <= endDate)
    .sort((a, b) => String(a.lastActivity || a.date).localeCompare(String(b.lastActivity || b.date)));

  const models = modelTotals(daily);
  const totals = {
    totalTokens: daily.reduce((sum, day) => sum + day.totalTokens, 0),
    totalCost: daily.reduce((sum, day) => sum + day.totalCost, 0),
    inputTokens: daily.reduce((sum, day) => sum + day.inputTokens, 0),
    outputTokens: daily.reduce((sum, day) => sum + day.outputTokens, 0),
    cacheReadTokens: daily.reduce((sum, day) => sum + day.cacheReadTokens, 0),
    cacheCreationTokens: daily.reduce((sum, day) => sum + day.cacheCreationTokens, 0),
    reasoningOutputTokens: daily.reduce((sum, day) => sum + day.reasoningOutputTokens, 0),
    activeDays: daily.filter((day) => day.totalTokens > 0).length,
    sessions: sessions.length,
    favoriteModel: models[0] || null
  };

  return {
    generatedAt: new Date().toISOString(),
    source: 'ccusage codex daily/session --json',
    scope: 'codex usage since 2026-01-01',
    range: {
      startDate,
      endDate,
      firstTrackedDay: daily[0]?.date || null,
      lastTrackedDay: daily.at(-1)?.date || null
    },
    totals,
    models,
    daily,
    sessions
  };
}

function normalizeDay(row) {
  const breakdowns = modelBreakdowns(row);
  return {
    date: row.date || row.period,
    totalTokens: tokenTotal(row),
    totalCost: cost(row),
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    cacheReadTokens: Number(row.cacheReadTokens || 0),
    cacheCreationTokens: Number(row.cacheCreationTokens || 0),
    reasoningOutputTokens: Number(row.reasoningOutputTokens || 0),
    modelsUsed: row.modelsUsed || Object.keys(row.models || {}),
    topModel: topModel(breakdowns, Object.keys(row.models || {})).name,
    modelBreakdowns: breakdowns
  };
}

function normalizeSession(row, index) {
  const breakdowns = modelBreakdowns(row);
  const date = dateFromPeriod(row.period || row.sessionId || row.directory, row.lastActivity || row.metadata?.lastActivity || row.startTime);
  return {
    index: index + 1,
    date,
    lastActivity: row.lastActivity || row.metadata?.lastActivity || row.startTime || null,
    totalTokens: tokenTotal(row),
    totalCost: cost(row),
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    cacheReadTokens: Number(row.cacheReadTokens || 0),
    cacheCreationTokens: Number(row.cacheCreationTokens || 0),
    reasoningOutputTokens: Number(row.reasoningOutputTokens || 0),
    modelsUsed: row.modelsUsed || Object.keys(row.models || {}),
    topModel: topModel(breakdowns, Object.keys(row.models || {})).name,
    agent: row.agent || 'codex'
  };
}

function modelTotals(days) {
  const modelMap = new Map();

  for (const day of days) {
    for (const breakdown of day.modelBreakdowns || []) {
      const name = breakdown.modelName || 'unknown';
      const previous = modelMap.get(name) || {
        name,
        totalTokens: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 0
      };

      previous.inputTokens += Number(breakdown.inputTokens || 0);
      previous.outputTokens += Number(breakdown.outputTokens || 0);
      previous.cacheReadTokens += Number(breakdown.cacheReadTokens || 0);
      previous.cacheCreationTokens += Number(breakdown.cacheCreationTokens || 0);
      previous.reasoningOutputTokens += Number(breakdown.reasoningOutputTokens || 0);
      previous.totalCost += Number(breakdown.cost || 0);
      previous.totalTokens += tokenTotal(breakdown);
      modelMap.set(name, previous);
    }
  }

  return [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function renderSvg(payload) {
  const width = 720;
  const height = 190;
  const updated = formatTimestamp(payload.generatedAt, timezone);
  const total = compact(payload.totals.totalTokens);
  const exactTotal = integer(payload.totals.totalTokens);
  const costValue = money(payload.totals.totalCost);
  const favorite = payload.totals.favoriteModel?.name || 'none yet';
  const range = `${displayDate(payload.range.startDate)} - ${displayDate(payload.range.endDate)}`;
  const active = integer(payload.totals.activeDays);
  const sessions = integer(payload.totals.sessions);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Codex token usage since January 1, 2026</title>
  <desc id="desc">${xml(`${exactTotal} Codex tokens tracked from ${range}. Updated ${updated}.`)}</desc>
  <defs>
    <linearGradient id="accent" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#2f80ed"/>
      <stop offset="100%" stop-color="#27ae60"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-10%" width="110%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="0" y="0" width="8" height="${height}" rx="4" fill="url(#accent)"/>
  <text x="32" y="40" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="18" font-weight="700">Codex token counter</text>
  <text x="32" y="66" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">Tracked with ccusage from ${xml(range)}; refreshed every 4 hours.</text>
  <text x="32" y="120" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="44" font-weight="800">${xml(total)}</text>
  <text x="32" y="144" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">${xml(exactTotal)} total tokens</text>
  <g transform="translate(310 96)">
    ${metric('Active days', active, 0)}
    ${metric('Sessions', sessions, 120)}
    ${metric('Est. cost', costValue, 240)}
  </g>
  <text x="310" y="156" fill="#374151" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">Top model: ${xml(favorite)}</text>
  <text x="310" y="176" fill="#9ca3af" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="12">Updated ${xml(updated)}</text>
</svg>`;
}

function metric(label, value, x) {
  return `<g transform="translate(${x} 0)">
      <text x="0" y="0" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="22" font-weight="750">${xml(value)}</text>
      <text x="0" y="22" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="12">${xml(label)}</text>
    </g>`;
}

function updateReadme(current, payload) {
  const block = renderReadmeCounter(payload);
  const start = '<!-- codex-token-counter:start -->';
  const end = '<!-- codex-token-counter:end -->';
  const blockWithMarkers = `${start}\n${block}\n${end}`;
  const markerPattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);

  if (markerPattern.test(current)) {
    return `${current.replace(markerPattern, blockWithMarkers).trimEnd()}\n`;
  }

  const oldImagePattern = /\n*<p>\s*\n\s*<img src="\.\/assets\/codex-token-counter\.svg"[^>]*>\s*\n<\/p>\s*/;
  if (oldImagePattern.test(current)) {
    return `${current.replace(oldImagePattern, `\n\n${blockWithMarkers}\n`).trimEnd()}\n`;
  }

  return `${current.trimEnd()}\n\n${blockWithMarkers}\n`;
}

function renderReadmeCounter(payload) {
  const updated = formatTimestamp(payload.generatedAt, timezone);
  const range = `${displayDate(payload.range.startDate)} -> ${displayDate(payload.range.endDate)}`;
  const favorite = payload.totals.favoriteModel?.name || 'unknown';
  const rows = [
    ['tokens', `${integer(payload.totals.totalTokens)} (${compact(payload.totals.totalTokens)})`],
    ['cost', money(payload.totals.totalCost)],
    ['active days', integer(payload.totals.activeDays)],
    ['sessions', integer(payload.totals.sessions)],
    ['top model', favorite],
    ['range', range],
    ['updated', updated]
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  const border = `+${'-'.repeat(labelWidth + 2)}+${'-'.repeat(valueWidth + 2)}+`;
  const body = rows
    .map(([label, value]) => `| ${label.padEnd(labelWidth)} | ${value.padEnd(valueWidth)} |`)
    .join('\n');

  return `\`\`\`text
codex usage
${border}
${body}
${border}
auto-refresh: every 4h via ccusage
\`\`\``;
}

function commitAndPush() {
  const paths = ['README.md', 'assets/codex-token-counter.svg', 'data/codex-token-usage.json', 'scripts/update-codex-token-counter.mjs', 'launchd/com.ganeshtalluri.github-profile-token-counter.plist'];
  git(['add', ...paths.filter((filePath) => existsSync(path.join(repoRoot, filePath)))]);

  if (!hasStagedChanges()) {
    console.log('No token counter changes to commit.');
    return;
  }

  git(['commit', '-m', 'Update Codex token counter']);

  if (!noPush) {
    const branch = gitOutput(['branch', '--show-current']).trim() || 'main';
    git(['push', 'origin', branch]);
  }
}

function hasStagedChanges() {
  return spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: repoRoot,
    stdio: 'ignore'
  }).status === 1;
}

function git(args) {
  execFileSync('git', args, {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function modelBreakdowns(row) {
  if (Array.isArray(row.modelBreakdowns)) {
    return row.modelBreakdowns;
  }

  const entries = Object.entries(row.models || {});
  return entries.map(([modelName, usage]) => ({
    modelName,
    cost: usage.cost || usage.costUSD || (entries.length === 1 ? cost(row) : 0),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
    totalTokens: usage.totalTokens
  }));
}

function topModel(breakdowns = [], fallback = []) {
  let best = null;

  for (const breakdown of breakdowns) {
    const total = tokenTotal(breakdown);
    if (!best || total > best.tokens) {
      best = {
        name: breakdown.modelName || 'unknown',
        tokens: total
      };
    }
  }

  return best || { name: fallback[0] || 'unknown', tokens: 0 };
}

function tokenTotal(row) {
  return Number(row.totalTokens || 0);
}

function cost(row) {
  return Number(row.totalCost || row.costUSD || row.cost || 0);
}

function dateFromPeriod(period, lastActivity) {
  if (lastActivity) {
    return String(lastActivity).slice(0, 10);
  }

  const match = String(period || '').match(/(20\d{2})[/-](\d{2})[/-](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function currentDate(targetTimezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatTimestamp(value, targetTimezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
}

function displayDate(value) {
  if (!value) {
    return 'n/a';
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function integer(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function compact(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveCcusageCommand() {
  if (process.env.CCUSAGE_COMMAND) {
    return splitCommand(process.env.CCUSAGE_COMMAND);
  }

  const cachedCli = '/Users/ganeshtalluri/.npm/_npx/b8bc0fb451ae8722/node_modules/ccusage/dist/cli.js';
  if (existsSync(cachedCli)) {
    return {
      command: process.execPath,
      args: [cachedCli]
    };
  }

  return {
    command: 'npx',
    args: ['--yes', 'ccusage@latest']
  };
}

function splitCommand(commandText) {
  const parts = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of commandText.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  if (quote || parts.length === 0) {
    throw new Error('Invalid CCUSAGE_COMMAND.');
  }

  return {
    command: parts[0],
    args: parts.slice(1)
  };
}
