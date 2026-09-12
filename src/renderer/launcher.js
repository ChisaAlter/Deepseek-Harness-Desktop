function $(id) {
  return document.getElementById(id);
}

function pageShell() {
  return window.shell;
}

function setHint(text) {
  const node = $('hint');
  if (!text) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.hidden = false;
  node.textContent = text;
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const on = panel.id === `panel-${name}`;
    panel.classList.toggle('is-active', on);
    panel.hidden = !on;
  });
}

function badge(text, warn) {
  return `<span class="badge${warn ? ' warn' : ''}">${text}</span>`;
}

function uninstallErrorHint(result) {
  if (result?.message) {
    return result.message;
  }
  const labels = {
    'source-run-no-install': '当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 Deepseek-Harness-Desktop。',
    'uninstaller-not-found': '未找到卸载程序。请在「设置 → 应用」中卸载 Deepseek-Harness-Desktop。',
  };
  return labels[result?.error] || result?.error || '无法启动卸载程序';
}

function renderInstalledCard(installed) {
  const version = installed?.version || '';
  const runningFromSource = Boolean(installed?.runningFromSource);
  const prefix = runningFromSource ? '当前运行（源码）v' : '本机已安装 v';
  const label = version
    ? `${prefix}${String(version).replace(/^v/i, '')}`
    : (runningFromSource ? '当前为源码运行' : '本机已安装（版本未知）');
  $('installed-version').textContent = label;
  const pathNode = $('installed-path');
  if (installed?.installPath) {
    pathNode.textContent = installed.installPath;
    pathNode.hidden = false;
    pathNode.title = installed.installPath;
  } else {
    pathNode.textContent = '';
    pathNode.hidden = true;
    pathNode.title = '';
  }
  const noteNode = $('installed-uninstall-note');
  const note = installed?.uninstallNote || '';
  if (note) {
    noteNode.textContent = note;
    noteNode.hidden = false;
  } else {
    noteNode.textContent = '';
    noteNode.hidden = true;
  }
  const btn = $('btn-uninstall-app');
  if (installed?.uninstallUsesSettings) {
    btn.textContent = '打开应用设置';
  } else {
    btn.textContent = '卸载本机应用';
  }
  const canUninstall = Boolean(installed?.uninstallAvailable);
  btn.hidden = !canUninstall;
  btn.disabled = !canUninstall;
}

function releaseActionLabel(row) {
  if (row.current || !row.installable) {
    return null;
  }
  if (row.newer) {
    return '更新到此版本';
  }
  return '切换至此版本';
}

function releaseActionButton(row) {
  if (row.current) {
    return '<span class="row-meta">已安装</span>';
  }
  const label = releaseActionLabel(row);
  if (!label) {
    const reason = row.installable ? '不可用' : '无安装包';
    return `<button type="button" class="ghost" disabled>${reason}</button>`;
  }
  const kind = row.newer ? 'update' : 'switch';
  return `<button type="button" class="ghost" data-install-tag="${escapeHtml(row.tag || '')}" data-install-kind="${kind}">${label}</button>`;
}

function renderReleases(payload) {
  renderInstalledCard(payload?.installed);
  const list = $('release-list');
  const rows = payload && Array.isArray(payload.releases) ? payload.releases : [];
  if (!rows.length) {
    list.innerHTML = `<li><span class="row-meta">${payload?.message || '暂无可列出的正式版。'}</span></li>`;
    return;
  }
  list.innerHTML = rows.map((row) => {
    const marks = [
      row.current ? badge('当前') : '',
      row.prerelease ? badge('预发布') : '',
      row.installable ? '' : badge('无安装包', true),
    ].join('');
    return `<li>
      <div class="row-main">
        <div class="row-title">${escapeHtml(row.tag || row.version || '')} ${marks}</div>
        <div class="row-meta">${escapeHtml(row.assetName || '无 Setup 安装包')}</div>
      </div>
      ${releaseActionButton(row)}
    </li>`;
  }).join('');
  list.querySelectorAll('[data-install-tag]').forEach((button) => {
    button.addEventListener('click', () => installTag(button.dataset.installTag, button.dataset.installKind));
  });
}

function pluginErrorHint(code) {
  const recovery = window.launcherRecovery;
  if (recovery && typeof recovery.pluginErrorLabel === 'function') {
    return recovery.pluginErrorLabel(code);
  }
  const labels = {
    preset: '桌面预置插件不可移除。',
    'official-template': '官方模板插件不可禁用。',
    'desktop-builtin': '桌面内置组件不可禁用。',
    'missing-name': '缺少插件名称。',
    'missing-names': '缺少插件名称。',
  };
  return labels[code] || code || '操作失败';
}

function evidenceLines(forensics, name) {
  const rows = Array.isArray(forensics?.evidence) ? forensics.evidence : [];
  return rows.filter((row) => row.name === name).map((row) => row.line);
}

function pluginBoardRows(forensics, sortSuspectsFirst) {
  const plugins = Array.isArray(forensics?.plugins) ? forensics.plugins : [];
  const orphans = Array.isArray(forensics?.orphanSuspects) ? forensics.orphanSuspects : [];
  const rows = [...plugins, ...orphans];
  if (sortSuspectsFirst && window.launcherRecovery?.sortPluginRows) {
    return window.launcherRecovery.sortPluginRows(rows);
  }
  return rows;
}

