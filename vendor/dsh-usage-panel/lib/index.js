// src/shared/contract.ts
var RPC_CHANNEL = "/usage-stats";
var RPC_OVERVIEW = "overview";
var RPC_SESSION_COST = "session.cost";
var RPC_BILLING_GET = "billing.get";
var RPC_BILLING_SET = "billing.set";
var RPC_BILLING_MODELS = "billing.models";
var RPC_SESSIONS_MORE = "sessions.more";
var RPC_PROJECTS_MORE = "projects.more";
var RPC_REPAIR_SESSION = "repair.session";
var DEFAULT_BILLING_SETTINGS = {
  prices: {},
  peakValleyEnabled: true
};
var OVERVIEW_VERSION = 4;

// src/shared/pricing.ts
var DEEPSEEK_OFFICIAL_PRICES = [
  {
    model: "deepseek-v4-flash",
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3 },
      output: { idle: 4.5, peak: 9 }
    }
  },
  {
    model: "deepseek-v4-pro",
    price: {
      inputCacheHit: { idle: 0.15, peak: 0.3 },
      inputCacheMiss: { idle: 4.5, peak: 9 },
      output: { idle: 13.5, peak: 27 }
    }
  },
  {
    model: "deepseek-v4-flash-vision-exp",
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3 },
      output: { idle: 4.5, peak: 9 }
    }
  }
];
function isDeepSeekProvider(provider) {
  return provider !== null && provider !== void 0 && provider !== "" && provider.toLowerCase().includes("deepseek");
}
function officialPriceFor(model) {
  const needle = model.toLowerCase();
  return DEEPSEEK_OFFICIAL_PRICES.find((entry) => entry.model.toLowerCase() === needle)?.price;
}
function compositePriceKey(provider, model) {
  return provider + "/" + model;
}
function resolveModelPrice(provider, model, customPrices) {
  if (model === null || model === void 0 || model === "") return null;
  const custom = lookupCustomPrice(provider, model, customPrices);
  if (custom !== void 0) {
    const peak = { inputCacheHit: custom.inputCacheHit, inputCacheMiss: custom.inputCacheMiss, output: custom.output };
    if (custom.flat === true) {
      return { peak, idle: peak, idleExplicit: true, flat: true, source: "custom" };
    }
    if (custom.idle !== void 0) {
      return { peak, idle: custom.idle, idleExplicit: true, flat: false, source: "custom" };
    }
    const half = (n) => n / 2;
    return {
      peak,
      idle: {
        inputCacheHit: half(peak.inputCacheHit),
        inputCacheMiss: half(peak.inputCacheMiss),
        output: half(peak.output)
      },
      idleExplicit: false,
      flat: false,
      source: "custom"
    };
  }
  const official = officialPriceFor(model);
  if (official === void 0) return null;
  return {
    peak: { inputCacheHit: official.inputCacheHit.peak, inputCacheMiss: official.inputCacheMiss.peak, output: official.output.peak },
    idle: { inputCacheHit: official.inputCacheHit.idle, inputCacheMiss: official.inputCacheMiss.idle, output: official.output.idle },
    idleExplicit: true,
    flat: false,
    source: "official"
  };
}
function lookupCustomPrice(provider, model, customPrices) {
  if (provider !== null && provider !== void 0) {
    const byProvider = customPrices[compositePriceKey(provider, model)];
    if (byProvider !== void 0) return byProvider;
  }
  return customPrices[model];
}
var MAX_PRICE = 1e6;
var MAX_KEY_LENGTH = 256;
function parseSessionCostPrices(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: ["prices must be an object"] };
  }
  const prices = {};
  const issues = [];
  for (const [key, raw] of Object.entries(input)) {
    if (key.length === 0) {
      issues.push("empty price key");
      continue;
    }
    if (key.length > MAX_KEY_LENGTH) {
      issues.push("price key too long: " + key.slice(0, 24) + "\u2026");
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push('price for "' + key + '" must be an object');
      continue;
    }
    const value = raw;
    const inputCacheHit = readPrice(value.inputCacheHit);
    const inputCacheMiss = readPrice(value.inputCacheMiss);
    const output = readPrice(value.output);
    if (inputCacheHit === null || inputCacheMiss === null || output === null) {
      issues.push('price for "' + key + '" needs finite numbers: inputCacheHit/inputCacheMiss/output');
      continue;
    }
    const entry = { inputCacheHit, inputCacheMiss, output };
    if (value.flat !== void 0 && value.flat !== true) {
      issues.push('price for "' + key + '" has a non-boolean flat');
      continue;
    }
    if (value.flat === true) entry.flat = true;
    if (value.idle !== void 0) {
      const idle = value.idle;
      const idleHit = readPrice(idle.inputCacheHit);
      const idleMiss = readPrice(idle.inputCacheMiss);
      const idleOut = readPrice(idle.output);
      if (idleHit === null || idleMiss === null || idleOut === null) {
        issues.push('price for "' + key + '" has an invalid idle column');
        continue;
      }
      entry.idle = { inputCacheHit: idleHit, inputCacheMiss: idleMiss, output: idleOut };
    }
    prices[key] = entry;
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, prices };
}
function readPrice(value) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_PRICE) return null;
  return value;
}

// src/shared/cost.ts
var MICRO_SCALE = 1e6;
var CENTS_DIVISOR = 1e10;
function microRate(yuanPerMillion) {
  return Math.round(yuanPerMillion * MICRO_SCALE);
}
function bucketMicro(b, hit, miss, out) {
  return b.missInputTokens * miss + b.cacheReadTokens * hit + b.outputTokens * out;
}
function periodCostCents(b, rate) {
  const micro = bucketMicro(b, microRate(rate.inputCacheHit), microRate(rate.inputCacheMiss), microRate(rate.output));
  return Math.round(micro / CENTS_DIVISOR);
}
function computeBilledCost(usage, price) {
  return periodCostCents(usage.peak, price.peak) + periodCostCents(usage.offPeak, price.idle);
}
function billedBucketsOf(b) {
  return {
    missInputTokens: b.input + b.cacheWrite,
    cacheReadTokens: b.cacheRead,
    outputTokens: b.output
  };
}
function costCentsFor(buckets, provider, model, customPrices, peakValley = true) {
  const price = resolveModelPrice(provider, model, customPrices);
  if (price === null) return null;
  const effective = peakValley ? price : { ...price, idle: price.peak };
  return computeBilledCost(
    { peak: billedBucketsOf(buckets.peak), offPeak: billedBucketsOf(buckets.offPeak) },
    effective
  );
}
function sumCostCents(rows) {
  let any = false;
  let sum = 0;
  for (const cents of rows) {
    if (cents === null) continue;
    any = true;
    sum += cents;
  }
  return any ? sum : null;
}
function totalCostCents(rows, prices, peakValley) {
  return sumCostCents(rows.map((row) => costCentsFor(row.cost, row.provider, row.model, prices, peakValley)));
}

