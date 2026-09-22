'use strict';

// Dialogue store + renderer for the desktop pet. The line library is data,
// not code: dialogue/whale.json holds every built-in line, this module
// only loads, validates, merges, resolves and renders. Template rendering is
// a port of the reference project's pet/persona_phrases.py render_template:
// placeholders resolve through mapping keys and list indexes ONLY, unknown
// or malformed placeholders stay verbatim, and `autohide` roots disappear
// cleanly when their value is missing/None/empty.
var PetDialogue = (function () {
  const MAX_LINE_CHARS = 240; // reference convention: _clean_preset_events
  const MAX_USER_VARIANTS = 8; // per category, user-supplied layers only
  const FORBIDDEN_ROOTS = new Set(['__proto__', 'constructor', 'prototype']);
  // {field}, {field.sub-key}, {field[0]}, {field['k']} — nothing else.
  const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_-]*|\[[^\]]+\])*$/;
  // [[fill]align][sign][0][width][.precision][type] — the common subset of
  // Python's format-spec grammar; anything outside it stays verbatim.
  const FORMAT_SPEC_RE = /^(?:([\s\S])([<>=^])|([<>=^]))?([+\- ])?(0)?(\d+)?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/;
  const INTEGER_TYPES = new Set(['b', 'c', 'd', 'n', 'o', 'x', 'X']);
  const NUMERIC_TYPES = new Set(['b', 'c', 'd', 'e', 'E', 'f', 'F', 'g', 'G', 'n', 'o', 'x', 'X', '%']);

  function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function warn(...args) {
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn(...args);
    }
  }

  function emptyStore() {
    return { _meta: null, global: {}, agents: {}, idleTopics: [], timeOfDay: {} };
  }

  let currentStore = emptyStore();

  function getStore() {
    return currentStore;
  }

  // ── store loading / sanitizing ──
  // Built-in layer: authored data is kept VERBATIM (no trim/truncate/cap);
  // only non-strings, blank lines, and emptied categories are dropped.
  function cleanBuiltinCategories(raw) {
    const out = {};
    if (!isObject(raw)) {
      return out;
    }
    for (const key of Object.keys(raw)) {
      const name = String(key).trim();
      if (!name) {
        continue;
      }
      const value = raw[key];
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list)) {
        continue;
      }
      const lines = list.filter((item) => typeof item === 'string' && item.trim().length > 0);
      if (lines.length) {
        out[name] = lines;
      }
    }
    return out;
  }

  // User layer mirrors the reference _clean_preset_events: strings only,
  // trimmed, <=240 chars, <=8 variants per category. Unknown categories are
  // allowed through — they only matter if the caller ever says() them.
  function cleanUserCategories(raw) {
    const out = {};
    if (!isObject(raw)) {
      return out;
    }
    for (const key of Object.keys(raw)) {
      const name = String(key).trim();
      if (!name) {
        continue;
      }
      const value = raw[key];
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list)) {
        continue;
      }
      const lines = [];
      for (const item of list) {
        if (typeof item === 'string' && item.trim().length > 0) {
          lines.push(item.trim().slice(0, MAX_LINE_CHARS));
        }
      }
      if (lines.length) {
        out[name] = lines.slice(0, MAX_USER_VARIANTS);
      }
    }
    return out;
  }

  function sanitizeStore(raw) {
    const next = emptyStore();
    if (!isObject(raw)) {
      return next;
    }
    if (isObject(raw._meta)) {
      next._meta = raw._meta;
    }
    next.global = cleanBuiltinCategories(raw.global);
    if (isObject(raw.agents)) {
      for (const agent of Object.keys(raw.agents)) {
        const name = String(agent).trim();
        if (!name) {
          continue;
        }
        const cats = cleanBuiltinCategories(raw.agents[agent]);
        if (Object.keys(cats).length) {
          next.agents[name] = cats;
        }
      }
    }
    if (Array.isArray(raw.idleTopics)) {
      next.idleTopics = raw.idleTopics.filter((t) => typeof t === 'string' && t.length > 0);
    }
    if (isObject(raw.timeOfDay)) {
      const ranges = {};
      for (const cat of Object.keys(raw.timeOfDay)) {
        const r = raw.timeOfDay[cat];
        if (Array.isArray(r) && r.length === 2
          && Number.isFinite(r[0]) && Number.isFinite(r[1])) {
          ranges[cat] = [r[0], r[1]];
        }
      }
      next.timeOfDay = ranges;
    }
    return next;
  }

  async function load(baseUrl) {
    const url = `${baseUrl || ''}dialogue/whale.json`;
    try {
      const res = await fetch(url);
      if (!res || !res.ok) {
        throw new Error(`HTTP ${res ? res.status : 'no response'}`);
      }
      currentStore = sanitizeStore(await res.json());
    } catch (error) {
      warn('pet-dialogue: failed to load', url, error);
      currentStore = emptyStore();
    }
    return currentStore;
  }

  // Merge a user-supplied preset OVER the builtin store, per category: a
  // user array replaces the builtin array for that category (never concat).
  // `{global, agents}` shape; a bare `{category: [...]}` map is treated as
  // the global layer, matching the reference's flat-legacy fallback.
  function loadUserOverrides(jsonObj) {
    if (!isObject(jsonObj)) {
      return currentStore;
    }
    const hasLayers = hasOwn(jsonObj, 'global') || hasOwn(jsonObj, 'agents');
    const globalRaw = hasLayers ? jsonObj.global : jsonObj;
    const cleanedGlobal = cleanUserCategories(globalRaw);
    for (const cat of Object.keys(cleanedGlobal)) {
      currentStore.global[cat] = cleanedGlobal[cat];
    }
    if (isObject(jsonObj.agents)) {
      for (const agent of Object.keys(jsonObj.agents)) {
        const name = String(agent).trim();
        if (!name) {
          continue;
        }
        const cats = cleanUserCategories(jsonObj.agents[agent]);
        if (!Object.keys(cats).length) {
          continue;
        }
        if (!isObject(currentStore.agents[name])) {
          currentStore.agents[name] = {};
        }
        for (const cat of Object.keys(cats)) {
          currentStore.agents[name][cat] = cats[cat];
        }
      }
    }
    return currentStore;
  }

  // ── template rendering (port of persona_phrases.render_template) ──
  function wrapValues(values) {
    // Mirror _template_values: payload fields surface at top level and under
    // the `payload`/`data` aliases; explicit top-level keys always win.
    const result = {};
    if (!isObject(values)) {
      return result;
    }
    for (const key of Object.keys(values)) {
      result[key] = values[key];
    }
    const payload = values.payload;
    if (isObject(payload)) {
      for (const key of Object.keys(payload)) {
        if (!hasOwn(result, key)) {
          result[key] = payload[key];
        }
      }
      if (!hasOwn(result, 'payload')) {
        result.payload = payload;
      }
      if (!hasOwn(result, 'data')) {
        result.data = payload;
      }
    }
    return result;
  }

  function resolutionError(what) {
    const err = new Error(`pet-dialogue: unresolved template field ${what}`);
    err.name = 'TemplateResolutionError';
    return err;
  }

  // Resolve ONLY mapping keys and numeric list indexes along a whitelisted
  // path — never arbitrary property access. Throws on any miss; the caller
  // decides between verbatim re-emit and autohide.
  function safeGetField(fieldName, values) {
    if (typeof fieldName !== 'string' || !FIELD_PATH_RE.test(fieldName)) {
      throw resolutionError(JSON.stringify(fieldName));
    }
    const dot = fieldName.indexOf('.');
    const bracket = fieldName.indexOf('[');
    const ends = [dot, bracket].filter((p) => p >= 0);
    const root = ends.length ? fieldName.slice(0, Math.min(...ends)) : fieldName;
    if (FORBIDDEN_ROOTS.has(root) || !hasOwn(values, root)) {
      throw resolutionError(root);
    }
    let current = values[root];
    let rest = fieldName.slice(root.length);
    while (rest) {
      if (rest[0] === '.') {
        let end = rest.length;
        for (const marker of ['.', '[']) {
          const pos = rest.indexOf(marker, 1);
          if (pos >= 0 && pos < end) {
            end = pos;
          }
        }
        const key = rest.slice(1, end);
        if (FORBIDDEN_ROOTS.has(key) || !isObject(current) || !hasOwn(current, key)) {
          throw resolutionError(key);
        }
        current = current[key];
        rest = rest.slice(end);
      } else if (rest[0] === '[') {
        const end = rest.indexOf(']', 1);
        const token = rest.slice(1, end);
        if (/^[0-9]+$/.test(token)) {
          if (!Array.isArray(current)) {
            throw resolutionError(`[${token}]`);
          }
          const index = parseInt(token, 10);
          if (index >= current.length) {
            throw resolutionError(`[${token}]`);
          }
          current = current[index];
        } else {
          const key = token.replace(/^['"]+|['"]+$/g, '');
          if (FORBIDDEN_ROOTS.has(key) || !isObject(current) || !hasOwn(current, key)) {
            throw resolutionError(token);
          }
          current = current[key];
        }
        rest = rest.slice(end + 1);
      } else {
        throw resolutionError(fieldName);
      }
    }
    return current;
  }

  // Split a replacement field into name / !conversion / :spec. A top-level
  // ':' ends scanning; '!' and ':' inside nested braces (format-spec
  // replacement fields like {x:>{w}}) are not separators.
  function splitField(text) {
    let bang = -1;
    let colon = -1;
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (depth === 0) {
        if (c === '!' && bang < 0) {
          bang = i;
        } else if (c === ':') {
          colon = i;
          break;
        }
      }
    }
    const cut = bang >= 0 && (colon < 0 || bang < colon) ? bang : colon;
    if (cut < 0) {
      return { name: text, conv: '', spec: '' };
    }
    const name = text.slice(0, cut);
    if (text[cut] === '!') {
      const rest = text.slice(cut + 1);
      const ci = rest.indexOf(':');
      return ci < 0
        ? { name, conv: rest, spec: '' }
        : { name, conv: rest.slice(0, ci), spec: rest.slice(ci + 1) };
    }
    return { name, conv: '', spec: text.slice(cut + 1) };
  }

  // Scanner equivalent of string.Formatter.parse: yields literal runs and
  // raw replacement-field texts. '{{' and '}}' collapse to literal braces;
  // an unmatched brace throws (render_template then returns the template
  // verbatim).
  function parseTemplate(template) {
    const parts = [];
    let i = 0;
    let start = 0;
    const n = template.length;
    while (i < n) {
      const c = template[i];
      if (c === '{') {
        if (template[i + 1] === '{') {
          if (i > start) {
            parts.push({ lit: template.slice(start, i) });
          }
          parts.push({ lit: '{' });
          i += 2;
          start = i;
          continue;
        }
        let depth = 1;
        let j = i + 1;
        while (j < n && depth > 0) {
          if (template[j] === '{') {
            depth += 1;
          } else if (template[j] === '}') {
            depth -= 1;
          }
          if (depth > 0) {
            j += 1;
          }
        }
        if (depth > 0) {
          throw new Error('pet-dialogue: unmatched { in template');
        }
        if (i > start) {
          parts.push({ lit: template.slice(start, i) });
        }
        parts.push({ field: template.slice(i + 1, j) });
        i = j + 1;
        start = i;
      } else if (c === '}') {
        if (template[i + 1] === '}') {
          if (i > start) {
            parts.push({ lit: template.slice(start, i) });
          }
          parts.push({ lit: '}' });
          i += 2;
          start = i;
          continue;
        }
        throw new Error('pet-dialogue: unmatched } in template');
      } else {
        i += 1;
      }
    }
    if (start < n) {
      parts.push({ lit: template.slice(start) });
    }
    return parts;
  }

  function pyStr(v) {
    if (v === null || v === undefined) {
      return 'None';
    }
    if (v === true) {
      return 'True';
    }
    if (v === false) {
      return 'False';
    }
    if (typeof v === 'string') {
      return v;
    }
    return String(v);
  }

  function pyRepr(v) {
    if (typeof v === 'string') {
      const escaped = (quote) => v
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .split(quote).join(`\\${quote}`);
      if (!v.includes("'")) {
        return `'${escaped("'")}'`;
      }
      if (!v.includes('"')) {
        return `"${escaped('"')}"`;
      }
      return `'${escaped("'")}'`;
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) {
      return pyStr(v);
    }
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  function pyAscii(v) {
    return pyRepr(v).replace(/[^\x00-\x7F]/g, (ch) => {
      const cp = ch.codePointAt(0);
      if (cp <= 0xff) {
        return `\\x${cp.toString(16).padStart(2, '0')}`;
      }
      if (cp <= 0xffff) {
        return `\\u${cp.toString(16).padStart(4, '0')}`;
      }
      return `\\U${cp.toString(16).padStart(8, '0')}`;
    });
  }

  function applyConversion(value, conv) {
    if (conv === 's') {
      return pyStr(value);
    }
    if (conv === 'r') {
      return pyRepr(value);
    }
    if (conv === 'a') {
      return pyAscii(value);
    }
    throw resolutionError(`!${conv}`);
  }

  function formatWithSpec(value, spec) {
    if (spec === '') {
      return pyStr(value);
    }
    const m = FORMAT_SPEC_RE.exec(spec);
    if (!m) {
      throw resolutionError(`:${spec}`);
    }
    const align = m[2] || m[3] || '';
    const fill = m[1] !== undefined ? m[1] : (m[5] ? '0' : ' ');
    const sign = m[4] || '';
    const zeroPad = m[5] === '0';
    const width = m[6] ? parseInt(m[6], 10) : 0;
    const precision = m[7] !== undefined ? parseInt(m[7], 10) : null;
    const type = m[8] || '';

    let out;
    let signStr = '';
    if (type === '' || type === 's') {
      if (type === 's' && typeof value !== 'string') {
        throw resolutionError(`:${spec}`);
      }
      if (align === '=') {
        throw resolutionError(`:${spec}`);
      }
      out = pyStr(value);
      if (precision !== null) {
        out = out.slice(0, precision);
      }
    } else {
      if (!NUMERIC_TYPES.has(type) || typeof value !== 'number' || !Number.isFinite(value)) {
        throw resolutionError(`:${spec}`);
      }
      if (INTEGER_TYPES.has(type) && !Number.isInteger(value)) {
        throw resolutionError(`:${spec}`);
      }
      const negative = value < 0 || Object.is(value, -0);
      const mag = Math.abs(value);
      let body;
      switch (type) {
        case 'b': body = mag.toString(2); break;
        case 'o': body = mag.toString(8); break;
        case 'x': body = mag.toString(16); break;
        case 'X': body = mag.toString(16).toUpperCase(); break;
        case 'c': body = String.fromCodePoint(value); break;
        case 'e': case 'E': {
          body = mag.toExponential(precision === null ? 6 : precision);
          body = body.replace(/e([+-])(\d)$/, 'e$10$2'); // Python pads exponents to 2 digits
          if (type === 'E') {
            body = body.toUpperCase();
          }
          break;
        }
        case 'f': case 'F': body = mag.toFixed(precision === null ? 6 : precision); break;
        case 'g': case 'G': {
          body = mag.toPrecision(precision === null ? 6 : precision);
          if (body.includes('e')) {
            body = body.replace(/e([+-])(\d)$/, 'e$10$2');
          }
          if (type === 'G') {
            body = body.toUpperCase();
          }
          break;
        }
        case '%': body = `${(mag * 100).toFixed(precision === null ? 6 : precision)}%`; break;
        default: body = String(mag); break; // d, n
      }
      signStr = negative ? '-' : (sign === '+' ? '+' : sign === ' ' ? ' ' : '');
      out = signStr + body;
    }

    if (out.length < width) {
      const padCount = width - out.length;
      const pad = fill.repeat(padCount);
      const effectiveAlign = align || (zeroPad ? '=' : (type === '' || type === 's' ? '<' : '>'));
      if (effectiveAlign === '<') {
        out += pad;
      } else if (effectiveAlign === '^') {
        const left = Math.floor(padCount / 2);
        out = fill.repeat(left) + out + fill.repeat(padCount - left);
      } else if (effectiveAlign === '=') {
        out = signStr + pad + out.slice(signStr.length);
      } else {
        out = pad + out;
      }
    }
    return out;
  }

  function renderTemplate(template, values, autohide) {
    const wrapped = wrapValues(values);
    const hideSet = autohide instanceof Set ? autohide : new Set(autohide || []);
    const str = String(template);
    let parts;
    try {
      parts = parseTemplate(str);
    } catch (e) {
      return str; // unmatched brace: Python returns str(template) verbatim
    }
    const output = [];
    let hidAny = false;
    for (const part of parts) {
      if (part.field === undefined) {
        output.push(part.lit);
        continue;
      }
      const { name, conv, spec } = splitField(part.field);
      const root = name.split(/[.\[]/, 1)[0];
      const doHide = hideSet.has(root);
      try {
        let obj = safeGetField(name, wrapped);
        if (doHide && (obj === null || obj === undefined || obj === '')) {
          hidAny = true;
          continue;
        }
        if (conv) {
          obj = applyConversion(obj, conv);
        }
        output.push(formatWithSpec(obj, spec));
      } catch (e) {
        if (doHide) {
          hidAny = true;
          continue;
        }
        output.push(`{${part.field}}`);
      }
    }
    let text = output.join('');
    if (hidAny) {
      // Reference cleanup: drop `` and empty （）/() shells, collapse runs of
      // spaces, trim. Runs collapse BEFORE shells so '（  ）' still empties.
      text = text.replace(/``/g, '');
      text = text.replace(/ {2,}/g, ' ');
      text = text.replace(/（ ）|（）|\( \)|\(\)/g, '');
      text = text.replace(/ {2,}/g, ' ');
      text = text.trim();
    }
    return text;
  }

  // ── layered phrase resolution (port of persona_phrases.phrase_for_agent) ──
  // agents[agentKey][key] -> global[key] -> undefined. An empty agentKey
  // skips the agents layer. A preset with neither `global` nor `agents` keys
  // is treated as a flat legacy map equal to the global layer.
  function phraseForAgent(phrases, agentKey, key) {
    if (!isObject(phrases)) {
      return undefined;
    }
    const globalPart = isObject(phrases.global) ? phrases.global : null;
    if (agentKey) {
      const agents = isObject(phrases.agents) ? phrases.agents : null;
      if (agents && hasOwn(agents, agentKey)) {
        const agentPhrases = agents[agentKey];
        if (isObject(agentPhrases) && hasOwn(agentPhrases, key)) {
          return agentPhrases[key];
        }
      }
    }
    if (globalPart) {
      return hasOwn(globalPart, key) ? globalPart[key] : undefined;
    }
    if (!hasOwn(phrases, 'global') && !hasOwn(phrases, 'agents')) {
      return hasOwn(phrases, key) ? phrases[key] : undefined;
    }
    return undefined;
  }

  // ── shuffle-bag sayer (mirrors the original say() in pet-live2d.js) ──
  // Per-category bag of pool indexes, Fisher-Yates shuffled, popped from the
  // end; on reshuffle, if the next-to-pop index equals the last-said one it
  // is swapped with the far end so a line never repeats across the boundary.
  // `storeOrGetter` may be a store object or a zero-arg function returning
  // one (so a sayer built before load() still follows the live store).
  // `agentKeyGetter` is a zero-arg function returning the active persona
  // layer (whale.json `agents` key): the personality resolves
  // agents[persona][category] first and falls back to global[category].
  // Shuffle bags are keyed `persona:category` so switching personas never
  // crosses bags.
  function createSayer(storeOrGetter, rng, agentKeyGetter) {
    const rand = typeof rng === 'function' ? rng : Math.random;
    const bags = new Map();
    const lastSaid = new Map();
    const resolve = () => {
      const s = typeof storeOrGetter === 'function' ? storeOrGetter() : storeOrGetter;
      return s || currentStore;
    };
    const agentKey = () => (typeof agentKeyGetter === 'function' ? (agentKeyGetter() || '') : '');
    return function say(category, values, autohide) {
      const key = agentKey();
      const pool = phraseForAgent(resolve(), key, category);
      if (!Array.isArray(pool) || !pool.length) {
        return null;
      }
      const bagKey = `${key}:${category}`;
      let bag = bags.get(bagKey);
      if (!bag || !bag.length) {
        bag = pool.map((_, index) => index);
        for (let j = bag.length - 1; j > 0; j -= 1) {
          const k = Math.floor(rand() * (j + 1));
          const t = bag[j];
          bag[j] = bag[k];
          bag[k] = t;
        }
        if (bag.length > 1 && bag[bag.length - 1] === lastSaid.get(bagKey)) {
          const t = bag[0];
          bag[0] = bag[bag.length - 1];
          bag[bag.length - 1] = t;
        }
        bags.set(bagKey, bag);
      }
      const i = bag.pop();
      lastSaid.set(bagKey, i);
      const line = pool[i];
      return renderTemplate(typeof line === 'string' ? line : String(line), values, autohide);
    };
  }

  // Resolve which time-of-day category an hour falls into. Ranges are
  // [startHour, endHour) local time and may wrap past midnight.
  function categoryForHour(hour, ranges) {
    const map = isObject(ranges) ? ranges : currentStore.timeOfDay;
    for (const cat of Object.keys(map)) {
      const r = map[cat];
      if (!Array.isArray(r) || r.length < 2) {
        continue;
      }
      const [start, end] = r;
      if (start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end)) {
        return cat;
      }
    }
    return undefined;
  }

  return {
    load,
    loadUserOverrides,
    getStore,
    emptyStore,
    renderTemplate,
    phraseForAgent,
    createSayer,
    categoryForHour,
    MAX_LINE_CHARS,
    MAX_USER_VARIANTS,
  };
})();

if (typeof window !== 'undefined') {
  window.PetDialogue = PetDialogue;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PetDialogue;
}
