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
const trendSvgPath = path.join(repoRoot, 'assets', 'codex-token-trend.svg');
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
writeFileSync(trendSvgPath, `${renderTrendSvg(payload)}\n`);
writeFileSync(readmePath, updateReadme(readFileSync(readmePath, 'utf8'), payload));

console.log(`Generated README counter, ${path.relative(repoRoot, dataPath)}, ${path.relative(repoRoot, svgPath)}, and ${path.relative(repoRoot, trendSvgPath)}`);
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
  <title id="title">Tokenmaxxing stats since January 1, 2026</title>
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
  <text x="32" y="40" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="18" font-weight="700">Tokenmaxxing stats</text>
  <text x="32" y="66" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">Tracked with ccusage from ${xml(range)}; refreshed every 24 hours.</text>
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

function renderTrendSvg(payload) {
  const width = 380;
  const height = 226;
  const pad = { top: 34, right: 18, bottom: 36, left: 34 };
  const days = payload.daily.filter((day) => day.totalTokens > 0);
  let runningTotal = 0;
  const series = days.map((day) => {
    runningTotal += day.totalTokens;
    return { date: day.date, totalTokens: runningTotal };
  });
  const max = Math.max(1, ...series.map((day) => day.totalTokens));
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const baseY = pad.top + plotHeight;
  const points = series.map((day, index) => {
    const x = pad.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
    const y = pad.top + plotHeight - (day.totalTokens / max) * plotHeight;
    return { x, y, day };
  });
  const line = smoothPath(points);
  const area = points.length > 1
    ? `${line} L ${points.at(-1).x.toFixed(1)} ${baseY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baseY.toFixed(1)} Z`
    : '';
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((step) => {
      const y = pad.top + plotHeight * step;
      return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#21262d" stroke-width="1"/>`;
    })
    .join('\n    ');
  const start = days[0]?.date ? displayShortDate(days[0].date) : 'n/a';
  const end = days.at(-1)?.date ? displayShortDate(days.at(-1).date) : 'n/a';
  const total = compact(max);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Codex tokens over time</title>
  <desc id="desc">${xml(`Line graph of cumulative Codex tokens from ${start} to ${end}, ending at ${total}.`)}</desc>
  <defs>
    <linearGradient id="line" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset=".55" stop-color="#c084fc"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#a855f7" stop-opacity=".28"/>
      <stop offset="1" stop-color="#a855f7" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="plot">
      <rect x="${pad.left}" y="${pad.top}" width="${plotWidth}" height="${plotHeight}"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="8" fill="none" stroke="#30363d"/>
  <text x="${pad.left}" y="22" fill="#e6edf3" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13" font-weight="650">tokens over time</text>
  <text x="${width - pad.right}" y="22" text-anchor="end" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="11">${xml(total)}</text>
  <g>
    ${grid}
    <line x1="${pad.left}" y1="${baseY}" x2="${width - pad.right}" y2="${baseY}" stroke="#30363d" stroke-width="1"/>
  </g>
  <g clip-path="url(#plot)">
    ${area ? `<path d="${area}" fill="url(#area)"/>` : ''}
    ${line ? `<path d="${line}" fill="none" stroke="url(#line)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${points[0] ? `<circle cx="${points[0].x.toFixed(1)}" cy="${points[0].y.toFixed(1)}" r="2.5" fill="#8b5cf6"/>` : ''}
    ${points.at(-1) ? `<circle cx="${points.at(-1).x.toFixed(1)}" cy="${points.at(-1).y.toFixed(1)}" r="2.8" fill="#e9d5ff"/>` : ''}
  </g>
  <text x="${pad.left}" y="${height - 14}" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="11">${xml(start)}</text>
  <text x="${width - pad.right}" y="${height - 14}" text-anchor="end" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="11">${xml(end)}</text>
</svg>`;
}

function smoothPath(points) {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let pathData = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] || points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    pathData += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return pathData;
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
  const body = rows
    .map(([label, value], index) => `    <tr>
      <td>${html(label)}</td>
      <td>${html(value)}</td>
      ${index === 0 ? `<td rowspan="${rows.length}" valign="middle" align="center"><img src="./assets/codex-token-trend.svg" alt="Codex tokens over time" width="360"></td>` : ''}
    </tr>`)
    .join('\n');

  return `#### my yearly codex usage

<table>
  <thead>
    <tr>
      <th align="left">stat</th>
      <th align="left">value</th>
      <th align="left">tokens over time</th>
    </tr>
  </thead>
  <tbody>
${body}
  </tbody>
</table>

<sub>auto-refreshes every 24h via ccusage; graph updates with the table</sub>`;
}

function commitAndPush() {
  const paths = ['README.md', 'assets/codex-token-counter.svg', 'assets/codex-token-trend.svg', 'data/codex-token-usage.json', 'scripts/update-codex-token-counter.mjs', 'launchd/com.ganeshtalluri.github-profile-token-counter.plist'];
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

function displayShortDate(value) {
  if (!value) {
    return 'n/a';
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
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

function html(value) {
  return xml(value);
}

function md(value) {
  return String(value).replaceAll('|', '\\|');
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