// src/shared/usage.ts
var HEAT_DAYS = 182;
var RECENT_DAYS = 30;
function emptyBuckets() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
function emptyTotals() {
  return { ...emptyBuckets(), total: 0 };
}
function totalsFrom(b) {
  return { ...b, total: b.input + b.output + b.cacheRead + b.cacheWrite };
}
function sortedModels(map, costs, providers) {
  return Object.keys(map).map((model) => {
    const b = map[model];
    return {
      model,
      ...b,
      total: b.input + b.output + b.cacheRead + b.cacheWrite,
      provider: providers && providers[model] ? providers[model] : "unknown",
      cost: costs && costs[model] ? { peak: { ...costs[model].peak }, offPeak: { ...costs[model].offPeak } } : { peak: { ...emptyBuckets() }, offPeak: { ...emptyBuckets() } }
    };
  }).sort((a, b) => b.total - a.total);
}
function totalsFromModels(models) {
  const totals = emptyTotals();
  for (const item of models) {
    totals.input += item.input;
    totals.output += item.output;
    totals.cacheRead += item.cacheRead;
    totals.cacheWrite += item.cacheWrite;
    totals.total += item.total;
  }
  return totals;
}
function dayKeyUTC(ts) {
  const d = new Date(ts);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function parseDayKeyUTC(key) {
  const p = key.split("-");
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
function keyOfDateUTC(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function todayKeyUTC(now) {
  return dayKeyUTC(now);
}
function buildDayWindow(byDay, now, costByDay) {
  const days = [];
  const today = todayKeyUTC(now);
  const todayDate = parseDayKeyUTC(today);
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - i));
    const key = keyOfDateUTC(d);
    const record = byDay[key];
    const models = {};
    const cost = emptyPhase();
    let total = 0;
    if (record) {
      for (const model of Object.keys(record)) {
        const b = record[model];
        models[model] = totalsFrom(b);
        total += models[model].total;
      }
    }
    const dayCost = costByDay?.[key];
    if (dayCost) {
      for (const model of Object.keys(dayCost)) {
        const phase = dayCost[model];
        cost.peak.input += phase.peak.input;
        cost.peak.output += phase.peak.output;
        cost.peak.cacheRead += phase.peak.cacheRead;
        cost.peak.cacheWrite += phase.peak.cacheWrite;
        cost.offPeak.input += phase.offPeak.input;
        cost.offPeak.output += phase.offPeak.output;
        cost.offPeak.cacheRead += phase.offPeak.cacheRead;
        cost.offPeak.cacheWrite += phase.offPeak.cacheWrite;
      }
    }
    days.push({ date: key, total, models, cost, modelCosts: dayCost ?? {} });
  }
  return days;
}
function emptyPhase() {
  return { peak: emptyBuckets(), offPeak: emptyBuckets() };
}

// src/host/projection.ts
import { z } from "zod";

// src/shared/billing.ts
var BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
var PEAK_WINDOWS = [
  { open: 9 * 60, close: 12 * 60 },
  { open: 14 * 60, close: 18 * 60 }
];
var WEEKDAY_MAX = 5;
function isPeakBillingTime(epochMs) {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS);
  const day = wall.getUTCDay();
  if (day < 1 || day > WEEKDAY_MAX) return false;
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  return PEAK_WINDOWS.some((w) => minuteOfDay >= w.open && minuteOfDay < w.close);
}

// src/host/projection.ts
var bucketSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number()
});
var phaseBucketsSchema = z.object({
  peak: bucketSchema,
  offPeak: bucketSchema
});
var stepSchema = z.object({
  buckets: bucketSchema,
  /** Billing phase of the step's start instant (classification snapshot). */
  peak: z.boolean(),
  lastTime: z.number(),
  model: z.string(),
  provider: z.string(),
  mode: z.enum(["provisional", "authoritative"])
});
var stepStartSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative()
});
var usagePanelSchema = z.object({
  totals: bucketSchema,
  byModel: z.record(z.string(), bucketSchema),
  byDay: z.record(z.string(), z.record(z.string(), bucketSchema)),
  byProvider: z.record(z.string(), bucketSchema),
  costTotals: phaseBucketsSchema,
  costByModel: z.record(z.string(), phaseBucketsSchema),
  costByDay: z.record(z.string(), z.record(z.string(), phaseBucketsSchema)),
  costByProvider: z.record(z.string(), phaseBucketsSchema),
  modelProviders: z.record(z.string(), z.string()),
  retries: z.number(),
  compactionTokens: z.number(),
  firstTime: z.number().nullable(),
  lastTime: z.number().nullable(),
  seedEnd: z.number().nullable(),
  currentModel: z.string(),
  currentProvider: z.string(),
  stepStart: stepStartSchema.nullable(),
  openStep: z.string().nullable(),
  steps: z.record(z.string(), stepSchema)
});
var USAGE_PANEL_KEY = "usagePanel";
var EMPTY = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
function initState() {
  return {
    totals: { ...EMPTY },
    byModel: {},
    byDay: {},
    byProvider: {},
    costTotals: { peak: { ...EMPTY }, offPeak: { ...EMPTY } },
    costByModel: {},
    costByDay: {},
    costByProvider: {},
    modelProviders: {},
    retries: 0,
    compactionTokens: 0,
    firstTime: null,
    lastTime: null,
    seedEnd: null,
    currentModel: "unknown",
    currentProvider: "unknown",
    stepStart: null,
    openStep: null,
    steps: {}
  };
}
function stepKey(turn, step) {
  return turn + ":" + step;
}
function add(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  };
}
function addInto(map, key, b) {
  const cur = map[key];
  return { ...map, [key]: cur ? add(cur, b) : { ...b } };
}
function addIntoDay(byDay, day, model, b) {
  const dayMap = byDay[day];
  return { ...byDay, [day]: dayMap ? addInto(dayMap, model, b) : { [model]: { ...b } } };
}
function addPhase(a, b, peak) {
  return { ...a, [peak ? "peak" : "offPeak"]: add(a[peak ? "peak" : "offPeak"], b) };
}
function addIntoPhase(map, key, b, peak) {
  const cur = map[key];
  return {
    ...map,
    [key]: cur ? addPhase(cur, b, peak) : addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak)
  };
}
function addIntoDayPhase(byDay, day, model, b, peak) {
  const dayMap = byDay[day];
  return {
    ...byDay,
    [day]: dayMap ? addIntoPhase(dayMap, model, b, peak) : { [model]: addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak) }
  };
}
function isCounted(state, event) {
  return state.seedEnd !== null && event.seq >= state.seedEnd;
}
function touchTime(state, time) {
  if (state.firstTime === null || time < state.firstTime || time > (state.lastTime ?? 0)) {
    return {
      ...state,
      firstTime: state.firstTime === null ? time : Math.min(state.firstTime, time),
      lastTime: state.lastTime === null ? time : Math.max(state.lastTime, time)
    };
  }
  return state;
}
function commitStep(state, key) {
  const step = state.steps[key];
  if (!step) return state;
  const b = step.buckets;
  if (b.input === 0 && b.output === 0 && b.cacheRead === 0 && b.cacheWrite === 0) {
    const steps = { ...state.steps };
    delete steps[key];
    return { ...state, steps, openStep: state.openStep === key ? null : state.openStep };
  }
  const day = dayKeyUTC(step.lastTime);
  const next = {
    ...state,
    totals: add(state.totals, b),
    byModel: addInto(state.byModel, step.model, b),
    byDay: addIntoDay(state.byDay, day, step.model, b),
    byProvider: addInto(state.byProvider, step.provider, b),
    costTotals: addPhase(state.costTotals, b, step.peak),
    costByModel: addIntoPhase(state.costByModel, step.model, b, step.peak),
    costByDay: addIntoDayPhase(state.costByDay, day, step.model, b, step.peak),
    costByProvider: addIntoPhase(state.costByProvider, step.provider, b, step.peak),
    modelProviders: { ...state.modelProviders, [step.model]: step.provider },
    firstTime: state.firstTime === null ? step.lastTime : Math.min(state.firstTime, step.lastTime),
    lastTime: state.lastTime === null ? step.lastTime : Math.max(state.lastTime, step.lastTime),
    steps: { ...state.steps },
    openStep: state.openStep === key ? null : state.openStep
  };
  delete next.steps[key];
  return next;
}
function commitOpenStep(state, incomingKey) {
  if (state.openStep !== null && state.openStep !== incomingKey) {
    return commitStep(state, state.openStep);
  }
  return state;
}
function samplePeak(state, turn, step, eventTime) {
  const start = state.stepStart;
  if (start !== null && start.turn === turn && start.step === step) return isPeakBillingTime(start.ms);
  return isPeakBillingTime(eventTime);
}
function applyEvent(state, event) {
  switch (event.type) {
    case "session/end-seed": {
      if (state.seedEnd !== null && event.seq <= state.seedEnd) return state;
      return { ...state, seedEnd: event.seq };
    }
    case "step/start": {
      if (!isCounted(state, event)) return state;
      const stepStart = { turn: event.data.turn, step: event.data.step, ms: event.time };
      const current = state.stepStart;
      if (current !== null && current.turn === stepStart.turn && current.step === stepStart.step && current.ms === stepStart.ms) {
        return state;
      }
      return { ...state, stepStart };
    }
    case "request/context": {
      const { model, provider } = event.data;
      if (!model && !provider) return state;
      return {
        ...state,
        currentModel: model || state.currentModel,
        currentProvider: provider || state.currentProvider
      };
    }
    case "request/header": {
      const cfg = event.data.header && event.data.header.config;
      if (!cfg || !cfg.model && !cfg.provider) return state;
      return {
        ...state,
        currentModel: cfg.model || state.currentModel,
        currentProvider: cfg.provider || state.currentProvider
      };
    }
    case "assistant/chunk": {
      if (!isCounted(state, event)) return state;
      const chunk = event.data.chunk;
      if (!chunk || chunk.type !== "usage" || !chunk.usage) return state;
      const key = stepKey(event.data.turn, event.data.step);
      const usage = chunk.usage;
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      let next = commitOpenStep(state, key);
      const existing = next.steps[key];
      const step = existing ? { ...existing, buckets: add(existing.buckets, b), lastTime: event.time } : {
        buckets: b,
        peak: samplePeak(next, event.data.turn, event.data.step, event.time),
        lastTime: event.time,
        model: next.currentModel,
        provider: next.currentProvider,
        mode: "provisional"
      };
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key
      };
    }
    case "assistant/message": {
      if (!isCounted(state, event)) return state;
      const usage = event.data.usage;
      if (!usage) return state;
      const key = stepKey(event.data.turn, event.data.step);
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      let next = commitOpenStep(state, key);
      const existing = next.steps[key];
      const step = {
        buckets: b,
        // The step's phase is a snapshot: a provisional accumulation already
        // classified it, and a late message (after the next step's start) must
        // not reclassify it by its own (possibly post-boundary) arrival time.
        peak: existing ? existing.peak : samplePeak(next, event.data.turn, event.data.step, event.time),
        lastTime: event.time,
        model: next.currentModel,
        provider: next.currentProvider,
        mode: "authoritative"
      };
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key
      };
    }
    case "step/end": {
      const key = stepKey(event.data.turn, event.data.step);
      return commitStep(state, key);
    }
    case "turn/end": {
      return state.openStep !== null ? commitStep(state, state.openStep) : state;
    }
    case "llm/retry": {
      if (!isCounted(state, event)) return state;
      return touchTime({ ...state, retries: state.retries + 1 }, event.time);
    }
    case "compaction/summary": {
      if (!isCounted(state, event)) return state;
      const usage = event.data.usage;
      if (!usage) return state;
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      const model = event.data.model || state.currentModel;
      const provider = event.data.provider || state.currentProvider;
      const day = dayKeyUTC(event.time);
      return {
        ...state,
        totals: add(state.totals, b),
        byModel: addInto(state.byModel, model, b),
        byDay: addIntoDay(state.byDay, day, model, b),
        byProvider: addInto(state.byProvider, provider, b),
        modelProviders: { ...state.modelProviders, [model]: provider },
        compactionTokens: state.compactionTokens + b.input + b.output + b.cacheRead + b.cacheWrite,
        firstTime: state.firstTime === null ? event.time : Math.min(state.firstTime, event.time),
        lastTime: state.lastTime === null ? event.time : Math.max(state.lastTime, event.time)
      };
    }
    default:
      return state;
  }
}
function recentOf(value, cutoffKey) {
  const totals = { ...EMPTY };
  const byModel = {};
  const costByModel = {};
  for (const day of Object.keys(value.byDay)) {
    if (day < cutoffKey) continue;
    for (const model of Object.keys(value.byDay[day])) {
      const b = value.byDay[day][model];
      totals.input += b.input;
      totals.output += b.output;
      totals.cacheRead += b.cacheRead;
      totals.cacheWrite += b.cacheWrite;
      const cur = byModel[model];
      byModel[model] = cur ? {
        input: cur.input + b.input,
        output: cur.output + b.output,
        cacheRead: cur.cacheRead + b.cacheRead,
        cacheWrite: cur.cacheWrite + b.cacheWrite
      } : { ...b };
    }
  }
  const dayCost = value.costByDay;
  for (const day of Object.keys(dayCost)) {
    if (day < cutoffKey) continue;
    for (const model of Object.keys(dayCost[day])) {
      const phase = dayCost[day][model];
      const cur = costByModel[model];
      costByModel[model] = cur ? {
        peak: add(cur.peak, phase.peak),
        offPeak: add(cur.offPeak, phase.offPeak)
      } : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
    }
  }
  return { totals, byModel, costByModel };
}