function disableableSuspectNames(forensics) {
  return pluginBoardRows(forensics, true)
    .filter((row) => row.suspect && !row.orphan && !row.officialTemplate && !row.disabled)
    .map((row) => row.name);
}

function forensicsSummaryText(forensics) {
  if (!forensics) {
    return '尚未生成排查结果。';
  }
  if (forensics.genericCause) {
    const recovery = window.launcherRecovery;
    const labels = recovery?.GENERIC_LABELS || {
      oom: '检测到内存不足（OOM），与单个插件无关。',
      'port-excluded': '端口被系统保留或无权监听（listen EACCES），与插件无关，跳过用户插件无法修复。',
      'port-in-use': '检测到端口被占用，与单个插件无关。',
      'missing-node': '未找到 Node 运行时，与单个插件无关。',
    };
    return labels[forensics.genericCause] || String(forensics.genericCause);
  }
  if (forensics.desktopRuntimeDamage && window.launcherRecovery?.desktopRuntimeDamageVerdict) {
    return window.launcherRecovery.desktopRuntimeDamageVerdict(forensics);
  }
  if (forensics.suspects && forensics.suspects.length) {
    return `启动日志指向以下可疑插件：${forensics.suspects.map((row) => row.name || row).join('、')}。建议优先处理后再启动。`;
  }
  return '未能从日志确定具体插件。可逐项禁用下列插件后重新启动，以排查冲突。';
}

function renderPluginBoard(forensics, options = {}) {
  const list = $(options.listId);
  if (!list) {
    return;
  }
  if (options.summaryId) {
    const summary = $(options.summaryId);
    if (summary) {
      summary.textContent = options.summaryText || forensicsSummaryText(forensics);
    }
  }
  if (!forensics) {
    list.innerHTML = '';
    return;
  }
  const allowRemove = options.allowRemove === true;
  const rows = pluginBoardRows(forensics, options.sortSuspectsFirst === true);
  list.innerHTML = rows.map((row) => {
    const marks = [
      row.inBox ? badge('内置组件', true) : (row.orphan ? badge('未在 profile 登记', true) : ''),
      row.officialTemplate ? badge('官方模板') : '',
      row.preset ? badge('桌面预置') : '',
      row.disabled ? badge('已禁用') : '',
      row.suspect ? badge('可疑冲突', true) : '',
    ].join('');
    let actions = '';
    if (row.inBox) {
      actions = '<span class="row-meta">桌面内置组件损坏；禁用或跳过均无效，需重装桌面端。</span>';
    } else if (row.orphan) {
      actions = '<span class="row-meta">日志中出现但未写入 profile，无法在此禁用。</span>';
    } else if (row.officialTemplate) {
      actions = '<span class="row-meta" title="官方模板插件不可禁用。">不可禁用</span>';
    } else if (row.disabled) {
      actions = `<button type="button" class="ghost" data-enable="${escapeHtml(row.name)}">启用</button>`;
    } else {
      actions = `<button type="button" class="ghost" data-disable="${escapeHtml(row.name)}">禁用</button>`;
    }
    if (allowRemove && !row.preset && !row.orphan) {
      actions += `<button type="button" class="danger" data-remove="${escapeHtml(row.name)}">移除</button>`;
    }
    const evidence = evidenceLines(forensics, row.name)
      .map((line) => `<div class="row-meta evidence">${escapeHtml(line)}</div>`)
      .join('');
    return `<li>
      <div class="row-main">
        <div class="row-title">${escapeHtml(row.name)} ${marks}</div>
        <div class="row-meta">${escapeHtml(row.spec || '')}</div>
        ${evidence}
      </div>
      <div class="actions">${actions}</div>
    </li>`;
  }).join('');
  list.querySelectorAll('[data-disable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('disablePlugin', button.dataset.disable));
  });
  list.querySelectorAll('[data-enable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('enablePlugin', button.dataset.enable));
  });
  list.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('removePlugin', button.dataset.remove));
  });
}

function renderPlugins(forensics) {
  renderPluginBoard(forensics, {
    listId: 'plugin-list',
    summaryId: 'forensics-summary',
    allowRemove: true,
    sortSuspectsFirst: true,
  });
}

function renderHomeRecovery(status) {
  const board = $('home-recovery');
  const forensics = status?.forensics;
  const recovery = status?.recovery || forensics?.recovery || status?.desktop?.pluginRecovery;
  const recoveryApi = window.launcherRecovery;
  const show = recoveryApi?.shouldShowRecovery
    ? recoveryApi.shouldShowRecovery(status?.lastStart, recovery, forensics, status?.desktop)
    : false;
  board.hidden = !show;
  if (!show) {
    return;
  }
  $('home-recovery-verdict').textContent = recoveryApi?.recoveryVerdict
    ? recoveryApi.recoveryVerdict(status?.lastStart, recovery, forensics)
    : '';
  renderPluginBoard(forensics, {
    listId: 'home-recovery-list',
    sortSuspectsFirst: true,
  });
  const suspects = disableableSuspectNames(forensics);
  const btn = $('btn-disable-suspects');
  btn.hidden = suspects.length === 0;
  btn.dataset.names = suspects.join('\0');
}

