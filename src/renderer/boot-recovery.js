'use strict';

const LOG_ERROR_PATTERN = /ERR_[A-Z0-9_]+|Cannot find (?:package|module)|Error \[|plugin tree failed to load|cannot get property|cannot resolve profile bundle/;

function skipStartingCopy() {
  return {
    status: '正在以官方组合启动',
    hint: '第三方插件导致上次启动失败，已暂时跳过',
  };
}

function startupErrorLabel() {
  return '启动失败';
}

function retryActionLabel(runtimeFailure) {
  return runtimeFailure ? '立即重启' : '重试';
}

function downloadLogLabel() {
  return '下载日志';
}

function openLauncherLabel() {
  return '回启动器排查';
}

/**
 * The boot page bridges to the launcher only on a settled startup failure:
 * plugin-level recovery (attribution, per-plugin disable, skip) lives on the
 * launcher Recovery Board and the boot page never grows its own copy. While
 * an auto-restart is scheduled or running the failure is not settled yet, so
 * the bridge stays hidden and the countdown actions keep the stage.
 */
function showLauncherBridge(state) {
  return state === 'error';
}

function isImportantBootLog(line) {
  return LOG_ERROR_PATTERN.test(String(line ?? ''));
}

const api = {
  LOG_ERROR_PATTERN,
  skipStartingCopy,
  startupErrorLabel,
  retryActionLabel,
  downloadLogLabel,
  openLauncherLabel,
  showLauncherBridge,
  isImportantBootLog,
};

if (typeof module === 'object' && module.exports) {
  module.exports = api;
}
if (typeof globalThis === 'object') {
  globalThis.BootRecovery = api;
}