// src/host/aggregate.ts
var EMPTY_COST = Object.freeze({ peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
function emptyCost() {
  return { peak: { ...EMPTY_COST.peak }, offPeak: { ...EMPTY_COST.offPeak } };
}
function emptyAggregate() {
  return {
    allTimeTotals: emptyTotals(),
    allTimeByModel: {},
    allTimeByProvider: {},
    allTimeCost: emptyCost(),
    allTimeCostByModel: {},
    allTimeModelProviders: {},
    byDay: {},
    byDayCost: {},
    recentTotals: emptyTotals(),
    recentByModel: {},
    recentCostByModel: {},
    recentSessionCount: 0,
    allTimeSessionCount: 0,
    retries: 0,
    compactionTokens: 0,
    from: null,
    to: null,
    usageSessionsMain: 0,
    usageSessionsSubagent: 0,
    sessions: []
  };
}
function mergeSessionValue(a, value, sessionId, now, depth = 0, cwd = null) {
  const cutoffKey = dayKeyUTC(now - RECENT_DAYS * 24 * 3600 * 1e3);
  const recent = recentOf(value, cutoffKey);
  const totals = totalsFrom(value.totals);
  const next = {
    ...a,
    allTimeTotals: {
      input: a.allTimeTotals.input + totals.input,
      output: a.allTimeTotals.output + totals.output,
      cacheRead: a.allTimeTotals.cacheRead + totals.cacheRead,
      cacheWrite: a.allTimeTotals.cacheWrite + totals.cacheWrite,
      total: a.allTimeTotals.total + totals.total
    },
    recentTotals: {
      input: a.recentTotals.input + recent.totals.input,
      output: a.recentTotals.output + recent.totals.output,
      cacheRead: a.recentTotals.cacheRead + recent.totals.cacheRead,
      cacheWrite: a.recentTotals.cacheWrite + recent.totals.cacheWrite,
      total: a.recentTotals.total + recent.totals.input + recent.totals.output + recent.totals.cacheRead + recent.totals.cacheWrite
    },
    retries: a.retries + value.retries,
    compactionTokens: a.compactionTokens + value.compactionTokens,
    from: a.from === null ? value.firstTime : value.firstTime === null ? a.from : Math.min(a.from, value.firstTime),
    to: a.to === null ? value.lastTime : value.lastTime === null ? a.to : Math.max(a.to, value.lastTime)
  };
  for (const model of Object.keys(value.byModel)) {
    const b = value.byModel[model];
    const cur = next.allTimeByModel[model];
    next.allTimeByModel[model] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const model of Object.keys(value.costByModel)) {
    const phase = value.costByModel[model];
    const cur = next.allTimeCostByModel[model];
    next.allTimeCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
  }
  for (const model of Object.keys(value.modelProviders)) {
    if (next.allTimeModelProviders[model] === void 0) next.allTimeModelProviders[model] = value.modelProviders[model];
  }
  for (const provider of Object.keys(value.byProvider)) {
    const b = value.byProvider[provider];
    const cur = next.allTimeByProvider[provider];
    next.allTimeByProvider[provider] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const day of Object.keys(value.byDay)) {
    const dayMap = value.byDay[day];
    const target = next.byDay[day] || (next.byDay[day] = {});
    for (const model of Object.keys(dayMap)) {
      const b = dayMap[model];
      const cur = target[model];
      target[model] = cur ? mergeB(cur, b) : { ...b };
    }
  }
  for (const day of Object.keys(value.costByDay)) {
    const dayMap = value.costByDay[day];
    const target = next.byDayCost[day] || (next.byDayCost[day] = {});
    for (const model of Object.keys(dayMap)) {
      const phase = dayMap[model];
      const cur = target[model];
      target[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
    }
  }
  for (const model of Object.keys(recent.byModel)) {
    const b = recent.byModel[model];
    const cur = next.recentByModel[model];
    next.recentByModel[model] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const model of Object.keys(recent.costByModel)) {
    const phase = recent.costByModel[model];
    const cur = next.recentCostByModel[model];
    next.recentCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
  }
  if (recent.totals.input + recent.totals.output + recent.totals.cacheRead + recent.totals.cacheWrite > 0) {
    next.recentSessionCount += 1;
  }
  if (totals.total > 0) {
    next.allTimeSessionCount += 1;
    if (depth > 0) next.usageSessionsSubagent += 1;
    else next.usageSessionsMain += 1;
    next.sessions.push({
      id: sessionId,
      cwd,
      totals,
      lastActive: value.lastTime ?? 0,
      depth,
      models: sessionModels(value)
    });
  }
  next.allTimeCost = mergePhase(next.allTimeCost, value.costTotals);
  return next;
}
function sessionModels(value) {
  return Object.keys(value.costByModel).map((model) => ({
    model,
    provider: value.modelProviders[model] ?? "unknown",
    cost: value.costByModel[model]
  }));
}
function mergePhase(a, b) {
  return {
    peak: mergeB(a.peak, b.peak),
    offPeak: mergeB(a.offPeak, b.offPeak)
  };
}
function mergeB(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  };
}
function rankSessions(sessions, limit) {
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total).slice(0, limit);
}
function rankSessionsBy(sessions, sort, prices, peakValley) {
  if (sort === "cost") {
    return [...sessions].sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley);
      const bc = totalCostCents(b.models, prices, peakValley);
      if (ac === null && bc === null) return b.totals.total - a.totals.total;
      if (ac === null) return 1;
      if (bc === null) return -1;
      return bc - ac;
    });
  }
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total);
}
function pathBasename(dir) {
  if (dir === null || dir === "") return "";
  const sep = dir.includes("\\") ? "\\" : "/";
  const parts = dir.split(sep).filter((p) => p !== "");
  return parts[parts.length - 1] ?? dir;
}
function projectRowsOf(sessions, sort = "tokens", prices = {}, peakValley = true) {
  const byProject = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const key = session.cwd ?? "(unknown)";
    let row = byProject.get(key);
    if (row === void 0) {
      row = { project: session.cwd, name: pathBasename(session.cwd) || "(unknown)", totals: emptyTotals(), models: [] };
      byProject.set(key, row);
    }
    const totals = row.totals;
    totals.input += session.totals.input;
    totals.output += session.totals.output;
    totals.cacheRead += session.totals.cacheRead;
    totals.cacheWrite += session.totals.cacheWrite;
    totals.total += session.totals.total;
    const index = /* @__PURE__ */ new Map();
    row.models.forEach((m, i) => index.set(m.model + "\0" + m.provider, i));
    for (const m of session.models) {
      const idx = index.get(m.model + "\0" + m.provider);
      if (idx !== void 0) {
        const cur = row.models[idx];
        cur.cost = { peak: mergeB(cur.cost.peak, m.cost.peak), offPeak: mergeB(cur.cost.offPeak, m.cost.offPeak) };
      } else {
        index.set(m.model + "\0" + m.provider, row.models.length);
        row.models.push({ model: m.model, provider: m.provider, cost: { peak: { ...m.cost.peak }, offPeak: { ...m.cost.offPeak } } });
      }
    }
  }
  const rows = [...byProject.values()];
  if (sort === "cost") {
    rows.sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley);
      const bc = totalCostCents(b.models, prices, peakValley);
      if (ac === null && bc === null) return b.totals.total - a.totals.total;
      if (ac === null) return 1;
      if (bc === null) return -1;
      return bc - ac;
    });
  } else {
    rows.sort((a, b) => b.totals.total - a.totals.total);
  }
  return rows;
}
function pageOf(rows, offset, limit) {
  const start = Math.max(0, offset);
  return {
    rows: rows.slice(start, start + limit),
    hasMore: start + limit < rows.length
  };
}
function finalizeOverview(input) {
  const { aggregate: a, now, mode, sessionsTotal, sessionsOk, sessionsFailed, sessionsPending, eventsCounted, titles, providerNames } = input;
  const recentByModel = sortedModels(a.recentByModel, a.recentCostByModel, a.allTimeModelProviders);
  const allTimeByModel = sortedModels(a.allTimeByModel, a.allTimeCostByModel, a.allTimeModelProviders);
  const providerRows = Object.keys(a.allTimeByProvider).map((id) => {
    const b = a.allTimeByProvider[id];
    return { id, name: providerNames[id] || id, totals: totalsFrom(b) };
  }).sort((x, y) => y.totals.total - x.totals.total);
  const top = rankSessions(a.sessions, 10);
  const topSessions = top.map((s) => ({
    id: s.id,
    title: titles.has(s.id) ? titles.get(s.id) : null,
    totals: s.totals,
    lastActive: s.lastActive,
    depth: s.depth,
    models: s.models
  }));
  const coverage = {
    mode,
    timezone: "UTC",
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    retries: a.retries,
    compactionTokens: a.compactionTokens,
    from: a.from,
    to: a.to,
    usageSessionsMain: a.usageSessionsMain,
    usageSessionsSubagent: a.usageSessionsSubagent,
    failedSessionIds: input.failedSessionIds ?? []
  };
  return {
    days: buildDayWindow(a.byDay, now, a.byDayCost),
    totals: totalsFromModels(recentByModel),
    sessionCount: a.recentSessionCount,
    byModel: recentByModel,
    allTime: {
      totals: totalsFromModels(allTimeByModel),
      sessionCount: a.allTimeSessionCount,
      byModel: allTimeByModel,
      costTotals: a.allTimeCost
    },
    coverage,
    topSessions,
    providers: providerRows,
    updatedAt: now
  };
}
function emptyOverview(now) {
  return finalizeOverview({
    aggregate: emptyAggregate(),
    now,
    mode: "none",
    sessionsTotal: 0,
    sessionsOk: 0,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: /* @__PURE__ */ new Map(),
    providerNames: {}
  });
}

