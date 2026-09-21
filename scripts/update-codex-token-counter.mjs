#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAccountUsage, buildAccountPayload } from './codex-account-usage.mjs';
import { verifyProfileTokenVisuals } from './token-visual-contract.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const readmePath = path.join(repoRoot, 'README.md');
const dataPath = path.join(repoRoot, 'data', 'codex-token-usage.json');
const svgPath = path.join(repoRoot, 'assets', 'codex-token-counter.svg');
const trendSvgPath = path.join(repoRoot, 'assets', 'codex-token-trend.svg');
const asciiGifPath = path.join(repoRoot, 'assets', 'g4nesh-ascii.gif');
const asciiSourceGifPath = path.join(repoRoot, 'assets', 'g4nesh-ascii-source.gif');
const asciiRecolorScriptPath = path.join(scriptDir, 'recolor-ascii-gif.py');
const timezone = process.env.TZ || 'America/Phoenix';
const endDate = currentDate(timezone);
const noCommit = process.argv.includes('--no-commit');
const noPush = process.argv.includes('--no-push');
const pricing = JSON.parse(readFileSync(path.join(repoRoot, 'data', 'token-pricing.json'), 'utf8'));
const usage = await readAccountUsage();
const payload = { ...buildAccountPayload(usage, pricing), theme: dailyTheme(endDate) };

mkdirSync(path.dirname(dataPath), { recursive: true });
mkdirSync(path.dirname(svgPath), { recursive: true });
const generated = {
  data: `${JSON.stringify(payload, null, 2)}\n`,
  counterSvg: `${renderSvg(payload, payload.theme)}\n`,
  trendSvg: `${renderTrendSvg(payload, payload.theme)}\n`,
  readme: updateReadme(readFileSync(readmePath, 'utf8'), payload)
};
const visualContract = verifyProfileTokenVisuals({
  payload,
  readme: generated.readme,
  counterSvg: generated.counterSvg,
  trendSvg: generated.trendSvg
});

recolorAsciiGif(payload.theme);
writeFileSync(dataPath, generated.data);
writeFileSync(svgPath, generated.counterSvg);
writeFileSync(trendSvgPath, generated.trendSvg);
writeFileSync(readmePath, generated.readme);

console.log(`Generated README counter, ${path.relative(repoRoot, dataPath)}, ${path.relative(repoRoot, svgPath)}, ${path.relative(repoRoot, trendSvgPath)}, and ${path.relative(repoRoot, asciiGifPath)}`);
console.log(
  `Verified README token graph through ${visualContract.lastDailyDate} ` +
  `(${visualContract.days} days).`
);
console.log(`Source: ${payload.source}`);
console.log(`Range: ${payload.range.startDate} to ${payload.range.endDate}`);
console.log(`Total tokens: ${payload.totals.totalTokens.toLocaleString('en-US')}`);
console.log(`Estimated cost: $${payload.totals.totalCost.toFixed(2)}`);
console.log(`Daily theme: ${payload.theme.name} (${payload.theme.hex})`);

if (!noCommit) {
  commitAndPush();
}