async function actPlugin(method, name) {
  const api = pageShell();
  if (!api || typeof api[method] !== 'function') {
    return;
  }
  const aligning = method === 'disablePlugin' || method === 'enablePlugin';
  if (aligning) {
    setHint('正在重新启动以使插件变更生效…');
  }
  const result = await api[method](name);
  if (result && result.forensics) {
    renderPlugins(result.forensics);
    void refreshStatus();
  }
  if (result && result.ok === false) {
    setHint(pluginErrorHint(result.error));
    return;
  }
  if (aligning && result && result.harnessRestarted === false && result.error) {
    setHint(result.error);
    return;
  }
  if (method === 'removePlugin' && result && result.kernelStopped) {
    setHint('桌面端已停止，请在首页重新启动。');
    void refreshStatus();
    return;
  }
  if (aligning) {
    setHint('');
    void refreshStatus();
  }
}

function desktopStateLabel(state) {
  const labels = {
    ready: '已就绪',
    starting: '启动中',
    stopping: '关闭中',
    error: '异常',
    stopped: '未运行',
    idle: '未运行',
  };
  return labels[state] || String(state || '');
}

function desktopIsRunning(desktop) {
  const state = desktop?.state;
  return state === 'ready' || state === 'starting';
}

async function refreshStatus() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const status = await api.launcherStatus();
  const version = status?.version || status?.config?.appVersion || '';
  const last = status?.lastStart;
  const desktop = status?.desktop;
  const recovery = status?.recovery || desktop?.pluginRecovery;
  const bits = [`当前版本 ${version || '未知'}`];
  if (desktop && desktop.state) {
    bits.push(`桌面端${desktopStateLabel(desktop.state)}`);
  }
  if (recovery?.skipUserPlugins) {
    bits.push('当前跳过用户插件');
  }
  if (last && last.ok === false) {
    bits.push(`上次启动失败：${last.error || '原因未知'}`);
  }
  $('home-status').textContent = bits.join(' · ');
  const btnStart = $('btn-start');
  btnStart.textContent = desktopIsRunning(desktop) ? '关闭桌面端' : '启动桌面端';
  renderHomeRecovery(status);
  const config = status?.config || await api.getConfig();
  $('opt-quit').checked = config.quitAfterStart !== false;
  $('opt-auto').checked = config.autoStartDesktop !== false;
  $('opt-ask').checked = config.askOnUpdate !== false;
}

let importSourceHome;
const extraSkillDirs = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skillSourceLabel(source) {
  if (source === 'home') {
    return '官方 home';
  }
  if (source === 'agents') {
    return '用户技能目录';
  }
  return '额外目录';
}

function pluginSkipLabel(reason) {
  if (reason === 'template') {
    return '官方模板，不重装';
  }
  if (reason === 'dropped') {
    return '已下架';
  }
  if (reason === 'local-spec') {
    return '本地 file / link / workspace，不重装';
  }
  if (reason === 'unsupported') {
    return '规格不受支持，无法自动重装';
  }
  return reason || '跳过';
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`)].map((node) => node.value);
}

function setGroupChecked(name, on) {
  document.querySelectorAll(`input[name="${name}"]:not(:disabled)`).forEach((node) => {
    node.checked = Boolean(on);
  });
}

const IMPORT_CATS = {
  sessions: { name: 'session-rel', hint: '按会话目录分组' },
  skills: { name: 'skill-id', hint: '官方 skills、用户技能根与额外目录' },
  plugins: { name: 'plugin-name', hint: '按名单重装，不拷 node_modules' },
  mcp: { name: 'mcp-id', hint: '按 id 合并，密钥不出现在界面' },
  settings: { name: 'setting-id', hint: '整节搬运白名单设置；API key 随模型配置落盘，不在界面显示' },
  presets: { name: 'preset-id', hint: '官方 .agent-presets 按目录拷贝' },
};

const SETTING_LABELS = {
  'llm-deepseek': 'DeepSeek 模型与提供方',
  'llm-pi-ai': '自定义提供方（pi-ai）',
  'agent-default-model': '默认模型',
  'vision-fallback': '视觉回退模型',
  'ui-theme': '主题与外观',
  'agents-md': '全局指令 AGENTS.md',
};

function settingRowMeta(row) {
  if (row.id === 'agents-md') {
    return 'home 级指令文件，逐字拷贝';
  }
  const refs = Array.isArray(row.credentialRefs) ? row.credentialRefs : [];
  if (refs.length) {
    return `settings.yaml 整节 · 同步 API key 引用 ${refs.join('、')}`;
  }
  return 'settings.yaml 整节';
}

let importCat = 'sessions';
let importHomeDir = '';
let importListRendered = false;

const IMPORT_COLLAPSE_AT = 8;

function sessionGroupKey(rel) {
  const text = String(rel || '');
  const slash = text.indexOf('/');
  return slash === -1 ? text : text.slice(0, slash);
}

function sessionItemTitle(rel) {
  const text = String(rel || '');
  const key = sessionGroupKey(text);
  return text.startsWith(`${key}/`) ? text.slice(key.length + 1) : text;
}

function shortenHomePath(cwd) {
  const home = String(importHomeDir || '').replace(/[/\\]+$/, '');
  const text = String(cwd || '');
  if (!text) {
    return '';
  }
  if (home && (text === home || text.startsWith(`${home}\\`) || text.startsWith(`${home}/`))) {
    const rest = text.slice(home.length).replace(/\\/g, '/');
    return rest ? `~${rest}` : '~';
  }
  return text.replace(/\\/g, '/');
}

function sessionGroupLabel(key, items) {
  const withCwd = (items || []).find((row) => row && row.cwd);
  if (withCwd && withCwd.cwd) {
    return shortenHomePath(withCwd.cwd);
  }
  if (key === '_no-cwd') {
    return '无工作区';
  }
  if (/^--.+--$/.test(key)) {
    return `工作区（路径编码） ${key.slice(2, -2)}`;
  }
  return key || '未分组';
}

function sessionRowTitle(row) {
  return (row && (row.title || row.id)) || sessionItemTitle(row && row.rel);
}

function formatCreatedAt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return '';
  }
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

function sessionRowMeta(row) {
  const notes = [];
  if (row.id) {
    notes.push(row.id);
  }
  const when = formatCreatedAt(row.createdAt);
  if (when) {
    notes.push(when);
  }
  if (row.mixedEncoding) {
    notes.push('编码混用');
  }
  if (row.unsupported) {
    notes.push('不兼容旧库');
  }
  if (row.compressedLog) {
    notes.push('压缩日志未解析');
  }
  return notes.join(' · ');
}

function countChecked(name) {
  return document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`).length;
}