// src/host/projection-unit.ts
var PROJECTION_STATE_VERSION = 2;
var usagePanelProjectionDefinition = {
  key: USAGE_PANEL_KEY,
  stateVersion: PROJECTION_STATE_VERSION,
  stateSchema: usagePanelSchema,
  init: initState,
  apply: applyEvent,
  wire: {
    viewSchema: usagePanelSchema,
    view: (state) => state
  }
};

// src/host/pacing.ts
var BATCH_SIZE = 5;
var PROGRESS_EVERY = 200;
function yieldLoop() {
  return new Promise((resolve2) => {
    setImmediate(resolve2);
  });
}
function scanPacer(log) {
  return {
    async beat(index, total) {
      if (index % BATCH_SIZE === 0) await yieldLoop();
      if (index % PROGRESS_EVERY === 0 || index === total) {
        log(`scan progress: ${index}/${total} sessions processed`);
      }
    }
  };
}
function withTimeout(source, ms, label) {
  return new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label + " timed out"));
    }, ms);
    source.then(
      (value) => {
        clearTimeout(timer);
        resolve2(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// src/host/scan.ts
function isCountedEvent(state, event) {
  if (state.seedEnd === null || event.seq < state.seedEnd) return false;
  switch (event.type) {
    case "assistant/message":
      return !!event.data.usage;
    case "assistant/chunk":
      return !!event.data.chunk && event.data.chunk.type === "usage" && !!event.data.chunk.usage;
    case "compaction/summary":
      return !!event.data.usage;
    case "llm/retry":
      return true;
    default:
      return false;
  }
}
async function scanFallback(deps, now) {
  const { sq, providerNames, logFailure } = deps;
  let a = emptyAggregate();
  const titles = /* @__PURE__ */ new Map();
  const failed = [];
  let sessionsTotal = 0;
  let sessionsOk = 0;
  let sessionsFailed = 0;
  let sessionsPending = 0;
  let eventsCounted = 0;
  let sessions = [];
  try {
    sessions = await sq.listSessions();
  } catch (err) {
    logFailure("listSessions failed: " + String(err?.message ?? err));
    return finalizeOverview({
      aggregate: a,
      now,
      mode: "scan",
      sessionsTotal: 0,
      sessionsOk: 0,
      sessionsFailed: 0,
      sessionsPending: 0,
      eventsCounted: 0,
      titles,
      providerNames
    });
  }
  const pacer = scanPacer((message) => console.log("[dsh-usage-panel]", message));
  let index = 0;
  for (const rec of sessions) {
    index += 1;
    const header = rec && rec.header;
    if (!header) {
      sessionsTotal += 1;
      sessionsFailed += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    const sessionId = header.id;
    sessionsTotal += 1;
    if (!rec.persisted) {
      sessionsPending += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    let snapshot = null;
    try {
      snapshot = await sq.readSession(header.id);
    } catch (err) {
      sessionsFailed += 1;
      if (failed.length < 50) failed.push(sessionId);
      logFailure("readSession " + sessionId + " failed: " + String(err?.message ?? err));
      await pacer.beat(index, sessions.length);
      continue;
    }
    const events = snapshot && snapshot.events;
    if (!events || !events.length) {
      sessionsOk += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    const seedLength = Number(header.seedLength) || 0;
    let seedEnd = 0;
    for (const event of events) {
      if (event.type === "session/end-seed") seedEnd = event.seq;
    }
    if (seedEnd === 0 && seedLength > 0) seedEnd = seedLength + 1;
    let state = { ...initState(), seedEnd };
    let title = null;
    for (const event of events) {
      if (event.type === "session/title") {
        title = event.data.title;
      }
      if (isCountedEvent(state, event)) eventsCounted += 1;
      state = applyEvent(state, event);
    }
    titles.set(sessionId, title);
    const depth = Number(header.delegationDepth) || 0;
    const cwd = header.cwd || null;
    a = mergeSessionValue(a, state, sessionId, now, depth, typeof cwd === "string" ? cwd : null);
    sessionsOk += 1;
    await pacer.beat(index, sessions.length);
  }
  deps.storeIndex(rankSessions(a.sessions, Number.MAX_SAFE_INTEGER));
  deps.storeFailed(failed);
  return finalizeOverview({
    aggregate: a,
    now,
    mode: "scan",
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    titles,
    providerNames,
    failedSessionIds: failed
  });
}

// src/host/billing-store.ts
import { z as z2 } from "zod";
var BILLING_DOMAIN_NAME = "dsh_usage_panel_billing";
var BILLING_DOMAIN_VERSION = 1;
var priceValueSchema = z2.object({
  inputCacheHit: z2.number(),
  inputCacheMiss: z2.number(),
  output: z2.number(),
  idle: z2.object({
    inputCacheHit: z2.number(),
    inputCacheMiss: z2.number(),
    output: z2.number()
  }).optional(),
  flat: z2.boolean().optional()
});
var emptyPrices = {};
var billingGlobalSchema = z2.object({
  prices: z2.record(z2.string(), priceValueSchema),
  // Legacy v0.3 fields of the retired composer cost strip: a record written
  // by that version still carries them; they parse and are ignored.
  stripVisible: z2.boolean().optional(),
  peakHintVisible: z2.boolean().optional(),
  peakValleyEnabled: z2.boolean()
});
function initialRecord() {
  return {
    prices: {},
    peakValleyEnabled: DEFAULT_BILLING_SETTINGS.peakValleyEnabled
  };
}
var BillingStore = class {
  constructor(medium, warn) {
    this.warn = warn;
    this.medium = medium;
    this.mode = medium === void 0 ? "memory" : "durable";
  }
  cache = null;
  medium;
  mode;
  /** Attach the durable medium after the async domain open (upgrades the mode). */
  attachMedium(medium) {
    this.medium = medium;
    this.mode = "durable";
  }
  /** Read the current record (cached per process; first read materializes). */
  async load() {
    if (this.cache !== null) return this.cache;
    this.cache = this.fromRaw(this.medium?.get());
    return this.cache;
  }
  /** Replace the whole record (validated; throws with the issues on refusal). */
  async save(settings) {
    this.toRaw(settings);
    if (this.medium !== void 0) {
      await this.medium.set(settings);
    }
    this.cache = settings;
    return this.cache;
  }
  fromRaw(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return initialRecord();
    const record = raw;
    const parsed = parseSessionCostPrices(record.prices);
    if (!parsed.ok) {
      this.warn("stored prices failed validation, using defaults: " + parsed.issues.join(" | "));
      return {
        prices: {},
        peakValleyEnabled: record.peakValleyEnabled === false ? false : true
      };
    }
    return {
      prices: parsed.prices,
      peakValleyEnabled: record.peakValleyEnabled === false ? false : true
    };
  }
  toRaw(settings) {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error("invalid billing settings: expected an object");
    }
    const parsed = parseSessionCostPrices(settings.prices);
    if (!parsed.ok) throw new Error("invalid prices: " + parsed.issues.join(" | "));
    if (typeof settings.peakValleyEnabled !== "boolean") {
      throw new Error("invalid billing settings: peakValleyEnabled must be a boolean");
    }
  }
};
async function openBillingMedium(storageDomain, warn) {
  if (storageDomain === void 0) return void 0;
  try {
    const domain = await storageDomain.open({
      name: BILLING_DOMAIN_NAME,
      version: BILLING_DOMAIN_VERSION,
      global: {
        schema: billingGlobalSchema,
        initial: { ...initialRecord(), prices: { ...emptyPrices } }
      },
      tables: {}
    });
    return domain.global;
  } catch (error) {
    warn("billing domain open failed; preferences are memory-only: " + String(error?.message ?? error));
    return void 0;
  }
}

// src/host/session-repair.ts
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// src/host/zstd-frames.ts
import { constants, zstdCompress as nodeZstdCompress, zstdDecompress as nodeZstdDecompress } from "node:zlib";
import { promisify } from "node:util";
var zstdCompressAsync = promisify(nodeZstdCompress);
var zstdDecompressAsync = promisify(nodeZstdDecompress);
var ZSTD_MAGIC = 4247762216;
var CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  let tornStart;
  outer: while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      tornStart = start;
      break;
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error("corrupt Zstandard session log: invalid frame magic at byte " + offset);
    }
    offset += 4;
    if (offset === buffer.length) {
      tornStart = start;
      break;
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error("corrupt Zstandard session log: reserved frame-header bit at byte " + (offset - 1));
    }
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const contentSizeFlag = descriptor >>> 6;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      tornStart = start;
      break;
    }
    offset += remainingHeaderBytes;
    for (; ; ) {
      if (buffer.length - offset < 3) {
        tornStart = start;
        break outer;
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error("corrupt Zstandard session log: reserved block type at byte " + (offset - 3));
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        tornStart = start;
        break outer;
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        tornStart = start;
        break;
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames, tornStart };
}
async function decompressZstdFrame(input) {
  return zstdDecompressAsync(input);
}
async function compressZstdFrame(input) {
  return zstdCompressAsync(input, CHECKSUM_OPTIONS);
}

// src/host/session-repair.ts
function resolveDshHome() {
  const env = process.env.DSH_HOME;
  if (env !== void 0 && env.trim() !== "") return resolve(env.trim());
  return join(homedir(), ".dsh");
}
async function locateSessionArtifact(home, sessionId) {
  const needle = sessionId.startsWith("session-") ? sessionId : "session-" + sessionId;
  const sessionsRoot = join(home, "sessions");
  let projects = [];
  try {
    projects = await readdir(sessionsRoot);
  } catch {
    return null;
  }
  for (const project of projects) {
    const projectDir = join(sessionsRoot, project);
    let entries = [];
    try {
      entries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name !== needle) continue;
      const sessionDir = join(projectDir, entry.name);
      const zstd = join(sessionDir, "session.jsonl.zstd");
      const plain = join(sessionDir, "session.jsonl");
      if (await exists(zstd)) return zstd;
      if (await exists(plain)) return plain;
      return null;
    }
  }
  return null;
}
async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
async function rebuildSessionLog(bytes, decode) {
  const { frames, tornStart } = scanZstdFrames(bytes);
  if (frames.length === 0) {
    throw new Error("no complete zstd frames" + (tornStart !== void 0 ? " (torn tail " + tornStart + ")" : ""));
  }
  const parts = [];
  for (const frame of frames) parts.push(await decompressZstdFrame(bytes.subarray(frame.start, frame.end)));
  const plain = Buffer.concat(parts).toString("utf8");
  const lines = plain.split("\n");
  const header = lines[0] ?? "";
  if (header.trim() === "") throw new Error("empty or header-less session log");
  let bodyLines = lines.slice(1);
  if (!plain.endsWith("\n") && bodyLines.length > 0) {
    bodyLines = bodyLines.slice(0, -1);
  }
  const events = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line.trim() === "") continue;
    let decoded;
    try {
      decoded = decode(JSON.parse(line));
    } catch {
      throw new Error("unparsable committed event at line " + (i + 2));
    }
    if (!Array.isArray(decoded)) throw new Error("malformed storage row at line " + (i + 2));
    for (const event of decoded) {
      const shaped = event;
      shaped.seq = events.length;
      events.push(shaped);
    }
  }
  if (events.length === 0) throw new Error("no events found in session log");
  const headerText = header + "\n";
  const bodyText = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const rebuilt = Buffer.concat([await compressZstdFrame(headerText), await compressZstdFrame(bodyText)]);
  return { events: events.length, rebuilt, header };
}
async function repairSessionLog(home, sessionId, decode) {
  const artifact = await locateSessionArtifact(home, sessionId);
  if (artifact === null) {
    throw new Error("session artifact not found under " + join(home, "sessions"));
  }
  const bytes = await readFile(artifact);
  const rebuilt = await rebuildSessionLog(bytes, decode);
  if (rebuilt.events === 0) throw new Error("nothing to repair");
  const backup = artifact + ".bak-" + Date.now();
  await writeFile(backup, bytes);
  const tmp = artifact + ".tmp";
  await writeFile(tmp, rebuilt.rebuilt);
  await rename(tmp, artifact);
  return {
    repaired: rebuilt.events,
    backup,
    bytesBefore: bytes.length,
    bytesAfter: rebuilt.rebuilt.length
  };
}
async function runtimeCodec() {
  const mod = await import("@deepseek-ai/dsh-session");
  return {
    decode: (value) => mod.decodeStorageRecord(value)
  };
}

