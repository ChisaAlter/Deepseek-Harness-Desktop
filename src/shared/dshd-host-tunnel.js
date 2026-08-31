'use strict';

/** Visible when `dsh web` is not listening / origin not yet known. */
const HARNESS_DOWN_MESSAGE = '桌面端未启动';

const HOST_RPC_METHODS = new Set([
  'host.describe',
  'host.listDirectory',
  'host.createDirectory',
  'session.list',
  'session.search',
  'session.create',
  'session.history',
  'session.models',
  'session.selectModel',
  'session.rename',
  'session.fork',
  'session.prompt',
  'session.attachment',
  'session.updateQueue',
  'session.cancel',
  'session.delete',
  'subagent.list',
  'subagent.history',
  'subagent.prompt',
  'subagent.interrupt',
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.archiveSession',
  'workspace.unarchiveSession',
  'skill.list',
  'agentPreset.list',
  'llm.models',
  'llm.providers',
  'commands/list',
  'commands/execute',
]);

function isAllowedHostMethod(method) {
  return typeof method === 'string' && HOST_RPC_METHODS.has(method);
}

/** Chunks are redundant once assistant/message exists; 30k of them blow the 30s E2EE RPC. */
const HISTORY_DROP_TYPES = new Set(['assistant/chunk']);

function historyEventType(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.event && typeof entry.event.type === 'string') return entry.event.type;
  if (typeof entry.type === 'string') return entry.type;
  return '';
}

function slimHostRpcValue(method, value) {
  if (method !== 'session.history' && method !== 'subagent.history') return value;
  if (!value || typeof value !== 'object' || !Array.isArray(value.events)) return value;
  return {
    ...value,
    events: value.events.filter((entry) => !HISTORY_DROP_TYPES.has(historyEventType(entry))),
  };
}

function assertLoopbackHarnessOrigin(origin) {
  const raw = typeof origin === 'string' ? origin.trim() : '';
  if (!raw) {
    const error = new Error(HARNESS_DOWN_MESSAGE);
    error.code = 'harness-down';
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const error = new Error(HARNESS_DOWN_MESSAGE);
    error.code = 'harness-down';
    throw error;
  }
  if (parsed.protocol !== 'http:') {
    throw new Error('Harness origin must be loopback http');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Harness origin must be loopback http');
  }
  return parsed.origin;
}

function mintRpcId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loopbackHeaders(originUrl) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'identity',
    host: `${originUrl.hostname}:${originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')}`,
  };
}

async function postHarnessJson({ origin, path, body, fetchImpl, signal }) {
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL(path, `${originUrl.origin}/`);
  if (target.origin !== originUrl.origin) {
    throw new Error('Harness origin must be loopback http');
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(target.href, {
    method: 'POST',
    headers: loopbackHeaders(originUrl),
    body: JSON.stringify(body),
    signal,
    redirect: 'manual',
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`host HTTP ${response.status}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('host returned non-JSON');
  }
}

async function forwardHostRpc({ origin, method, payload, fetchImpl, signal }) {
  if (!isAllowedHostMethod(method)) {
    throw new Error(`host 方法不允许转发：${method}`);
  }
  const rpcId = mintRpcId();
  const full = await postHarnessJson({
    origin,
    path: `/api/${method}`,
    body: { type: 'client-request', rpcId, method, payload: payload ?? {} },
    fetchImpl,
    signal,
  });
  if (full?.type !== 'server-response') {
    throw new Error(`unexpected response type for ${method}`);
  }
  if (full.rpcId && full.rpcId !== rpcId) {
    throw new Error(`rpcId mismatch for ${method}`);
  }
  if (!full.result || full.result.ok !== true) {
    return {
      ok: false,
      rpcId,
      error: full.result?.error || { code: 'internal', message: 'request failed' },
    };
  }
  return { ok: true, rpcId, value: slimHostRpcValue(method, full.result.value) };
}

async function forwardHostRespond({ origin, rpcId, value, fetchImpl, signal }) {
  if (typeof rpcId !== 'string' || !rpcId) {
    throw new Error('respond 缺少 rpcId');
  }
  return postHarnessJson({
    origin,
    path: '/api/respond',
    body: {
      type: 'client-response',
      rpcId,
      result: { ok: true, value },
    },
    fetchImpl,
    signal,
  });
}

module.exports = {
  HARNESS_DOWN_MESSAGE,
  HOST_RPC_METHODS,
  isAllowedHostMethod,
  assertLoopbackHarnessOrigin,
  forwardHostRpc,
  forwardHostRespond,
  slimHostRpcValue,
};