function countBoxes(name) {
  return document.querySelectorAll(`input[name="${name}"]`).length;
}

function showImportCat(name) {
  if (!IMPORT_CATS[name]) {
    return;
  }
  importCat = name;
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    const on = button.dataset.importCat === name;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('[data-import-pane]').forEach((pane) => {
    const on = pane.dataset.importPane === name;
    pane.classList.toggle('is-active', on);
    pane.hidden = !on;
  });
  $('import-board-hint').textContent = IMPORT_CATS[name].hint;
}

function syncImportSummary() {
  const sessionsChecked = countChecked('session-rel');
  const skillsChecked = countChecked('skill-id');
  const pluginsChecked = countChecked('plugin-name');
  const mcpChecked = countChecked('mcp-id');
  const settingsChecked = countChecked('setting-id');
  const presetsChecked = countChecked('preset-id');
  $('import-sessions-count').textContent = `${sessionsChecked}/${countBoxes('session-rel')}`;
  $('import-skills-count').textContent = `${skillsChecked}/${countBoxes('skill-id')}`;
  $('import-plugins-count').textContent = `${pluginsChecked}/${countBoxes('plugin-name')}`;
  $('import-mcp-count').textContent = `${mcpChecked}/${countBoxes('mcp-id')}`;
  $('import-settings-count').textContent = `${settingsChecked}/${countBoxes('setting-id')}`;
  $('import-presets-count').textContent = `${presetsChecked}/${countBoxes('preset-id')}`;
  $('import-result').textContent = `已选 会话 ${sessionsChecked} · 技能 ${skillsChecked} · 插件 ${pluginsChecked} · MCP ${mcpChecked} · 设置 ${settingsChecked} · 预设 ${presetsChecked}`;
}

function syncSessionClusters() {
  const host = $('import-sessions');
  host.querySelectorAll('[data-import-cluster]').forEach((input) => {
    const key = input.dataset.importCluster;
    const boxes = [...host.querySelectorAll('input[name="session-rel"]')]
      .filter((node) => !node.disabled && sessionGroupKey(node.value) === key);
    const selected = boxes.filter((node) => node.checked).length;
    input.checked = boxes.length > 0 && selected === boxes.length;
    input.indeterminate = selected > 0 && selected < boxes.length;
  });
}

function setSessionGroupExpanded(key, expanded) {
  const host = $('import-sessions');
  const fold = host.querySelector(`[data-import-fold="${CSS.escape(key)}"]`);
  if (fold) {
    fold.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    fold.classList.toggle('is-collapsed', !expanded);
  }
  host.querySelectorAll(`[data-import-group-item="${CSS.escape(key)}"]`).forEach((node) => {
    node.hidden = !expanded;
  });
}

function captureImportSelections() {
  if (!importListRendered) {
    return null;
  }
  return {
    'session-rel': new Set(checkedValues('session-rel')),
    'skill-id': new Set(checkedValues('skill-id')),
    'plugin-name': new Set(checkedValues('plugin-name')),
    'mcp-id': new Set(checkedValues('mcp-id')),
    'setting-id': new Set(checkedValues('setting-id')),
    'preset-id': new Set(checkedValues('preset-id')),
  };
}

function captureSessionFoldState() {
  const folded = new Map();
  $('import-sessions').querySelectorAll('[data-import-fold]').forEach((button) => {
    folded.set(button.dataset.importFold, button.getAttribute('aria-expanded') !== 'false');
  });
  return folded;
}

function shouldCheckImportItem(selections, name, value, defaultChecked) {
  if (!selections || !selections[name]) {
    return defaultChecked;
  }
  return selections[name].has(value);
}

