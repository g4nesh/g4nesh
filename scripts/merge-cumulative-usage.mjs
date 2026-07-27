const usageFields = [
  'totalTokens',
  'totalCost',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'reasoningOutputTokens'
];

export function mergeCumulativeUsage(previous, current, machineId) {
  validateMachineId(machineId);

  const hasBaseline = Boolean(previous?.totals && Array.isArray(previous?.daily));
  const baseline = hasBaseline ? previous : emptyPayload(current);
  const previousMachines = baseline.collection?.machines || {};
  const previousMachine = previousMachines[machineId] || null;
  const models = mergeModels(
    baseline.models,
    previousMachine?.models,
    current.models
  );
  const daily = mergeDaily(
    baseline.daily,
    previousMachine?.daily,
    current.daily
  );
  const sessions = mergeSessions(
    baseline.sessions,
    current.sessions,
    machineId
  );
  const totals = mergeUsageRecord(
    baseline.totals,
    previousMachine?.totals,
    current.totals
  );

  totals.sessions = sessions.length;
  totals.activeDays = daily.filter((day) => day.totalTokens > 0).length;
  totals.favoriteModel = models[0] || null;

  return {
    ...current,
    source: `${current.source}; cumulative machine snapshots`,
    scope: 'cumulative-multi-machine',
    range: mergeRange(baseline.range, current.range),
    totals,
    models,
    daily,
    sessions,
    collection: {
      mode: 'cumulative-machine-snapshots-v1',
      initializedAt: baseline.collection?.initializedAt || current.generatedAt,
      legacyBaselineGeneratedAt:
        baseline.collection?.legacyBaselineGeneratedAt ||
        (hasBaseline ? previous.generatedAt || null : null),
      machines: {
        ...previousMachines,
        [machineId]: snapshot(current)
      }
    }
  };
}

function emptyPayload(current) {
  return {
    generatedAt: current.generatedAt,
    totals: {},
    models: [],
    daily: [],
    sessions: [],
    range: current.range,
    collection: null
  };
}

function snapshot(payload) {
  return {
    generatedAt: payload.generatedAt,
    totals: numericUsageRecord(payload.totals),
    models: payload.models || [],
    daily: payload.daily || [],
    sessionCount: payload.sessions?.length || 0
  };
}

function mergeUsageRecord(base = {}, remove = {}, add = {}) {
  const merged = {};
  for (const field of usageFields) {
    merged[field] = adjustedNumber(base[field], remove?.[field], add?.[field]);
  }
  return merged;
}

function numericUsageRecord(record = {}) {
  return Object.fromEntries(
    usageFields.map((field) => [field, Number(record[field] || 0)])
  );
}

function mergeModels(base = [], remove = [], add = []) {
  const models = new Map();
  applyModelRows(models, base, 1);
  applyModelRows(models, remove, -1);
  applyModelRows(models, add, 1);
  return [...models.values()]
    .filter(hasUsage)
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function applyModelRows(target, rows = [], direction) {
  for (const row of rows || []) {
    const name = row.modelName || row.name || 'unknown';
    const current = target.get(name) || { name };
    for (const field of usageFields) {
      const rowValue = field === 'totalCost'
        ? row.totalCost ?? row.cost ?? row.costUSD
        : row[field];
      current[field] = normalizeNumber(
        Number(current[field] || 0) + direction * Number(rowValue || 0)
      );
    }
    target.set(name, current);
  }
}

function mergeDaily(base = [], remove = [], add = []) {
  const days = new Map();
  applyDailyRows(days, base, 1);
  applyDailyRows(days, remove, -1);
  applyDailyRows(days, add, 1);

  return [...days.values()]
    .filter((day) => day.date && hasUsage(day))
    .map(finalizeDay)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function applyDailyRows(target, rows = [], direction) {
  for (const row of rows || []) {
    const date = row.date || row.period;
    if (!date) {
      continue;
    }

    const current = target.get(date) || {
      date,
      modelsUsed: [],
      topModel: null,
      modelBreakdowns: []
    };
    for (const field of usageFields) {
      current[field] = normalizeNumber(
        Number(current[field] || 0) + direction * Number(row[field] || 0)
      );
    }
    if (direction > 0) {
      current.modelsUsed = [...new Set([
        ...(current.modelsUsed || []),
        ...(row.modelsUsed || [])
      ])];
      current.topModel = row.topModel || current.topModel;
    }
    current.modelBreakdowns = mergeModels(
      current.modelBreakdowns,
      direction < 0 ? row.modelBreakdowns : [],
      direction > 0 ? row.modelBreakdowns : []
    ).map(({ name, ...breakdown }) => ({
      modelName: name,
      ...breakdown
    }));
    target.set(date, current);
  }
}

function finalizeDay(day) {
  const breakdownTop = day.modelBreakdowns?.[0]?.modelName;
  return {
    ...day,
    topModel: breakdownTop || day.topModel || day.modelsUsed?.[0] || 'unknown',
    modelBreakdowns: day.modelBreakdowns || []
  };
}

function mergeSessions(base = [], current = [], machineId) {
  const retained = (base || []).filter(
    (session) => session.sourceMachine !== machineId
  );
  const tagged = (current || []).map((session) => ({
    ...session,
    sourceMachine: machineId
  }));

  return [...retained, ...tagged]
    .sort((left, right) =>
      String(left.lastActivity || left.date || '').localeCompare(
        String(right.lastActivity || right.date || '')
      )
    )
    .map((session, index) => ({
      ...session,
      index: index + 1
    }));
}

function mergeRange(previous = {}, current = {}) {
  const range = { ...current };
  for (const field of ['firstDay', 'startDate', 'firstTrackedDay']) {
    range[field] = earliest(previous?.[field], current?.[field]);
  }
  for (const field of ['lastDay', 'endDate', 'lastTrackedDay']) {
    range[field] = latest(previous?.[field], current?.[field]);
  }
  return Object.fromEntries(
    Object.entries(range).filter(([, value]) => value !== undefined)
  );
}

function adjustedNumber(base, remove, add) {
  return normalizeNumber(
    Number(base || 0) - Number(remove || 0) + Number(add || 0)
  );
}

function normalizeNumber(value) {
  if (Math.abs(value) < 1e-9) {
    return 0;
  }
  return value;
}

function hasUsage(record) {
  return usageFields.some((field) => Number(record[field] || 0) !== 0);
}

function earliest(left, right) {
  return [left, right].filter(Boolean).sort()[0];
}

function latest(left, right) {
  return [left, right].filter(Boolean).sort().at(-1);
}

function validateMachineId(machineId) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(machineId || '')) {
    throw new Error(
      `Invalid cumulative usage machine ID "${machineId}". ` +
      'Use 1–64 letters, numbers, dots, underscores, or hyphens.'
    );
  }
}
