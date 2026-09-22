// Host-side i18n for dsh-im. Mirrors the conventions of the settings-UI
// translator in plugin-src/client/i18n.js: dictionary keys are the exact
// Chinese source literals, and Chinese (zh) is the identity default, so
// untranslated or unrecognized text always falls back to the original
// Chinese output unchanged.
//
// The English dictionary lives in ./i18n-en.mjs to keep this module small.

import { EN } from './i18n-en.mjs';

let language = 'zh';

// Accepts 'en', 'en-US', 'english' (any case) as English; anything else
// (including undefined and unrecognized values) selects Chinese.
export function setImHostLanguage(lang) {
  const normalized = typeof lang === 'string' ? lang.trim().toLowerCase() : '';
  language = normalized === 'english' || /^en(?:[-_].*)?$/u.test(normalized) ? 'en' : 'zh';
}

export function getImHostLanguage() {
  return language;
}

// Translate a user-facing Chinese literal. In zh mode (the default) this is
// the identity function. Optional `params` fills `{name}` placeholders in
// both the Chinese key and its translation, e.g.
//   t('共 {count} 个机器人', { count: 3 })
export function t(text, params) {
  if (typeof text !== 'string') return text;
  const translated = language === 'en' ? EN[text] ?? text : text;
  if (params == null) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