function renderSessionList(rows, options = {}) {
  const selections = options.selections;
  const foldState = options.foldState;
  const host = $('import-sessions');
  if (!rows.length) {
    host.innerHTML = '<li><span class="row-meta">没有可列出的项。</span></li>';
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = sessionGroupKey(row.rel);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  const html = [];
  const groupEntries = [...groups.entries()].sort((left, right) => {
    const rank = (items) => {
      let score = 0;
      if (items.some((row) => row && row.title)) {
        score += 2;
      }
      if (items.some((row) => row && row.cwd)) {
        score += 1;
      }
      return score;
    };
    const byRank = rank(right[1]) - rank(left[1]);
    if (byRank !== 0) {
      return byRank;
    }
    return sessionGroupLabel(left[0], left[1]).localeCompare(sessionGroupLabel(right[0], right[1]), 'zh');
  });
  for (const [key, items] of groupEntries) {
    const enabled = items.filter((row) => !row.unsupported);
    const expanded = foldState?.has(key)
      ? foldState.get(key)
      : items.length < IMPORT_COLLAPSE_AT;
    const label = sessionGroupLabel(key, items);
    html.push(`<li class="import-cluster">
      <div class="import-cluster-head">
        <button type="button" class="import-fold${expanded ? '' : ' is-collapsed'}" data-import-fold="${escapeHtml(key)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="折叠或展开分组">
          <svg class="import-fold-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 3.2 10.8 8 6.2 12.8 5.2 11.8 8.8 8 5.2 4.2z"/></svg>
        </button>
        <label class="check-row">
          <input type="checkbox" data-import-cluster="${escapeHtml(key)}" ${enabled.length ? 'checked' : 'disabled'} />
          <span class="row-main">
            <span class="row-title">${escapeHtml(label)}</span>
            <span class="row-meta">${items.length} 项</span>
          </span>
        </label>
      </div>
    </li>`);
    for (const row of items) {
      const disabled = Boolean(row.unsupported);
      const checked = !disabled && shouldCheckImportItem(selections, 'session-rel', row.rel, true);
      html.push(`<li class="import-item" data-import-group-item="${escapeHtml(key)}"${expanded ? '' : ' hidden'}>
        <label class="check-row">
          <input type="checkbox" name="session-rel" value="${escapeHtml(row.rel)}" ${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''} />
          <span class="row-main">
            <span class="row-title">${escapeHtml(sessionRowTitle(row))}${disabled ? badge('不兼容', true) : (row.conflict ? badge('已存在') : '')}</span>
            <span class="row-meta">${escapeHtml(sessionRowMeta(row))}</span>
          </span>
        </label>
      </li>`);
    }
  }
  host.innerHTML = html.join('');
}

function renderCheckList(targetId, rows, options) {
  const host = $(targetId);
  const selections = options.selections;
  if (!rows.length) {
    host.innerHTML = '<li><span class="row-meta">没有可列出的项。</span></li>';
    return;
  }
  host.innerHTML = rows.map((row) => {
    const disabled = options.disabled(row);
    const defaultChecked = !disabled;
    const checked = shouldCheckImportItem(selections, options.name, options.value(row), defaultChecked);
    const marks = typeof options.marks === 'function' ? options.marks(row) : '';
    return `<li>
      <label class="check-row">
        <input type="checkbox" name="${options.name}" value="${escapeHtml(options.value(row))}" ${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''} />
        <span class="row-main">
          <span class="row-title">${escapeHtml(options.title(row))}${disabled ? badge(options.skipLabel(row), true) : ''}${marks}${!disabled && row.conflict ? badge('已存在') : ''}</span>
          <span class="row-meta">${escapeHtml(options.meta(row))}</span>
        </span>
      </label>
    </li>`;
  }).join('');
}

function scanOptions() {
  return {
    sourceHome: importSourceHome,
    extraSkillDirs: extraSkillDirs.slice(),
  };
}

function countStatus(rows, status) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row.status === status).length;
}

const IMPORT_PHASE_LABELS = {
  sessions: '会话',
  attachments: '附件',
  skills: '技能',
  plugins: '插件',
  presets: '预设',
};

function importProgressText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (payload.phase === 'done') {
    return '导入完成。';
  }
  if (payload.phase === 'cancelled') {
    return '已取消。';
  }
  const label = IMPORT_PHASE_LABELS[payload.phase];
  if (!label) {
    return '';
  }
  const item = payload.rel || payload.id || payload.name || '';
  return `正在导入${label} ${payload.done}/${payload.total}${item ? `：${item}` : ''}`;
}