// src/host/stats-cache.ts
import { join as join2 } from "node:path";
function statsCacheKey(watermark) {
  return "v" + OVERVIEW_VERSION + ":s" + PROJECTION_STATE_VERSION + ":n" + watermark.sessionsTotal + ":t" + (watermark.to ?? 0);
}
async function openStatsCache(home, warn) {
  let sqlite = null;
  try {
    sqlite = await import("node:sqlite");
  } catch (err) {
    warn("node:sqlite unavailable \u2014 stats cache is memory-only: " + String(err?.message ?? err));
    return null;
  }
  try {
    const db = new sqlite.DatabaseSync(join2(home, "dsh-usage-panel.sqlite"));
    db.exec(
      "PRAGMA journal_mode = WAL"
      // concurrent reads with the write path + crash recovery
    );
    db.exec(
      "PRAGMA synchronous = NORMAL"
      // WAL's standard durability/perf pairing
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, payload TEXT NOT NULL, savedAt INTEGER NOT NULL)"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS ledger (sessionId TEXT PRIMARY KEY, asOfSeq INTEGER NOT NULL, savedAt INTEGER NOT NULL)"
    );
    const getStmt = db.prepare("SELECT payload FROM stats WHERE key = ?");
    const putStmt = db.prepare("INSERT OR REPLACE INTO stats (key, payload, savedAt) VALUES (?, ?, ?)");
    const ledgerGetStmt = db.prepare("SELECT asOfSeq FROM ledger WHERE sessionId = ?");
    const ledgerPutStmt = db.prepare("INSERT OR REPLACE INTO ledger (sessionId, asOfSeq, savedAt) VALUES (?, ?, ?)");
    const ledgerDeleteStmt = db.prepare("DELETE FROM ledger WHERE sessionId = ?");
    const ledgerClearStmt = db.prepare("DELETE FROM ledger");
    const ledgerCountStmt = db.prepare("SELECT COUNT(*) AS n FROM ledger");
    return {
      async get(key) {
        try {
          const row = getStmt.get(key);
          if (row === void 0 || row.payload === void 0) return null;
          const parsed = JSON.parse(row.payload);
          if (typeof parsed !== "object" || parsed === null) return null;
          return parsed;
        } catch {
          return null;
        }
      },
      async put(key, payload) {
        try {
          putStmt.run(key, JSON.stringify(payload), Date.now());
        } catch {
        }
      },
      async ledgerGet(sessionId) {
        try {
          const row = ledgerGetStmt.get(sessionId);
          return typeof row?.asOfSeq === "number" ? row.asOfSeq : null;
        } catch {
          return null;
        }
      },
      async ledgerPut(sessionId, asOfSeq) {
        try {
          ledgerPutStmt.run(sessionId, asOfSeq, Date.now());
        } catch {
        }
      },
      async ledgerDelete(sessionId) {
        try {
          ledgerDeleteStmt.run(sessionId);
        } catch {
        }
      },
      async ledgerClear() {
        try {
          ledgerClearStmt.run();
        } catch {
        }
      },
      async ledgerCount() {
        try {
          const row = ledgerCountStmt.get();
          return typeof row?.n === "number" ? row.n : 0;
        } catch {
          return 0;
        }
      },
      close() {
        try {
          db.exec("PRAGMA optimize");
        } catch {
        }
      }
    };
  } catch (err) {
    warn("stats cache open failed \u2014 memory-only: " + String(err?.message ?? err));
    return null;
  }
}

