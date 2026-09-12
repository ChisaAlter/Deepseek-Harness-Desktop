const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const failureEl = document.getElementById('failure');
const recoveryEl = document.getElementById('recovery');
const actionsEl = document.getElementById('actions');
const logEl = document.getElementById('log');
const retryEl = document.getElementById('retry');
const cancelRestartEl = document.getElementById('cancel-restart');
const openLauncherEl = document.getElementById('open-launcher');
const saveLogEl = document.getElementById('save-log');
const stampEl = document.getElementById('stamp');
const stampCodeEl = document.getElementById('stamp-code');

const HINTS = {
  idle: '等待启动。',
  starting: '本机 dsh web 启动中。关闭应用时服务一并退出。',
  ready: '正在打开 Web UI。',
  stopping: '正在停止运行时。',
  error: '可立即重启，或根据日志调整配置。',
};

const LABELS = {
  idle: '未运行',
  starting: '正在启动运行时',
  ready: '运行时已就绪',
  stopping: '正在停止',
  error: '启动失败',
};

const STAMPS = {
  idle: { stamp: '待机', code: 'IDLE' },
  starting: { stamp: '启动中', code: 'BOOT' },
  ready: { stamp: '就绪', code: 'READY' },
  stopping: { stamp: '停止中', code: 'HALT' },
  error: { stamp: '异常', code: 'ERROR' },
};

let latestSnapshot = null;
let countdownTimer = null;
let pluginBoot = null;
let actionNotice = '';

function invoke(method, ...args) {
  try {
    const api = window.shell;
    if (!api || typeof api[method] !== 'function') {
      return Promise.reject(new Error('桌面壳接口不可用'));
    }
    return Promise.resolve(api[method](...args));
  } catch (error) {
    return Promise.reject(error);
  }
}

function listen(method, handler) {
  try {
    const api = window.shell;
    if (!api || typeof api[method] !== 'function') {
      return;
    }
    Promise.resolve(api[method](handler)).catch(() => {});
  } catch {
    // ignore
  }
}

function recoveryText(snapshot) {
  const recovery = snapshot?.recovery;
  if (!recovery) {
    return '';
  }
  const attempt = Number(recovery.attempt) || 0;
  const maxAttempts = Number(recovery.maxAttempts) || 0;
  if (recovery.status === 'scheduled') {
    const remaining = Math.max(0, Number(recovery.nextRetryAt) - Date.now());
    const seconds = Math.max(1, Math.ceil(remaining / 1000));
    return `${seconds} 秒后进行第 ${attempt}/${maxAttempts} 次自动重启。`;
  }
  if (recovery.status === 'restarting') {
    return `正在进行第 ${attempt}/${maxAttempts} 次自动重启。`;
  }
  if (recovery.status === 'monitoring') {
    return `第 ${attempt}/${maxAttempts} 次自动重启已完成，正在确认运行稳定。`;
  }
  if (recovery.status === 'exhausted') {
    return `已完成 ${attempt} 次自动重启，仍未稳定运行。自动恢复已停止。`;
  }
  if (recovery.status === 'cancelled') {
    return recovery.reason === 'disabled'
      ? '自动恢复已在设置中关闭。'
      : '本轮自动恢复已取消。';
  }
  return '';
}

function refreshCountdown() {
  if (!latestSnapshot && !actionNotice) {
    return;
  }
  const recovery = latestSnapshot ? recoveryText(latestSnapshot) : '';
  const text = [recovery, actionNotice].filter(Boolean).join(' ');
  recoveryEl.textContent = text;
  recoveryEl.hidden = !text;
}

function manageCountdown(snapshot) {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (snapshot?.recovery?.status === 'scheduled') {
    countdownTimer = setInterval(refreshCountdown, 250);
  }
}

function renderStamp(state) {
  const face = STAMPS[state] || STAMPS.starting;
  stampEl.textContent = face.stamp;
  stampCodeEl.textContent = face.code;
}

function applyPluginBootCopy(payload) {
  if (payload.failed) {
    statusEl.textContent = '插件加载失败';
    statusEl.className = 'status error';
    hintEl.textContent = payload.error || '运行时已就绪，但客户端插件未能完成装载。';
    document.body.dataset.state = 'error';
    renderStamp('error');
    return;
  }
  statusEl.textContent = payload.total > 0
    ? `正在加载插件 ${payload.ready}/${payload.total}`
    : '正在加载插件';
  statusEl.className = 'status ready';
  hintEl.textContent = '运行时已就绪，正在装载客户端插件。';
}

function applyPluginRecoveryCopy(snapshot) {
  if (snapshot?.pluginRecovery?.skipUserPlugins !== true) return false;
  const copy = globalThis.BootRecovery?.skipStartingCopy?.();
  if (!copy) return false;
  statusEl.textContent = copy.status;
  statusEl.className = 'status ready';
  hintEl.textContent = copy.hint;
  document.body.dataset.state = 'starting';
  renderStamp('starting');
  return true;
}

function renderPluginBoot(payload) {
  pluginBoot = payload;
  if (!payload || payload.settled) {
    return;
  }
  if (latestSnapshot?.state === 'error') {
    return;
  }
  applyPluginBootCopy(payload);
}