function summarizeImport(result) {
  if (!result) {
    return '没有返回结果。';
  }
  if (result.cancelled) {
    return '导入已取消。已拷贝的内容保留，下次可按原规则续导（已存在的会跳过）。';
  }
  if (result.empty) {
    return '未选择任何项，没有写入桌面 home。';
  }
  const lines = [
    `会话 已拷 ${countStatus(result.sessions, 'copied')} · 跳过 ${countStatus(result.sessions, 'skipped')} · 拒绝 ${countStatus(result.sessions, 'rejected')}`,
    `技能 已拷 ${countStatus(result.skills, 'copied')} · 跳过 ${countStatus(result.skills, 'skipped')} · 拒绝 ${countStatus(result.skills, 'rejected')}`,
    `插件 已装 ${countStatus(result.plugins, 'installed')} · 跳过 ${countStatus(result.plugins, 'skipped')} · 失败 ${countStatus(result.plugins, 'failed')}`,
    `MCP 已写入 ${countStatus(result.mcp, 'copied')} · 跳过 ${countStatus(result.mcp, 'skipped')} · 拒绝 ${countStatus(result.mcp, 'rejected')}`,
    `设置 已写入 ${countStatus(result.settings, 'copied')} · 跳过 ${countStatus(result.settings, 'skipped')} · 凭据引用 已同步 ${countStatus(result.credentials, 'copied')} · 跳过 ${countStatus(result.credentials, 'skipped')}`,
    `预设 已拷 ${countStatus(result.presets, 'copied')} · 跳过 ${countStatus(result.presets, 'skipped')} · 拒绝 ${countStatus(result.presets, 'rejected')}`,
    `附件 ${result.attachments || 'absent'}`,
  ];
  if (result.ok === false) {
    lines.push('导入未完全成功。官方来源未改写。');
  }
  if (result.kernelStopped) {
    lines.push('桌面端已停止，请在首页重新启动。');
  }
  return lines.join('\n');
}

async function refreshImport(options = {}) {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-scan');
  const showFeedback = options.silent !== true;
  const savedSelections = captureImportSelections();
  const foldState = captureSessionFoldState();
  if (showFeedback) {
    btn.disabled = true;
    btn.textContent = '扫描中…';
  }
  try {
    const scan = await api.scanImport(scanOptions());
    importHomeDir = typeof scan?.homeDir === 'string' ? scan.homeDir : '';
    const sourceLine = scan?.sourceHome
      ? `${scan.sourceHome}${scan.sourceHasData ? '（有可导入数据）' : '（没有可导入数据）'}${scan.destEmpty ? '；桌面会话为空' : ''}`
      : '还没有扫描结果。';
    $('import-source').textContent = sourceLine;
    $('import-source').title = scan?.sourceHome || '';
    $('import-skill-roots').hidden = extraSkillDirs.length === 0;
    $('import-skill-roots').textContent = extraSkillDirs.length
      ? `额外技能目录 ${extraSkillDirs.join('；')}`
      : '';

    const sessions = Array.isArray(scan?.sessions) ? scan.sessions : [];
    const skills = Array.isArray(scan?.skills) ? scan.skills : [];
    const plugins = Array.isArray(scan?.plugins) ? scan.plugins : [];
    const mcp = Array.isArray(scan?.mcp) ? scan.mcp : [];
    const settings = Array.isArray(scan?.settings) ? scan.settings : [];
    const presets = Array.isArray(scan?.presets) ? scan.presets : [];
    const renderOptions = { selections: savedSelections, foldState };

    renderSessionList(sessions, renderOptions);
    renderCheckList('import-skills', skills, {
      name: 'skill-id',
      value: (row) => row.id,
      title: (row) => row.displayName || row.name,
      meta: (row) => skillSourceLabel(row.source),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-plugins', plugins, {
      name: 'plugin-name',
      value: (row) => row.name,
      title: (row) => row.name,
      meta: (row) => (row.skipped ? pluginSkipLabel(row.reason) : (row.spec || '')),
      disabled: (row) => Boolean(row.skipped),
      skipLabel: (row) => pluginSkipLabel(row.reason),
      marks: (row) => (!row.skipped && row.alreadyInstalled ? badge('已安装') : ''),
      selections: savedSelections,
    });
    renderCheckList('import-mcp', mcp, {
      name: 'mcp-id',
      value: (row) => row.id,
      title: (row) => row.name || row.id,
      meta: (row) => [
        row.enabled === false ? '已停用' : '已启用',
        row.id,
        row.endpoint,
      ].filter(Boolean).join(' · '),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-settings', settings, {
      name: 'setting-id',
      value: (row) => row.id,
      title: (row) => SETTING_LABELS[row.id] || row.id,
      meta: (row) => settingRowMeta(row),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-presets', presets, {
      name: 'preset-id',
      value: (row) => row.id,
      title: (row) => row.id,
      meta: (row) => (row.broken ? 'agent.cordis.yml 缺失或无效' : 'agent.cordis.yml'),
      disabled: (row) => Boolean(row.broken),
      skipLabel: () => '组合损坏',
      selections: savedSelections,
    });

    $('import-attachments').checked = Boolean(scan?.hasAttachments) && sessions.some((row) => !row.unsupported);
    importListRendered = true;
    syncSessionClusters();
    syncImportSummary();
    if (showFeedback) {
      const when = new Date().toLocaleString();
      $('import-scan-status').textContent = `扫描完成 · 会话 ${sessions.length} · 技能 ${skills.length} · 插件 ${plugins.length} · MCP ${mcp.length} · 设置 ${settings.length} · 预设 ${presets.length} · ${when}`;
    }
  } catch (error) {
    setHint(error && error.message ? error.message : String(error));
  } finally {
    if (showFeedback) {
      btn.disabled = false;
      btn.textContent = '重新扫描';
    }
  }
}

async function refreshReleases() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-refresh-releases');
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    const payload = await api.listReleases();
    renderReleases(payload);
  } catch (error) {
    setHint(error && error.message ? error.message : String(error));
  } finally {
    btn.disabled = false;
    btn.textContent = '刷新列表';
  }
}

