import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

export function resolveCodexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  return ['/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex'].find(existsSync) || 'codex';
}

// Uses Codex's existing login; never reads or exports authentication tokens.
export function readAccountUsage({ binary = resolveCodexBinary(), timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Codex account usage timed out; existing public data was not replaced.')), timeoutMs);
    child.on('error', () => finish(new Error(`Cannot start Codex at ${binary}. Set CODEX_BIN to a current Codex executable.`)));
    child.on('exit', () => finish(new Error('Codex exited before returning account usage.')));
    child.stdin.on('error', () => finish(new Error('Codex app-server input closed unexpectedly.')));
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new Error(`Codex ${message.id === 1 ? 'initialization' : 'account/usage/read'} failed (code ${message.error.code}). Update Codex and sign in with your ChatGPT account.`));
      } else if (message.id === 1) {
        send({ method: 'initialized' });
        send({ method: 'account/usage/read', id: 2 });
      } else {
        finish(null, message.result);
      }
    });
    send({ method: 'initialize', id: 1, params: {
      clientInfo: { name: 'github_profile_token_counter', version: '2.0.0' },
      capabilities: { experimentalApi: true }
    } });
  });
}

function tokenCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid or unavailable ${name}; retaining existing public data.`);
  return value;
}

export function buildAccountPayload(usage, pricing, generatedAt = new Date().toISOString()) {
  const totalTokens = tokenCount(usage?.summary?.lifetimeTokens, 'lifetimeTokens');
  const rate = pricing?.usdPerMillionTokens;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new Error('Average token price must be a positive finite number.');
  const rawDays = usage.dailyUsageBuckets;
  if (rawDays != null && !Array.isArray(rawDays)) throw new Error('Invalid daily usage buckets.');
  const dates = new Set();
  const daily = (rawDays || []).map(({ startDate, tokens }) => {
    if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate || dates.has(startDate)) {
      throw new Error('Invalid or duplicate account usage date.');
    }
    dates.add(startDate);
    const totalTokens = tokenCount(tokens, `tokens for ${startDate}`);
    return { date: startDate, totalTokens, totalCost: totalTokens / 1e6 * rate };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const dailyTokens = tokenCount(daily.reduce((sum, day) => sum + day.totalTokens, 0), 'daily bucket total');
  const summary = { lifetimeTokens: totalTokens };
  for (const key of ['peakDailyTokens', 'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays']) {
    summary[key] = usage.summary[key] == null ? null : tokenCount(usage.summary[key], key);
  }
  return {
    generatedAt,
    source: 'OpenAI Codex account/usage/read',
    scope: 'account-lifetime',
    pricing: { ...pricing, type: 'estimated-api-equivalent', formula: 'tokens / 1,000,000 × usdPerMillionTokens' },
    range: { startDate: daily[0]?.date || null, endDate: daily.at(-1)?.date || null },
    totals: { totalTokens, totalCost: totalTokens / 1e6 * rate },
    summary,
    dailyCoverage: {
      available: rawDays != null,
      totalTokens: dailyTokens,
      lifetimeMinusDailyTokens: totalTokens - dailyTokens,
      note: 'Daily buckets are the history returned by OpenAI and can differ from the lifetime counter. No missing tokens are assigned to invented dates.'
    },
    daily
  };
}