function renderState(snapshot) {
  latestSnapshot = snapshot;
  const state = snapshot?.state || 'starting';
  const failure = snapshot?.failure;
  const recovery = snapshot?.recovery;
  const runtimeFailure = state === 'error' && failure?.phase === 'runtime';
  const recoveryBusy = recovery?.status === 'restarting';
  const recoveryScheduled = recovery?.status === 'scheduled';
  document.body.dataset.state = state;
  renderStamp(state);

  const usingOfficialRecovery = state === 'starting' && applyPluginRecoveryCopy(snapshot);

  if (!usingOfficialRecovery) {
    statusEl.textContent = state === 'error'
      ? (runtimeFailure ? 'Harness 意外退出' : 'Harness 启动失败')
      : LABELS[state] || LABELS.starting;
    statusEl.className = `status ${state}`;
    hintEl.textContent = runtimeFailure
      ? '桌面端已返回恢复页面，失效的 Web UI 和手机 Remote 已停止使用旧进程。'
      : (HINTS[state] || HINTS.starting);
  }

  failureEl.textContent = state === 'error' ? (failure?.message || snapshot?.error || '') : '';
  failureEl.hidden = !failureEl.textContent;

  const canAct = state === 'error' || recoveryScheduled || recoveryBusy;
  if (!canAct) {
    actionNotice = '';
  }
  refreshCountdown();
  manageCountdown(snapshot);

  actionsEl.hidden = !canAct;
  retryEl.textContent = globalThis.BootRecovery?.retryActionLabel
    ? globalThis.BootRecovery.retryActionLabel(runtimeFailure)
    : (runtimeFailure ? '立即重启' : '重试');
  retryEl.disabled = recoveryBusy;
  saveLogEl.textContent = globalThis.BootRecovery?.downloadLogLabel
    ? globalThis.BootRecovery.downloadLogLabel()
    : '下载日志';
  // Plugin-level recovery lives on the launcher Recovery Board; the boot
  // page only bridges there on a settled failure.
  openLauncherEl.textContent = globalThis.BootRecovery?.openLauncherLabel
    ? globalThis.BootRecovery.openLauncherLabel()
    : '回启动器排查';
  openLauncherEl.hidden = !(globalThis.BootRecovery?.showLauncherBridge
    ? globalThis.BootRecovery.showLauncherBridge(state)
    : state === 'error');
  cancelRestartEl.hidden = !recoveryScheduled;
  cancelRestartEl.disabled = recoveryBusy;

  if (Array.isArray(snapshot?.logs)) {
    logEl.replaceChildren();
    visibleLogs(snapshot.logs, state).forEach(appendLog);
  }

  if (state === 'ready' && pluginBoot && !pluginBoot.settled && !pluginBoot.failed) {
    applyPluginBootCopy(pluginBoot);
  }
}

function visibleLogs(logs, state) {
  const lines = Array.isArray(logs) ? logs.map((line) => String(line ?? '')) : [];
  const tail = lines.slice(-8);
  if (state !== 'error') {
    return tail;
  }
  const important = lines.filter((line) => (
    globalThis.BootRecovery?.isImportantBootLog
      ? globalThis.BootRecovery.isImportantBootLog(line)
      : /ERR_[A-Z0-9_]+|Cannot find (?:package|module)|Error \[/.test(line)
  ));
  const merged = [];
  const seen = new Set();
  for (const line of [...important, ...tail]) {
    if (seen.has(line)) continue;
    seen.add(line);
    merged.push(line);
  }
  return merged.slice(-16);
}

function appendLog(line) {
  const item = document.createElement('li');
  item.textContent = typeof line === 'string' ? line : String(line ?? '');
  logEl.appendChild(item);
  const limit = document.body.dataset.state === 'error' ? 16 : 8;
  while (logEl.children.length > limit) {
    logEl.removeChild(logEl.firstChild);
  }
}

retryEl.addEventListener('click', () => {
  actionNotice = '';
  retryEl.disabled = true;
  cancelRestartEl.hidden = true;
  renderState({ state: 'starting', recovery: { status: 'inactive' } });
  invoke('restart')
    .then((snapshot) => {
      if (snapshot && snapshot.state) {
        renderState(snapshot);
      }
    })
    .catch((error) => {
      renderState({
        state: 'error',
        error: error.message || String(error),
        failure: {
          phase: 'startup',
          message: error.message || String(error),
        },
      });
    });
});

cancelRestartEl.addEventListener('click', () => {
  cancelRestartEl.disabled = true;
  invoke('cancelRestart')
    .then(renderState)
    .catch((error) => {
      recoveryEl.textContent = `取消失败：${error.message || String(error)}`;
      recoveryEl.hidden = false;
      cancelRestartEl.disabled = false;
    });
});

openLauncherEl.addEventListener('click', () => {
  openLauncherEl.disabled = true;
  invoke('openLauncher')
    .then(() => {
      openLauncherEl.disabled = false;
    })
    .catch((error) => {
      openLauncherEl.disabled = false;
      actionNotice = `打开启动器失败：${error.message || String(error)}`;
      refreshCountdown();
    });
});

saveLogEl.addEventListener('click', () => {
  invoke('saveBootLog')
    .then((result) => {
      if (!result || result.canceled) {
        return;
      }
      if (result.ok) {
        actionNotice = `日志已保存：${result.path}`;
      } else {
        actionNotice = `保存日志失败：${result.error || '未知错误'}`;
      }
      refreshCountdown();
    })
    .catch((error) => {
      actionNotice = `保存日志失败：${error.message || String(error)}`;
      refreshCountdown();
    });
});

invoke('getState')
  .then(renderState)
  .catch((error) => {
    renderState({
      state: 'error',
      error: error.message || String(error),
      failure: {
        phase: 'startup',
        message: error.message || String(error),
      },
    });
  });

listen('onState', renderState);
listen('onLog', (payload) => (Array.isArray(payload) ? payload : [payload]).forEach(appendLog));
listen('onPluginBoot', renderPluginBoot);
if (typeof window.watchShellTheme === 'function') {
  window.watchShellTheme();
}