async function refreshPlugins() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-refresh-plugins');
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    renderPlugins(await api.pluginForensics());
  } catch (error) {
    setHint(error && error.message ? error.message : String(error));
  } finally {
    btn.disabled = false;
    btn.textContent = '刷新';
  }
}

async function installTag(tag, kind) {
  const api = pageShell();
  if (!api || !tag) {
    return;
  }
  let message = `将安装 ${tag} 并替换当前应用，是否继续？`;
  if (kind === 'update') {
    message = `将更新到 ${tag}，Setup 会替换当前安装，是否继续？`;
  } else if (kind === 'switch') {
    message = `将切换到 ${tag}（较旧版本），Setup 会覆盖当前安装，是否继续？`;
  }
  if (!window.confirm(message)) {
    return;
  }
  $('update-progress').hidden = false;
  $('update-progress').textContent = '正在下载安装包…';
  const result = await api.installRelease(tag);
  if (result && result.status === 'error') {
    $('update-progress').textContent = result.message === 'no-installer'
      ? '该版本未提供 Setup 安装包。'
      : (result.message || '安装失败');
  }
}

async function saveSettings() {
  const api = pageShell();
  if (!api) {
    return;
  }
  try {
    await api.saveLauncherConfig({
      quitAfterStart: $('opt-quit').checked,
      autoStartDesktop: $('opt-auto').checked,
      askOnUpdate: $('opt-ask').checked,
    });
  } catch (error) {
    setHint(error && error.message ? error.message : '设置保存失败');
  }
}

