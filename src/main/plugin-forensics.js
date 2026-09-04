'use strict';

const { OFFICIAL_TEMPLATE_BUNDLES } = require('./plugins');
const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');
const { DSH_IM_ALIASES } = require('./dsh-im-desktop');
const { USAGE_PANEL_ALIASES } = require('./usage-panel-preset');

const GENERIC_OOM = /heap out of memory|js heap|allocation failed|oom\b/i;
const GENERIC_PORT = /eaddrinuse|address already in use/i;
const GENERIC_NODE = /node['"]?\s+is not recognized|cannot find node|enoent.*node(\.exe)?\b/i;

const EVIDENCE_PATTERNS = [
  { kind: 'bundle', regex: /cannot resolve profile bundle ['"]([^'"]+)['"]/gi },
  { kind: 'package', regex: /cannot find package ['"]([^'"]+)['"]/gi },
  { kind: 'module', regex: /err_module_not_found[^\n'"]*['"]([^'"]+)['"]/gi },
  { kind: 'compose', regex: /failed to compose[^\n]*['"](@?[\w./-]+)['"]/gi },
];

// Preset plugins stay here to block `shell:remove-plugin` on a same-named
// profile row (the built-in itself never appears in the profile list — it
// mounts via the desktop overlay). dsh-usage-panel and dsh-im are both
// desktop built-in modules now (not disableable), but the `preset` marker
// only gates removal; disable is blocked separately via IPC and config
// alias-stripping.
const PRESET_PLUGINS = new Set(['dsh-usage-panel', '@xmanrui/dsh-im', 'dsh-im', 'xmanrui-dsh-im']);
const EVIDENCE_LINE_MAX = 240;

// In-box names cover the harness fork packages plus the desktop built-in
// modules (dsh-im and dsh-usage-panel, both overlay-mounted from vendor):
// breakage in either is desktop runtime damage — disable and
// skip-user-plugins cannot repair it.
const IN_BOX_PACKAGE_NAMES = new Set([
  ...DESKTOP_PACKAGES.map((pkg) => pkg.name),
  ...DSH_IM_ALIASES,
  ...USAGE_PANEL_ALIASES,
]);

/**
 * A suspect that names an in-box desktop package (exactly or via a subpath
 * specifier like `@scope/pkg/client`) is desktop runtime damage, not a user
 * plugin: disabling plugins or skipping the user layer cannot repair it.
 * The desktop install overlay mounts a file:// insert from
 * `desktop-plugins/install-dsh-plugin`; a compose failure there surfaces the
 * path, not a package name, so the path marker is matched too.
 * @param {string} name
 * @returns {boolean}
 */
function isInBoxPackageName(name) {
  const text = String(name || '');
  if (IN_BOX_PACKAGE_NAMES.has(text)) {
    return true;
  }
  if (text.replace(/\\/g, '/').includes('desktop-plugins/install-dsh-plugin')) {
    return true;
  }
  for (const pkg of IN_BOX_PACKAGE_NAMES) {
    if (text.startsWith(`${pkg}/`)) {
      return true;
    }
  }
  return false;
}

function classifyGenericFailure(text) {
  const blob = String(text || '');
  if (GENERIC_OOM.test(blob)) return 'oom';
  if (GENERIC_PORT.test(blob)) return 'port-in-use';
  if (GENERIC_NODE.test(blob)) return 'missing-node';
  return '';
}

function collectMatches(regex, text) {
  const names = [];
  const blob = String(text || '');
  regex.lastIndex = 0;
  let match = regex.exec(blob);
  while (match) {
    if (match[1]) names.push(match[1]);
    match = regex.exec(blob);
  }
  return names;
}

function extractSuspectNames(text) {
  const names = [];
  for (const { regex } of EVIDENCE_PATTERNS) {
    names.push(...collectMatches(regex, text));
  }
  return [...new Set(names)];
}

function truncateLine(line) {
  const text = String(line || '').trim();
  if (text.length <= EVIDENCE_LINE_MAX) {
    return text;
  }
  return `${text.slice(0, EVIDENCE_LINE_MAX - 1)}…`;
}

/**
 * @param {string} corpus
 * @returns {Array<{ name: string, line: string }>}
 */
function extractEvidence(corpus) {
  const blob = String(corpus || '');
  const lines = blob.split('\n');
  const evidence = [];
  const seen = new Set();
  for (const rawLine of lines) {
    for (const { regex } of EVIDENCE_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(rawLine);
      while (match) {
        const name = match[1];
        const key = `${name}\0${rawLine}`;
        if (name && !seen.has(key)) {
          seen.add(key);
          evidence.push({ name, line: truncateLine(rawLine) });
        }
        match = regex.exec(rawLine);
      }
    }
  }
  return evidence;
}

function buildForensicsSummary(forensics) {
  if (!forensics || typeof forensics !== 'object') {
    return {
      genericCause: null,
      suspectCount: 0,
      pluginTreeFailure: false,
      hasOrphans: false,
    };
  }
  const suspects = Array.isArray(forensics.suspects) ? forensics.suspects : [];
  const orphans = Array.isArray(forensics.orphanSuspects) ? forensics.orphanSuspects : [];
  return {
    genericCause: forensics.genericCause || null,
    suspectCount: suspects.length + orphans.length,
    pluginTreeFailure: Boolean(forensics.pluginTreeFailure),
    hasOrphans: orphans.length > 0,
    desktopRuntimeDamage: Boolean(forensics.desktopRuntimeDamage),
  };
}

function inspectPlugins({
  logs,
  lastStartError,
  pluginTreeFailure,
  recovery,
  plugins,
  bundles,
  disabledPlugins,
} = {}) {
  const logText = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
  const corpus = [logText, lastStartError].filter(Boolean).join('\n');
  const genericCause = classifyGenericFailure(corpus);
  const suspects = genericCause ? [] : extractSuspectNames(corpus);
  const suspectSet = new Set(suspects);
  const disabled = new Set(Array.isArray(disabledPlugins) ? disabledPlugins : []);
  const bundleSet = new Set(Array.isArray(bundles) ? bundles : []);
  const pluginNames = new Set((plugins || []).map((row) => row.name || row));
  const rows = (plugins || []).map((row) => {
    const name = row.name || row;
    return {
      name,
      spec: row.spec || '',
      bundle: bundleSet.has(name) || row.bundle === true,
      preset: PRESET_PLUGINS.has(name),
      officialTemplate: OFFICIAL_TEMPLATE_BUNDLES.has(name),
      disabled: disabled.has(name) || row.disabled === true,
      suspect: suspectSet.has(name),
      orphan: false,
    };
  });
  const orphanSuspects = suspects
    .filter((name) => !pluginNames.has(name))
    .map((name) => ({
      name,
      spec: '',
      bundle: false,
      preset: PRESET_PLUGINS.has(name),
      officialTemplate: OFFICIAL_TEMPLATE_BUNDLES.has(name),
      disabled: disabled.has(name),
      suspect: true,
      orphan: true,
      // Only names ABSENT from the profile can be in-box damage: a user
      // plugin that shadows an in-box name stays a normal disableable row.
      inBox: isInBoxPackageName(name),
    }));
  const evidence = extractEvidence(corpus);
  const payload = {
    genericCause: genericCause || null,
    desktopRuntimeDamage: orphanSuspects.some((row) => row.inBox),
    pluginTreeFailure: Boolean(pluginTreeFailure),
    recovery: recovery && typeof recovery === 'object'
      ? {
          skipUserPlugins: recovery.skipUserPlugins === true,
          reason: typeof recovery.reason === 'string' ? recovery.reason : '',
          at: typeof recovery.at === 'string' ? recovery.at : '',
          appVersion: typeof recovery.appVersion === 'string' ? recovery.appVersion : '',
        }
      : { skipUserPlugins: false, reason: '', at: '', appVersion: '' },
    suspects: suspects.map((name) => ({ name })),
    orphanSuspects,
    evidence,
    plugins: rows,
  };
  payload.summary = buildForensicsSummary(payload);
  return payload;
}

function isPresetPlugin(name) {
  return PRESET_PLUGINS.has(String(name || ''));
}

module.exports = {
  PRESET_PLUGINS,
  EVIDENCE_LINE_MAX,
  classifyGenericFailure,
  extractSuspectNames,
  extractEvidence,
  buildForensicsSummary,
  inspectPlugins,
  isPresetPlugin,
  isInBoxPackageName,
};
