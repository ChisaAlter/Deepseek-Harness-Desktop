'use strict';

const GENERIC_LABELS = {
  'session-cache': '历史会话缓存格式不兼容，导致内核启动失败。跳过用户插件无法修复；请更新到包含缓存兼容修复的桌面版本，并保留日志。不要删除原始会话或清空历史数据。',
  oom: '检测到内存不足（OOM），与单个插件无关。',
  'port-in-use': '检测到端口被占用，与单个插件无关。',
  'missing-node': '未找到 Node 运行时，与单个插件无关。',
};

const PLUGIN_ERROR_LABELS = {
  preset: '桌面预置插件不可移除。',
  'official-template': '官方模板插件不可禁用。',
  'desktop-builtin': '桌面内置组件不可禁用。',
  'missing-name': '缺少插件名称。',
};

/**
 * @param {string} code
 * @returns {string}
 */
function pluginErrorLabel(code) {
  return PLUGIN_ERROR_LABELS[code] || code || '操作失败';
}

/**
 * @param {{ ok?: boolean|null, error?: string }|null|undefined} lastStart
 * @param {{ skipUserPlugins?: boolean }|null|undefined} recovery
 * @param {{ genericCause?: string|null, suspects?: Array<{name:string}>, pluginTreeFailure?: boolean }|null|undefined} forensics
 * @param {{ state?: string }|null|undefined} desktop
 * @returns {boolean}
 */
function shouldShowRecovery(lastStart, recovery, forensics, desktop) {
  if (recovery?.skipUserPlugins) {
    return true;
  }
  if (lastStart?.ok === false) {
    return true;
  }
  if (desktop?.state === 'error') {
    return true;
  }
  if (!forensics) {
    return false;
  }
  if (forensics.genericCause) {
    return true;
  }
  if (forensics.pluginTreeFailure) {
    return true;
  }
  return Array.isArray(forensics.suspects) && forensics.suspects.length > 0;
}

/**
 * @param {{ desktopRuntimeDamage?: boolean, orphanSuspects?: Array<{name:string, inBox?:boolean}> }|null|undefined} forensics
 * @returns {string}
 */
function desktopRuntimeDamageVerdict(forensics) {
  const names = (forensics?.orphanSuspects || [])
    .filter((row) => row.inBox)
    .map((row) => row.name)
    .join('、');
  return `检测到桌面内置组件损坏${names ? `：${names}` : ''}。禁用插件或跳过用户插件都无法修复；请重新安装桌面端安装包（源码运行则执行 npm run setup:harness）。`;
}

/**
 * @param {{ ok?: boolean|null, error?: string }|null|undefined} lastStart
 * @param {{ skipUserPlugins?: boolean, reason?: string }|null|undefined} recovery
 * @param {{ genericCause?: string|null, desktopRuntimeDamage?: boolean, suspects?: Array<{name:string}>, orphanSuspects?: Array<{name:string, inBox?:boolean}>, pluginTreeFailure?: boolean }|null|undefined} forensics
 * @returns {string}
 */
function recoveryVerdict(lastStart, recovery, forensics) {
  if (forensics?.genericCause === 'session-cache') {
    return GENERIC_LABELS['session-cache'];
  }
  // In-box damage outranks the sticky-skip banner: neither「恢复完整插件」nor
  // per-plugin disable can repair a broken harness runtime, so saying so first
  // is the only honest verdict.
  if (forensics?.desktopRuntimeDamage) {
    return desktopRuntimeDamageVerdict(forensics);
  }
  if (recovery?.skipUserPlugins) {
    return '当前在跳过用户插件模式下运行；完整加载请点「恢复完整插件并启动」。禁用单项不会自动加载全部用户插件。';
  }
  if (forensics?.genericCause) {
    return GENERIC_LABELS[forensics.genericCause] || String(forensics.genericCause);
  }
  if (forensics?.pluginTreeFailure || (forensics?.suspects && forensics.suspects.length)) {
    const names = (forensics.suspects || []).map((row) => row.name).join('、');
    return names
      ? `启动日志指向可疑插件：${names}。可逐项禁用后重新启动。`
      : '插件树加载失败。可逐项禁用下列插件后重新启动。';
  }
  if (lastStart?.ok === false) {
    return `上次启动失败：${lastStart.error || '原因未知'}`;
  }
  return '桌面端未就绪。可检查下列插件后重新启动。';
}

/**
 * @param {Array<{ name: string, suspect?: boolean, preset?: boolean, officialTemplate?: boolean, disabled?: boolean, orphan?: boolean, inBox?: boolean }>} rows
 * @returns {typeof rows}
 */
function sortPluginRows(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const rank = (row) => {
    if (row.inBox) return 0;
    if (row.orphan) return 1;
    if (row.suspect) return 2;
    if (row.officialTemplate) return 5;
    if (row.preset) return 4;
    return 3;
  };
  list.sort((a, b) => {
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
  return list;
}

const launcherRecovery = {
  GENERIC_LABELS,
  PLUGIN_ERROR_LABELS,
  pluginErrorLabel,
  shouldShowRecovery,
  desktopRuntimeDamageVerdict,
  recoveryVerdict,
  sortPluginRows,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = launcherRecovery;
}
if (typeof window !== 'undefined') {
  window.launcherRecovery = launcherRecovery;
}