function bind() {
  const api = pageShell();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.tab);
      if (tab.dataset.tab === 'home') void refreshStatus();
      if (tab.dataset.tab === 'import') void refreshImport({ silent: true });
      if (tab.dataset.tab === 'versions') void refreshReleases();
      if (tab.dataset.tab === 'plugins') void refreshPlugins();
    });
  });
  $('btn-start').addEventListener('click', async () => {
    const btnStart = $('btn-start');
    if (btnStart.disabled) {
      return;
    }
    const api = pageShell();
    const status = await api?.launcherStatus();
    btnStart.disabled = true;
    if (desktopIsRunning(status?.desktop)) {
      setHint('正在关闭桌面端…');
      try {
        const result = await api?.stopDesktop();
        if (result && result.ok === false) {
          setHint(result.error || '关闭失败');
          return;
        }
        setHint('');
        await refreshStatus();
      } catch (error) {
        setHint(error && error.message ? error.message : String(error));
      } finally {
        btnStart.disabled = false;
      }
      return;
    }
    setHint('正在启动桌面端…');
    try {
      const result = await api?.startDesktop();
      if (result && result.ok === false) {
        setHint(result.error || '启动失败');
        return;
      }
      setHint('');
      await refreshStatus();
    } catch (error) {
      setHint(error && error.message ? error.message : String(error));
    } finally {
      btnStart.disabled = false;
    }
  });
  $('btn-skip').addEventListener('click', async () => {
    setHint('正在跳过用户插件并重新启动…');
    try {
      const result = await api?.skipUserPlugins();
      if (result && result.ok === false) {
        setHint(result.error || '启动失败');
        return;
      }
      setHint('');
      void refreshStatus();
    } catch (error) {
      setHint(error && error.message ? error.message : String(error));
    }
  });
  $('btn-retry-full').addEventListener('click', async () => {
    setHint('正在恢复完整插件并启动…');
    try {
      const result = await api?.retryFullPlugins();
      if (result && result.ok === false) {
        setHint(result.error || '启动失败');
        void refreshStatus();
        return;
      }
      setHint('');
      void refreshStatus();
    } catch (error) {
      setHint(error && error.message ? error.message : String(error));
    }
  });
  $('btn-disable-suspects').addEventListener('click', async () => {
    const raw = $('btn-disable-suspects').dataset.names || '';
    const names = raw.split('\0').filter(Boolean);
    if (!names.length || !api?.disablePlugins) {
      return;
    }
    setHint('正在批量禁用可疑插件并重新启动…');
    const result = await api.disablePlugins(names);
    if (result && result.ok === false) {
      setHint(pluginErrorHint(result.error));
      return;
    }
    if (result && result.harnessRestarted === false && result.error) {
      setHint(result.error);
    } else {
      setHint('');
    }
    void refreshStatus();
    void refreshPlugins();
  });
  $('btn-pick-source').addEventListener('click', async () => {
    const picked = await api?.pickImportSource();
    if (picked) {
      importSourceHome = picked;
      await refreshImport();
    }
  });
  $('btn-pick-skill').addEventListener('click', async () => {
    const picked = await api?.pickSkillDir();
    if (picked && !extraSkillDirs.includes(picked)) {
      extraSkillDirs.push(picked);
      await refreshImport();
    }
  });
  $('btn-scan').addEventListener('click', () => refreshImport());
  $('btn-uninstall-app').addEventListener('click', async () => {
    const usesSettings = $('btn-uninstall-app').textContent === '打开应用设置';
    const prompt = usesSettings
      ? '将打开 Windows「设置 → 应用」，请在列表中卸载 Deepseek-Harness-Desktop。是否继续？'
      : '将启动 Windows 卸载程序并移除本机应用，是否继续？';
    if (!window.confirm(prompt)) {
      return;
    }
    setHint(usesSettings ? '正在打开应用设置…' : '正在启动卸载程序…');
    try {
      const result = await api?.uninstallApp();
      if (result && result.ok === false) {
        setHint(uninstallErrorHint(result));
        return;
      }
      setHint(result?.message || (result?.openedSettings
        ? '已打开「设置 → 应用」，请在列表中卸载 Deepseek-Harness-Desktop。'
        : ''));
    } catch (error) {
      setHint(error && error.message ? error.message : String(error));
    }
  });
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    button.addEventListener('click', () => showImportCat(button.dataset.importCat));
  });
  $('import-board-body').addEventListener('click', (event) => {
    const fold = event.target.closest('[data-import-fold]');
    if (!fold || !$('import-sessions').contains(fold)) {
      return;
    }
    event.preventDefault();
    const key = fold.dataset.importFold;
    const expanded = fold.getAttribute('aria-expanded') !== 'false';
    setSessionGroupExpanded(key, !expanded);
  });
  $('import-board-body').addEventListener('change', (event) => {
    const cluster = event.target.closest('[data-import-cluster]');
    if (cluster && event.target === cluster) {
      const key = cluster.dataset.importCluster;
      $('import-sessions').querySelectorAll('input[name="session-rel"]').forEach((node) => {
        if (!node.disabled && sessionGroupKey(node.value) === key) {
          node.checked = cluster.checked;
        }
      });
    }
    syncSessionClusters();
    syncImportSummary();
  });
  $('btn-import-select-all').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, true);
    syncSessionClusters();
    syncImportSummary();
  });
  $('btn-import-select-none').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, false);
    syncSessionClusters();
    syncImportSummary();
  });
  const importRunBtn = $('btn-import');
  const importCancelBtn = $('btn-import-cancel');
  importRunBtn.addEventListener('click', async () => {
    importRunBtn.disabled = true;
    importCancelBtn.hidden = false;
    importCancelBtn.disabled = false;
    $('import-result').textContent = '正在导入…';
    try {
      const result = await api?.runImport({
        ...scanOptions(),
        overwrite: $('import-overwrite').checked,
        importAttachments: $('import-attachments').checked,
        selectedRels: checkedValues('session-rel'),
        selectedSkillIds: checkedValues('skill-id'),
        selectedPluginNames: checkedValues('plugin-name'),
        selectedMcpIds: checkedValues('mcp-id'),
        selectedSettingIds: checkedValues('setting-id'),
        selectedPresetIds: checkedValues('preset-id'),
      });
      $('import-result').textContent = summarizeImport(result);
    } finally {
      importRunBtn.disabled = false;
      importCancelBtn.hidden = true;
    }
  });
  importCancelBtn.addEventListener('click', () => {
    importCancelBtn.disabled = true;
    void api?.cancelImport?.();
  });
  if (typeof api?.onImportProgress === 'function') {
    api.onImportProgress((payload) => {
      const text = importProgressText(payload);
      if (text) {
        $('import-result').textContent = text;
      }
    });
  }
  $('btn-refresh-releases').addEventListener('click', () => refreshReleases());
  $('btn-refresh-plugins').addEventListener('click', () => refreshPlugins());
  ['opt-quit', 'opt-auto', 'opt-ask'].forEach((id) => {
    $(id).addEventListener('change', () => saveSettings());
  });
  if (api?.onShowTab) {
    api.onShowTab((payload) => {
      if (payload?.tab) showTab(payload.tab);
      if (payload?.tab === 'import') void refreshImport({ silent: true });
      if (payload?.tab === 'plugins') void refreshPlugins();
      if (payload?.tab === 'home') void refreshStatus();
    });
  }
  if (api?.onDesktopFailed) {
    api.onDesktopFailed((payload) => {
      showTab('home');
      setHint(payload?.error || '桌面端启动失败。可在下方恢复工作台处理插件冲突后重试。');
      void refreshStatus();
      void refreshPlugins();
    });
  }
  if (api?.onDesktopReady) {
    api.onDesktopReady(() => {
      setHint('');
      void refreshStatus();
    });
  }
  if (api?.onLauncherHint) {
    api.onLauncherHint((payload) => {
      if (payload?.importResume) {
        setHint('上次导入中断，未完成的临时文件已清理。可重新导入；已存在的内容将按规则跳过。');
      } else if (payload?.check?.hint) {
        // Cold-start gate outcome (failed/incomplete update flow): show verbatim.
        setHint(payload.check.hint);
      } else if (payload?.check?.status === 'error') {
        setHint(`更新检查失败：${payload.check.message || '网络或 GitHub 不可用'}。仍可启动桌面端。`);
      } else if (payload?.check?.status === 'available') {
        setHint(`发现正式版 ${payload.check.latest || ''}。`);
      } else {
        setHint('');
      }
      void refreshStatus();
    });
  }
  if (api?.onUpdateProgress) {
    api.onUpdateProgress((payload) => {
      $('update-progress').hidden = false;
      $('update-progress').textContent = payload?.phase === 'download'
        ? `下载 ${payload.percent || 0}%`
        : (payload?.phase || '处理中');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('.window-controls');
  if (typeof window.mountWindowControls === 'function') {
    window.mountWindowControls(host);
  }
  if (typeof window.watchShellTheme === 'function') {
    window.watchShellTheme();
  }
  bind();
  void refreshStatus();
});
