import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyProfileTokenVisuals({
  payload,
  readme,
  counterSvg,
  trendSvg
}) {
  ensure(payload && typeof payload === 'object', 'Token usage payload is missing.');
  ensure(Number.isFinite(Date.parse(payload.generatedAt)), 'Token usage generatedAt is invalid.');
  ensure(Array.isArray(payload.daily) && payload.daily.length > 0, 'Token usage has no trend data.');

  const dates = payload.daily.map((day) => day.date);
  ensure(dates.every(Boolean), 'Every trend row must have a date.');
  ensure(new Set(dates).size === dates.length, 'Trend rows contain duplicate dates.');
  ensure(
    dates.every((date, index) => index === 0 || dates[index - 1] < date),
    'Trend rows must be strictly chronological.'
  );
  ensure(
    payload.daily.every((day) => Number.isFinite(day.totalTokens) && day.totalTokens >= 0),
    'Trend rows must contain non-negative token totals.'
  );

  const dailyTotal = payload.daily.reduce((sum, day) => sum + day.totalTokens, 0);
  ensure(
    dailyTotal === payload.totals?.totalTokens,
    `Trend total ${dailyTotal} does not match headline total ${payload.totals?.totalTokens}.`
  );

  const lastDailyDate = dates.at(-1);
  ensure(
    payload.range?.endDate && lastDailyDate <= payload.range.endDate,
    'Trend data extends beyond the published range.'
  );

  const exactTotal = new Intl.NumberFormat('en-US').format(dailyTotal);
  const compactTotal = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(dailyTotal);
  const start = displayShortDate(dates[0]);
  const end = displayShortDate(lastDailyDate);

  ensure(
    readme.includes('src="./assets/codex-token-trend.svg"') &&
      readme.includes(exactTotal),
    'README does not reference the synchronized trend graph and total.'
  );
  ensure(
    trendSvg.includes('<title id="title">Codex tokens over time</title>') &&
      trendSvg.includes(`ending at ${compactTotal}.`) &&
      trendSvg.includes(`>${start}</text>`) &&
      trendSvg.includes(`>${end}</text>`),
    'Trend SVG does not match the generated range and cumulative total.'
  );
  ensure(
    [payload.theme?.hex, payload.theme?.light, payload.theme?.dark]
      .every((color) => color && trendSvg.includes(color)),
    'Trend SVG does not use the generated daily theme.'
  );
  ensure(
    counterSvg.includes(exactTotal) && counterSvg.includes(payload.theme?.hex),
    'Counter SVG does not match the synchronized total and theme.'
  );

  return {
    days: payload.daily.length,
    lastDailyDate,
    totalTokens: dailyTotal
  };
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(`Token visual contract failed: ${message}`);
  }
}

function displayShortDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  const repoRoot = path.resolve(path.dirname(process.argv[1]), '..');
  const payload = JSON.parse(readFileSync(path.join(repoRoot, 'data', 'codex-token-usage.json'), 'utf8'));
  const result = verifyProfileTokenVisuals({
    payload,
    readme: readFileSync(path.join(repoRoot, 'README.md'), 'utf8'),
    counterSvg: readFileSync(path.join(repoRoot, 'assets', 'codex-token-counter.svg'), 'utf8'),
    trendSvg: readFileSync(path.join(repoRoot, 'assets', 'codex-token-trend.svg'), 'utf8')
  });

  console.log(
    `Verified README token graph through ${result.lastDailyDate}: ` +
      `${result.days} days and ${result.totalTokens.toLocaleString('en-US')} tokens.`
  );
}
