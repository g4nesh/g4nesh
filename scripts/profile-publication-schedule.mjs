#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dayMs = 86400000;
const timeZone = 'America/Phoenix';

export function context(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('Invalid schedule time.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: +parts.hour * 60 + +parts.minute };
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validate(state) {
  if (state?.version !== 1 || !/^[a-f0-9]{64}$/.test(state.seed) || !validDate(state.startDate) ||
      (state.lastClaimDate !== null && !validDate(state.lastClaimDate))) {
    throw new Error('Invalid publication schedule state; refusing to reset it automatically.');
  }
  return state;
}

function integer(state, key, min, max) {
  const value = createHash('sha256').update(`${state.seed}:${key}`).digest().readUInt32BE(0);
  return min + Math.floor(value / 4294967296 * (max - min + 1));
}

function dateAt(day) { return new Date(day * dayMs).toISOString().slice(0, 10); }
function dayOf(date) { return Date.parse(date) / dayMs; }

export function pauses(state, throughDate) {
  validate(state);
  const anchor = dayOf(state.startDate);
  const through = dayOf(throughDate) + 20;
  const long = [];
  let start = anchor + integer(state, 'long:first', 180, 365);
  for (let index = 0; start <= through; index++) {
    long.push({ start, end: start + 14, length: 14 });
    start += integer(state, `long:next:${index}`, 365, 395);
  }
  const short = [];
  start = anchor + integer(state, 'short:first', 25, 50);
  for (let index = 0; start <= through; index++) {
    // Keep brief pauses away from weekends so they do not join into 4-5 days.
    const weekday = new Date(start * dayMs).getUTCDay();
    const target = integer(state, `short:weekday:${index}`, 2, 3);
    start += (target - weekday + 7) % 7;
    const length = integer(state, `short:length:${index}`, 1, 2);
    const pause = { start, end: start + length, length };
    if (!long.some((other) => pause.start <= other.end + 2 && pause.end >= other.start - 2)) {
      short.push(pause);
    }
    start += length + integer(state, `short:next:${index}`, 25, 50);
  }
  return [...short, ...long].sort((a, b) => a.start - b.start);
}

export function decision(state, now) {
  validate(state);
  const { date, minute } = context(now);
  const day = dayOf(date);
  if (date < state.startDate) return { date, due: false, reason: 'Before schedule start' };
  if (state.lastClaimDate && date <= state.lastClaimDate) {
    return { date, due: false, reason: 'Already attempted this date (or clock moved backward)' };
  }
  const pause = pauses(state, date).find((item) => day >= item.start && day < item.end);
  if (pause) return { date, due: false, reason: `${pause.length}-day pause until ${dateAt(pause.end)}` };
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    const saturday = dateAt(day - (weekday === 0 ? 1 : 0));
    if (integer(state, `weekend:enabled:${saturday}`, 0, 99) >= 15) {
      return { date, due: false, reason: 'Quiet weekend (85% of weekends)' };
    }
    const chosen = integer(state, `weekend:${saturday}`, 0, 1) === 0 ? 6 : 0;
    if (weekday !== chosen) return { date, due: false, reason: 'Other day selected for this weekend' };
  }
  const windows = [[10 * 60, 13 * 60], [14 * 60, 18 * 60], [19 * 60, 21 * 60]];
  const window = windows[integer(state, `window:${date}`, 0, windows.length - 1)];
  const dueMinute = integer(state, `minute:${date}`, ...window);
  return { date, due: minute >= dueMinute && minute < 23 * 60, dueMinute, reason: `Scheduled after ${String(Math.floor(dueMinute / 60)).padStart(2, '0')}:${String(dueMinute % 60).padStart(2, '0')} ${timeZone}` };
}

function save(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

export function run(args, now = new Date()) {
  const [command, file] = args;
  if (!['--claim', '--initialize', '--preview'].includes(command) || !file) {
    throw new Error('Usage: profile-publication-schedule.mjs --claim|--initialize|--preview STATE_FILE');
  }
  let state;
  if (existsSync(file)) {
    state = validate(JSON.parse(readFileSync(file, 'utf8')));
  } else {
    if (command === '--preview') throw new Error('Initialize the schedule before previewing.');
    const marker = path.join(path.dirname(file), 'last-success-date');
    const lastSuccess = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
    if (lastSuccess !== null && !validDate(lastSuccess)) throw new Error('Invalid prior success marker.');
    state = { version: 1, seed: randomBytes(32).toString('hex'), startDate: context(now).date, lastClaimDate: lastSuccess };
    save(file, validate(state));
  }
  if (command === '--initialize') {
    console.log(`Publication schedule initialized from ${state.startDate}; no update executed.`);
    return 0;
  }
  if (command === '--preview') {
    const start = dayOf(context(now).date);
    for (let offset = 0; offset < 366; offset++) {
      const date = dateAt(start + offset);
      console.log(JSON.stringify(decision(state, new Date(`${date}T22:59:00-07:00`))));
    }
    return 0;
  }
  const result = decision(state, now);
  console.log(`Profile publication: ${result.date}: ${result.reason}.`);
  if (!result.due) return 3;
  // Reserve before any Git operation. A crash/failure consumes today's attempt;
  // the next eligible date recovers a pending commit without creating another.
  state.lastClaimDate = result.date;
  save(file, state);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