function renderSvg(payload, theme) {
  const width = 720;
  const height = 190;
  const updated = formatTimestamp(payload.generatedAt, timezone);
  const total = compact(payload.totals.totalTokens);
  const exactTotal = integer(payload.totals.totalTokens);
  const costValue = money(payload.totals.totalCost);
  const rate = money(payload.pricing.usdPerMillionTokens);
  const range = 'OpenAI account lifetime';
  const active = payload.summary.currentStreakDays == null ? 'n/a' : integer(payload.summary.currentStreakDays);
  const peak = payload.summary.peakDailyTokens == null ? 'n/a' : compact(payload.summary.peakDailyTokens);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Tokenmaxxing stats — OpenAI account lifetime</title>
  <desc id="desc">${xml(`${exactTotal} Codex tokens tracked from ${range}. Updated ${updated}.`)}</desc>
  <defs>
    <linearGradient id="accent" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${xml(theme.light)}"/>
      <stop offset="100%" stop-color="${xml(theme.hex)}"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-10%" width="110%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="0" y="0" width="8" height="${height}" rx="4" fill="url(#accent)"/>
  <text x="32" y="40" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="18" font-weight="700">Tokenmaxxing stats</text>
  <text x="32" y="66" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">OpenAI account lifetime tokens across devices; refreshed periodically.</text>
  <text x="32" y="120" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="44" font-weight="800">${xml(total)}</text>
  <text x="32" y="144" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">${xml(exactTotal)} total tokens</text>
  <g transform="translate(310 96)">
    ${metric('Streak days', active, 0)}
    ${metric('Peak day', peak, 120)}
    ${metric('Est. cost', costValue, 240)}
  </g>
  <text x="310" y="156" fill="#374151" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13">Estimate: ${xml(rate)} / 1M tokens (historical average)</text>
  <text x="310" y="176" fill="#9ca3af" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="12">Updated ${xml(updated)}</text>
</svg>`;
}

function metric(label, value, x) {
  return `<g transform="translate(${x} 0)">
      <text x="0" y="0" fill="#111827" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="22" font-weight="750">${xml(value)}</text>
      <text x="0" y="22" fill="#6b7280" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="12">${xml(label)}</text>
    </g>`;
}

function renderTrendSvg(payload, theme) {
  const width = 380;
  const height = 226;
  const pad = { top: 34, right: 18, bottom: 36, left: 34 };
  const days = payload.daily;
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
  const total = compact(runningTotal);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Codex tokens over time</title>
  <desc id="desc">${xml(`Line graph of returned daily Codex tokens from ${start} to ${end}, ending at ${total}.`)}</desc>
  <defs>
    <linearGradient id="line" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${xml(theme.dark)}"/>
      <stop offset=".55" stop-color="${xml(theme.light)}"/>
      <stop offset="1" stop-color="${xml(theme.hex)}"/>
    </linearGradient>
    <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${xml(theme.hex)}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${xml(theme.hex)}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="plot">
      <rect x="${pad.left}" y="${pad.top}" width="${plotWidth}" height="${plotHeight}"/>
    </clipPath>
  </defs>
  <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="8" fill="none" stroke="#30363d"/>
  <text x="${pad.left}" y="22" fill="#e6edf3" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="13" font-weight="650">returned daily history</text>
  <text x="${width - pad.right}" y="22" text-anchor="end" fill="#8b949e" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,Arial,sans-serif" font-size="11">${xml(total)}</text>
  <g>
    ${grid}
    <line x1="${pad.left}" y1="${baseY}" x2="${width - pad.right}" y2="${baseY}" stroke="#30363d" stroke-width="1"/>
  </g>
  <g clip-path="url(#plot)">
${days.length === 0 ? '    <text x="190" y="116" text-anchor="middle" fill="#8b949e" font-size="12">Daily history unavailable</text>\n' : ''}    ${area ? `<path d="${area}" fill="url(#area)"/>` : ''}
    ${line ? `<path d="${line}" fill="none" stroke="url(#line)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${points[0] ? `<circle cx="${points[0].x.toFixed(1)}" cy="${points[0].y.toFixed(1)}" r="2.5" fill="${xml(theme.dark)}"/>` : ''}
    ${points.at(-1) ? `<circle cx="${points.at(-1).x.toFixed(1)}" cy="${points.at(-1).y.toFixed(1)}" r="2.8" fill="${xml(theme.light)}"/>` : ''}
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
  const range = payload.daily.length ? `${displayDate(payload.range.startDate)} -> ${displayDate(payload.range.endDate)}` : 'unavailable';
  const rows = [
    ['lifetime tokens', `${integer(payload.totals.totalTokens)} (${compact(payload.totals.totalTokens)})`],
    ['est. API cost', money(payload.totals.totalCost)],
    ['avg. cost / 1M', money(payload.pricing.usdPerMillionTokens)],
    ['current streak', payload.summary.currentStreakDays == null ? 'unavailable' : `${integer(payload.summary.currentStreakDays)} days`],
    ['daily history', range],
    ['history tokens', integer(payload.dailyCoverage.totalTokens)],
    ['updated', updated]
  ];
  const body = rows
    .map(([label, value], index) => {
      const cells = [
        `      <td${index === 0 ? ' width="18%"' : ''}>${html(label)}</td>`,
        `      <td${index === 0 ? ' width="36%"' : ''}>${html(value)}</td>`
      ];
      if (index === 0) {
        cells.push(`      <td rowspan="${rows.length}" width="46%" valign="middle" align="right"><img src="./assets/codex-token-trend.svg" alt="Codex tokens over time" width="500"></td>`);
      }
      return `    <tr>\n${cells.join('\n')}\n    </tr>`;
    })
    .join('\n');

  return `#### my codex usage across devices

<table width="100%">
  <thead>
    <tr>
      <th align="left" width="18%">stat</th>
      <th align="left" width="36%">value</th>
      <th align="right" width="46%">tokens over time</th>
    </tr>
  </thead>
  <tbody>
${body}
  </tbody>
</table>

<sub>OpenAI account lifetime counter; updates periodically when this Mac is available. Cost is an estimate using a fixed historical average, not a bill. The graph covers only returned daily history (${integer(payload.dailyCoverage.totalTokens)} tokens), which may differ from lifetime usage. <a href="./launchd/README.md#account-tokens-and-estimated-cost">Method and pricing</a>.</sub>`;
}