// src/host/index.ts
var name = "dsh-usage-panel";
var inject = [
  "timer",
  "connection",
  "sessionProjections",
  "sessionQuery",
  "sessionProjectionCache"
];
function isSessionGone(err) {
  return err?.code === "SESSION_QUERY_SESSION_NOT_FOUND";
}
var STALE_MS = 10 * 60 * 1e3;
var RESCAN_MS = 10 * 60 * 1e3;
function apply(ctx) {
  const tag = "[dsh-usage-panel]";
  const sq = ctx.get("sessionQuery");
  const registry = ctx.get("sessionProjections");
  const projCache = ctx.get("sessionProjectionCache");
  const connection = ctx.get("connection");
  const llm = ctx.get("llm");
  let mode = "projection";
  console.log(
    tag,
    "boot: mode=" + mode,
    "services: sessionQuery=" + Boolean(sq) + " sessionProjections=" + Boolean(registry) + " sessionProjectionCache=" + Boolean(projCache)
  );
  let disposeUnit = null;
  try {
    disposeUnit = ctx.sessionProjections.register(
      // Desktop harness register() reads stateSchema + wire; npm rc.6 d.ts still wants schema + view.
      usagePanelProjectionDefinition
    );
  } catch (err) {
    console.warn(tag, "projection registration failed; falling back to full scan:", String(err?.message ?? err));
    disposeUnit = null;
    mode = "scan";
  }
  let providerNames = {};
  if (llm && typeof llm.listProviders === "function") {
    Promise.resolve(llm.listProviders()).then((infos) => {
      providerNames = Object.fromEntries((infos || []).map((p) => [p.id, p.name]));
    }).catch((err) => console.warn(tag, "listProviders failed:", String(err?.message ?? err)));
  }
  let cache = null;
  let inflight = null;
  let disposed = false;
  let sessionIndex = [];
  let aggregate = null;
  let ledgerIds = /* @__PURE__ */ new Set();
  let failedSessionIds = [];
  const reportedCostFailures = /* @__PURE__ */ new Set();
  let statsCache = null;
  openStatsCache(resolveDshHome(), (message) => console.warn(tag, message)).then((cache2) => {
    statsCache = cache2;
  });
  const billingStore = new BillingStore(void 0, (message) => console.warn(tag, message));
  openBillingMedium(ctx.get("storageDomain"), (message) => console.warn(tag, message)).then((medium) => {
    if (medium) billingStore.attachMedium(medium);
  });
  function logFailure(message) {
    console.warn(tag, message);
  }
  async function scanProjection(now) {
    let a = emptyAggregate();
    let sessionsTotal = 0;
    let sessionsOk = 0;
    let sessionsFailed = 0;
    let sessionsPending = 0;
    const failures = [];
    let sessions = [];
    try {
      sessions = await sq.listSessions();
    } catch (err) {
      logFailure("listSessions failed: " + String(err?.message ?? err));
      return emptyOverview(now);
    }
    const pacer = scanPacer((message) => console.log(tag, message));
    const failed = [];
    const ledgerPuts = [];
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i];
      const header = rec && rec.header;
      if (!header) {
        sessionsTotal += 1;
        sessionsFailed += 1;
        await pacer.beat(i + 1, sessions.length);
        continue;
      }
      const id = header.id;
      sessionsTotal += 1;
      if (!rec.persisted) {
        sessionsPending += 1;
        await pacer.beat(i + 1, sessions.length);
        continue;
      }
      try {
        const log = await sq.readSession(id);
        const snap = projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events);
        const value = snap.values.usagePanel;
        if (!value) {
          sessionsPending += 1;
          await pacer.beat(i + 1, sessions.length);
          continue;
        }
        a = mergeSessionValue(a, value, id, now, 0, log.session.cwd ?? null);
        sessionsOk += 1;
        ledgerPuts.push({ id, asOfSeq: snap.asOfSeq });
      } catch (err) {
        sessionsFailed += 1;
        if (!isSessionGone(err) && failed.length < 50) failed.push(id);
        if (failures.length < 3) failures.push(String(err?.message ?? err));
      }
      await pacer.beat(i + 1, sessions.length);
    }
    aggregate = a;
    ledgerIds = new Set(ledgerPuts.map((p) => p.id));
    if (statsCache !== null) {
      void (async () => {
        for (const put of ledgerPuts) await statsCache.ledgerPut(put.id, put.asOfSeq);
      })();
    }
    failedSessionIds = failed;
    if (failures.length > 0) {
      logFailure(sessionsFailed + " session(s) failed to read (first " + failures.length + "): " + failures.join(" | "));
    }
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER);
    const titles = /* @__PURE__ */ new Map();
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        try {
          const t = await sq.readTitle(s.id);
          titles.set(s.id, t ? t.title : null);
        } catch {
          titles.set(s.id, null);
        }
      })
    );
    return finalizeOverview({
      aggregate: a,
      now,
      mode: "projection",
      sessionsTotal,
      sessionsOk,
      sessionsFailed,
      sessionsPending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds: failed
    });
  }
  async function scan(now) {
    if (disposed) return cache ? cache.payload : emptyOverview(now);
    if (mode === "projection") return scanProjection(now);
    return scanFallback({ sq, providerNames, logFailure, storeIndex: (rows) => {
      sessionIndex = rows;
    }, storeFailed: (ids) => {
      failedSessionIds = ids;
    } }, now);
  }
  async function watermarkKey() {
    const sessions = await sq.listSessions();
    let to = null;
    for (const rec of sessions) {
      const created = rec?.header?.createdAt;
      if (typeof created === "number" && (to === null || created > to)) to = created;
    }
    return statsCacheKey({ sessionsTotal: sessions.length, to });
  }
  async function hydrateFromCache() {
    if (cache !== null || statsCache === null) return;
    let payload = null;
    try {
      payload = await statsCache.get(await watermarkKey());
    } catch {
      payload = null;
    }
    if (payload !== null && !disposed) {
      cache = { at: payload.updatedAt, payload };
      console.log(tag, "stats cache hit \u2014 serving snapshot, refreshing in background");
    }
  }
  async function deltaScan(now) {
    if (aggregate === null) return scan(now);
    let sessions = [];
    try {
      sessions = await sq.listSessions();
    } catch (err) {
      logFailure("delta listSessions failed: " + String(err?.message ?? err));
      return cache ? cache.payload : emptyOverview(now);
    }
    let a = aggregate;
    const seen = /* @__PURE__ */ new Set();
    const changed = [];
    let deleteDetected = false;
    const pacer = scanPacer((message) => console.log(tag, message));
    const failed = [];
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i];
      const header = rec && rec.header;
      if (!header) continue;
      const id = header.id;
      seen.add(id);
      let asOf;
      try {
        asOf = statsCache === null ? void 0 : projCache.cachedSnapshot(header, 0)?.asOfSeq;
      } catch (err) {
        logFailure("delta probe failed for " + id + ": " + String(err?.message ?? err));
        asOf = void 0;
      }
      if (asOf !== void 0) {
        const led = statsCache === null ? null : await statsCache.ledgerGet(id);
        if (led === asOf) {
          await pacer.beat(i + 1, sessions.length);
          continue;
        }
      }
      try {
        const log = await sq.readSession(id);
        const snap = projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events);
        const value = snap.values.usagePanel;
        if (!value) {
          await pacer.beat(i + 1, sessions.length);
          continue;
        }
        a = mergeSessionValue(a, value, id, now, 0, log.session.cwd ?? null);
        changed.push(id);
        if (statsCache !== null) {
          await statsCache.ledgerPut(id, snap.asOfSeq);
          ledgerIds.add(id);
        }
        failedSessionIds = failedSessionIds.filter((f) => f !== id);
      } catch (err) {
        if (!isSessionGone(err) && failed.length < 50) failed.push(id);
        logFailure("delta read failed for " + id + ": " + String(err?.message ?? err));
      }
      await pacer.beat(i + 1, sessions.length);
    }
    for (const id of ledgerIds) {
      if (!seen.has(id)) deleteDetected = true;
    }
    if (deleteDetected) {
      logFailure(tag + " session deleted since last scan \u2014 falling back to a full rescan");
      return scan(now);
    }
    if (changed.length === 0 && cache !== null) {
      return cache.payload;
    }
    aggregate = a;
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER);
    if (failed.length > 0) failedSessionIds = [.../* @__PURE__ */ new Set([...failedSessionIds, ...failed])].slice(0, 50);
    const titles = /* @__PURE__ */ new Map();
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        try {
          const t = await sq.readTitle(s.id);
          titles.set(s.id, t ? t.title : null);
        } catch {
          titles.set(s.id, null);
        }
      })
    );
    const pending = sessions.filter((rec) => !(rec && rec.persisted)).length;
    return finalizeOverview({
      aggregate: a,
      now,
      mode: "projection",
      sessionsTotal: sessions.length,
      sessionsOk: sessions.length - failedSessionIds.length - pending,
      sessionsFailed: failedSessionIds.length,
      sessionsPending: pending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds
    });
  }
  function startScan() {
    if (disposed) return Promise.resolve(cache ? cache.payload : emptyOverview(Date.now()));
    if (inflight) return inflight;
    const run = (async () => {
      await hydrateFromCache();
      const payload = aggregate === null ? await scan(Date.now()) : await deltaScan(Date.now());
      if (payload !== null && !disposed) {
        cache = { at: Date.now(), payload };
        if (statsCache !== null) {
          setImmediate(() => {
            if (disposed) return;
            void (async () => {
              try {
                const key = await watermarkKey();
                await statsCache.put(key, payload);
              } catch {
              }
            })();
          });
        }
      }
      return payload;
    })();
    inflight = run;
    run.catch(() => {
    }).then(() => {
      if (inflight === run) inflight = null;
    });
    return run;
  }
  function overview(args) {
    const force = !!(args && args.force);
    if (!force && cache) {
      if (Date.now() - cache.at < STALE_MS) return Promise.resolve(cache.payload);
      startScan();
      return Promise.resolve(Object.assign({}, cache.payload, { stale: true }));
    }
    return startScan();
  }
  const ZERO_TOTALS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const ZERO_PHASE = {
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  async function sessionCost(payload) {
    const sessionId = payload.sessionId;
    if (!sessionId) throw new Error("missing sessionId");
    const sessions = ctx.get("sessions");
    let value;
    try {
      const live = sessions && sessions.get(sessionId);
      if (live) {
        const liveRegistry = registry;
        value = liveRegistry.stateOf(live, USAGE_PANEL_KEY);
      } else {
        const log = await sq.readSession(sessionId);
        value = projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events).values.usagePanel;
      }
    } catch (err) {
      if (isSessionGone(err)) {
        return { found: false, currentModel: "unknown", currentProvider: "unknown", cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } };
      }
      if (!reportedCostFailures.has(sessionId)) {
        reportedCostFailures.add(sessionId);
        logFailure("session.cost read failed for " + sessionId + ": " + String(err?.message ?? err));
        logFailure("session.cost will not retry reporting this session until the plugin reloads; open \u8BBE\u7F6E \u2192 \u7528\u91CF\u7EDF\u8BA1 and click the \u300C\u4FEE\u590D\u300D button in the page header (backed up to .bak-<ts> before rewriting)");
      }
      if (!failedSessionIds.includes(sessionId)) {
        failedSessionIds = [...failedSessionIds, sessionId];
        cache = null;
      }
    }
    if (!value) {
      return { found: false, currentModel: "unknown", currentProvider: "unknown", cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } };
    }
    return {
      found: true,
      currentModel: value.currentModel,
      currentProvider: value.currentProvider,
      cost: value.costTotals,
      models: sessionModels(value),
      totals: {
        ...value.totals,
        total: value.totals.input + value.totals.output + value.totals.cacheRead + value.totals.cacheWrite
      }
    };
  }
  const PAGE_SIZE = 10;
  let billingSnapshot = { ...DEFAULT_BILLING_SETTINGS };
  billingStore.load().then((s) => {
    billingSnapshot = s;
  }).catch(() => {
  });
  const sortOf = (payload) => payload?.sort ?? "tokens";
  async function sessionsMore(payload) {
    const offset = Math.max(0, payload?.offset ?? 0);
    const sort = sortOf(payload);
    const ranked = rankSessionsBy(sessionIndex, sort, billingSnapshot.prices, billingSnapshot.peakValleyEnabled);
    const { rows, hasMore } = pageOf(ranked, offset, PAGE_SIZE);
    const titles = /* @__PURE__ */ new Map();
    await Promise.all(
      rows.map(async (s) => {
        try {
          const t = await sq.readTitle(s.id);
          titles.set(s.id, t ? t.title : null);
        } catch {
          titles.set(s.id, null);
        }
      })
    );
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        title: titles.get(s.id) ?? null,
        totals: s.totals,
        lastActive: s.lastActive,
        depth: s.depth,
        models: s.models
      })),
      hasMore
    };
  }
  async function projectsMore(payload) {
    const offset = Math.max(0, payload?.offset ?? 0);
    const all = projectRowsOf(sessionIndex, sortOf(payload), billingSnapshot.prices, billingSnapshot.peakValleyEnabled);
    const { rows, hasMore } = pageOf(all, offset, PAGE_SIZE);
    return { rows, hasMore };
  }
  async function repairSession(payload) {
    const sessionId = payload.sessionId;
    if (!sessionId || !/^(?:session-)?[0-9a-f-]+$/i.test(sessionId)) {
      throw new Error("invalid session id");
    }
    const codec = await runtimeCodec();
    const outcome = await repairSessionLog(resolveDshHome(), sessionId, codec.decode);
    failedSessionIds = failedSessionIds.filter((id) => id !== sessionId);
    cache = null;
    aggregate = null;
    ledgerIds = /* @__PURE__ */ new Set();
    if (statsCache !== null) {
      await statsCache.ledgerDelete(sessionId);
    }
    return outcome;
  }
  async function billingModels() {
    const options = /* @__PURE__ */ new Map();
    const ensure = (provider, providerName) => {
      let option = options.get(provider);
      if (option === void 0) {
        option = { provider, providerName, models: [] };
        options.set(provider, option);
      }
      return option;
    };
    let providers = [];
    if (llm) {
      try {
        providers = await withTimeout(Promise.resolve(llm.listProviders()), 2e3, "provider directory");
      } catch (err) {
        logFailure("billing.models listProviders failed/slow: " + String(err?.message ?? err));
      }
    }
    for (const p of providers) {
      const option = ensure(p.id, p.name || p.id);
      if (isDeepSeekProvider(p.id)) {
        for (const entry of DEEPSEEK_OFFICIAL_PRICES) {
          if (!option.models.includes(entry.model)) option.models.push(entry.model);
        }
      }
    }
    if (llm && typeof llm.listModels === "function") {
      await Promise.all(
        providers.map(async (p) => {
          try {
            const infos = await withTimeout(Promise.resolve(llm.listModels(p.id)), 2e3, "adapter models for " + p.id);
            const option = ensure(p.id, p.name || p.id);
            for (const info of infos) {
              if (info && info.id && !option.models.includes(info.id)) option.models.push(info.id);
            }
          } catch {
          }
        })
      );
    }
    if (cache) {
      for (const session of cache.payload.topSessions) {
        for (const row of session.models) {
          const provider = row.provider === "unknown" ? "(unknown)" : row.provider;
          const option = ensure(provider, provider);
          if (!option.models.includes(row.model)) option.models.push(row.model);
        }
      }
    }
    return { options: [...options.values()] };
  }
  const disposeRpc = connection && connection.rpc.handle(
    RPC_CHANNEL,
    (endpoint, payload) => {
      if (endpoint === RPC_OVERVIEW) {
        return overview(payload).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_GET) {
        return billingStore.load().then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_SET) {
        return billingStore.save(payload ?? { ...DEFAULT_BILLING_SETTINGS }).then(
          (value) => {
            billingSnapshot = value;
            return { ok: true, value };
          },
          (err) => ({
            ok: false,
            error: {
              code: "bad-request",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_MODELS) {
        return billingModels().then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_SESSION_COST) {
        return sessionCost(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_SESSIONS_MORE) {
        return sessionsMore(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_PROJECTS_MORE) {
        return projectsMore(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_REPAIR_SESSION) {
        return repairSession(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      return Promise.resolve({
        ok: false,
        error: { code: "bad-request", message: "unknown endpoint: " + String(endpoint), details: { issues: [] } }
      });
    },
    { authority: "loopback" }
  );
  startScan().then((o) => {
    console.log(
      tag,
      "first scan done:",
      "mode=" + o.coverage.mode,
      "sessions=" + o.coverage.sessionsTotal + "/" + o.coverage.sessionsOk + " (failed " + o.coverage.sessionsFailed + ", pending " + o.coverage.sessionsPending + ")",
      "withUsage=" + o.allTime.sessionCount,
      "dataRange=" + (o.coverage.from === null ? "-" : new Date(o.coverage.from).toISOString()) + ".." + (o.coverage.to === null ? "-" : new Date(o.coverage.to).toISOString())
    );
  });
  const stopTimer = ctx.interval(() => {
    if (!inflight) startScan();
  }, RESCAN_MS);
  ctx.effect(() => () => {
    disposed = true;
    if (disposeUnit) disposeUnit();
    if (stopTimer) stopTimer();
    if (disposeRpc) disposeRpc();
  });
}
export {
  apply,
  inject,
  name
};