function commitAndPush() {
  const paths = ['README.md', 'assets/codex-token-counter.svg', 'assets/codex-token-trend.svg', 'assets/g4nesh-ascii.gif', 'assets/g4nesh-ascii-source.gif', 'data/codex-token-usage.json', 'scripts/recolor-ascii-gif.py', 'scripts/update-codex-token-counter.mjs', 'launchd/com.ganeshtalluri.github-profile-token-counter.plist'];
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

function recolorAsciiGif(theme) {
  if (!existsSync(asciiSourceGifPath)) {
    throw new Error(`Missing ASCII source GIF: ${asciiSourceGifPath}`);
  }
  if (!existsSync(asciiRecolorScriptPath)) {
    throw new Error(`Missing ASCII recolor script: ${asciiRecolorScriptPath}`);
  }

  const python = resolvePythonWithPillow();
  execFileSync(python, [asciiRecolorScriptPath, asciiSourceGifPath, asciiGifPath, theme.hex], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

function resolvePythonWithPillow() {
  const candidates = [
    process.env.PYTHON_WITH_PIL,
    process.env.PYTHON,
    path.join(os.homedir(), '.local', 'share', 'codex-usage-tools', 'runtime', 'python', 'bin', 'python3'),
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3'
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import PIL'], {
      cwd: repoRoot,
      stdio: 'ignore'
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error('Could not find a Python 3 executable with Pillow installed. Set PYTHON_WITH_PIL to one before running the updater.');
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

function dailyTheme(date) {
  const ranges = [
    { start: 25, end: 64, name: 'amber' },
    { start: 78, end: 166, name: 'green' },
    { start: 178, end: 254, name: 'blue' }
  ];
  const seed = hashText(date);
  const totalHueSlots = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
  let slot = seed % totalHueSlots;
  let hue = ranges[0].start;
  let family = ranges[0].name;

  for (const range of ranges) {
    const size = range.end - range.start + 1;
    if (slot < size) {
      hue = range.start + slot;
      family = range.name;
      break;
    }
    slot -= size;
  }

  const saturation = 76 + ((seed >>> 8) % 14);
  const lightness = 52 + ((seed >>> 16) % 9);

  return {
    date,
    name: `${family} ${hue}`,
    hue,
    saturation,
    lightness,
    hex: hslToHex(hue, saturation, lightness),
    light: hslToHex(hue, Math.max(62, saturation - 6), Math.min(82, lightness + 18)),
    dark: hslToHex(hue, Math.min(92, saturation + 8), Math.max(28, lightness - 18))
  };
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
    [c, 0, x];
  const m = l - c / 2;
  return `#${[r1, g1, b1]
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
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
