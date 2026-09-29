/**
 * The Android WebView remains the E2EE protocol owner. This module only
 * projects a deliberately narrow, JSON-only view for the native chat screen.
 * In particular, never serialize the client, host, events, image blocks,
 * tool arguments/results, or the persisted pairing secrets.
 */
const string = (value) => typeof value === 'string' ? value : '';
const id = (value) => string(value).slice(0, 256);
const label = (value) => string(value).slice(0, 4096);
const message = (value) => string(value).slice(0, 32_000);
const MAX_SNAPSHOT_JSON = 1_400_000; // Android rejects snapshots above 1.5 MB.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNativeBootstrapEpoch(value) {
  return typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
}

export function nativeSessionTitle(row) {
  return label(row?.projections?.values?.title || row?.title || (row?.blank ? '新会话' : '未命名会话'));
}

export function projectNativeRows(rows) {
  // Keep the newest answer intact while bounding older content. Full history
  // remains in the E2EE client and the browser's original timeline.
  const visible = Array.isArray(rows) ? rows.slice(-200) : [];
  let newestAnswer = -1;
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (visible[index]?.role === 'assistant') {
      newestAnswer = index;
      break;
    }
  }
  return visible.map((row, index) => {
    const base = { id: id(row?.id) || `row-${index}`, role: 'meta', text: '', running: row?.running === true };
    switch (row?.role) {
      case 'user':
        return { ...base, role: 'user', text: [message(row.text).slice(0, 8_000), row.images?.length ? '图片附件' : ''].filter(Boolean).join('\n') };
      case 'assistant':
        return { ...base, role: 'assistant', text: message(row.text).slice(0, index === newestAnswer ? 32_000 : 8_000) };
      case 'error':
        return { ...base, role: 'error', text: label([row.title, row.text].filter((part) => typeof part === 'string').join('：')) };
      case 'tool': {
        // Tool detail, command, arguments and output may contain credentials.
        const name = label(row.text) || '工具调用';
        const status = row.running ? '运行中' : row.status === 'failed' ? '失败' : row.status === 'canceled' ? '已取消' : '完成';
        return { ...base, role: 'tool', text: `${name} · ${status}` };
      }
      case 'turn-process': {
        const counts = [
          row.toolCalls > 0 ? `${row.toolCalls} 次工具调用` : '',
          row.messages > 0 ? `${row.messages} 条消息` : '',
          row.subagents > 0 ? `${row.subagents} 个子智能体` : '',
        ].filter(Boolean);
        return { ...base, text: counts.join(' · ') || '已思考' };
      }
      case 'reasoning':
        return { ...base, text: row.running ? '思考中…' : '已思考' };
      case 'todo':
        return { ...base, text: `${Array.isArray(row.items) ? row.items.length : 0} 项待办` };
      case 'changes':
        return { ...base, text: `${Array.isArray(row.files) ? row.files.length : 0} 个文件有改动` };
      case 'meta':
        return { ...base, text: label(row.text) };
      default:
        return { ...base, text: '暂不支持的消息' };
    }
  });
}

export function projectNativeApproval(pending, readOnly = false) {
  if (!pending || readOnly) return null;
  const actions = pending.legacy
    ? [{ id: 'rejected', label: '拒绝' }, { id: 'allowed-once', label: '允许一次' }]
    : Array.isArray(pending.actions) && pending.actions.length
      ? pending.actions.slice(0, 8).map((action) => ({ id: id(action.id), label: label(action.label).slice(0, 128) })).filter((action) => action.id)
      : [{ id: 'deny', label: '拒绝' }, { id: 'allow', label: '允许一次' }];
  return {
    id: id(pending.approvalId || pending.rpcId || pending.requestId),
    title: label(pending.title) || '需要审批',
    command: label(pending.command).slice(0, 2_000),
    error: label(pending.error),
    actions,
  };
}

export function projectNativeSnapshot({ state, rows, title, draft, model, permission, readOnly, sessionReadOnly, permissionOptions = [], seq = 0, epoch = '' }) {
  const sessionId = id(state.sessionId);
  const selectedModel = state.modelCatalog?.current;
  const snapshot = {
    epoch: isNativeBootstrapEpoch(epoch) ? epoch : '',
    seq: Number.isSafeInteger(seq) && seq >= 0 ? seq : 0,
    route: state.connected && state.route === 'chat' ? 'chat' : state.route === 'permission' ? 'permission' : 'connect',
    connected: state.connected === true,
    hostName: label(state.hostName).slice(0, 256),
    connLabel: label(state.connLabel).slice(0, 512),
    sessions: (Array.isArray(state.sessions) ? state.sessions : [])
      .filter((row) => row?.sessionId && row.archived !== true)
      .slice(0, 500)
      .map((row) => ({
        id: id(row.sessionId), title: nativeSessionTitle(row).slice(0, 256),
        workspace: label(row.workspaceTitle || row.cwd).slice(0, 256), running: row.running === true,
        readOnly: typeof sessionReadOnly === 'function' ? Boolean(sessionReadOnly(row)) : row.archived === true,
      })),
    sessionId, title: label(title).slice(0, 512), rows: projectNativeRows(rows),
    loading: state.timelineLoading === true,
    error: label(state.timelineError || state.sessionsError).slice(0, 1_000),
    hasOlder: state.timelinePage?.hasOlder === true,
    olderLoading: state.timelineLoadingOlder === true,
    running: state.running === true,
    readOnly: string(readOnly),
    approval: projectNativeApproval(state.pendingApprovals?.[0], readOnly),
    model: label(model).slice(0, 256), permission: label(permission).slice(0, 128), planOn: state.permission?.planOn === true,
    modelCurrent: selectedModel?.provider && selectedModel?.model ? {
      provider: id(selectedModel.provider), id: id(selectedModel.model),
      reasoningEffort: id(selectedModel.reasoningEffort),
    } : null,
    modelOptions: (Array.isArray(state.modelCatalog?.rows) ? state.modelCatalog.rows : [])
      .filter((row) => row?.routable !== false && row.provider && row.id)
      .slice(0, 100)
      .map((row) => ({
        provider: id(row.provider), id: id(row.id), label: label(row.name || row.id).slice(0, 256),
        efforts: (Array.isArray(row.reasoning?.efforts) ? row.reasoning.efforts : [])
          .filter((effort) => effort?.id).slice(0, 12)
          .map((effort) => ({ id: id(effort.id), label: label(effort.name || effort.id).slice(0, 128) })),
      })),
    permissionCurrent: id(state.permission?.current),
    permissionOptions: (Array.isArray(permissionOptions) ? permissionOptions : [])
      .filter((option) => option?.id).slice(0, 12)
      .map((option) => ({ id: id(option.id), label: label(option.label).slice(0, 128) })),
    offline: state.connected === true && state.transport === 'chisacode' && state.connPhase !== 'online',
    banner: label(state.banner).slice(0, 1_000), draft: message(draft),
  };
  // JSON escaping may expand text; prune the oldest projected rows until the
  // entire payload fits. The most recent reply always remains present.
  let serializedLength = JSON.stringify(snapshot).length;
  while (serializedLength > MAX_SNAPSHOT_JSON && snapshot.rows.length > 1) {
    const excess = serializedLength - MAX_SNAPSHOT_JSON;
    let removed = 0;
    do {
      removed += snapshot.rows.shift()?.text.length || 0;
    } while (removed < excess && snapshot.rows.length > 1);
    serializedLength = JSON.stringify(snapshot).length;
  }
  while (serializedLength > MAX_SNAPSHOT_JSON && snapshot.sessions.length > 1) {
    const excess = serializedLength - MAX_SNAPSHOT_JSON;
    const average = serializedLength / snapshot.sessions.length;
    snapshot.sessions.splice(-Math.min(snapshot.sessions.length - 1, Math.max(1, Math.ceil(excess / average))));
    serializedLength = JSON.stringify(snapshot).length;
  }
  return snapshot;
}

const ACTION_FIELDS = {
  open: ['type', 'sessionId'], new: ['type'], send: ['type', 'sessionId', 'text'],
  cancel: ['type', 'sessionId'], approve: ['type', 'sessionId', 'approvalId', 'actionId'],
  older: ['type', 'sessionId'], retry: ['type', 'sessionId'], refresh: ['type'],
  draft: ['type', 'sessionId', 'text'],
  model: ['type', 'sessionId', 'provider', 'model', 'reasoningEffort'],
  permission: ['type', 'sessionId', 'id'], planOff: ['type', 'sessionId'],
  slash: ['type', 'sessionId', 'line'],
};

/** Parse and authorize a native request against the current live UI generation. */
export function validateNativeAction(raw, context) {
  let action;
  try { action = JSON.parse(raw); } catch { return null; }
  if (!action || Array.isArray(action) || typeof action !== 'object') return null;
  const fields = ACTION_FIELDS[action.type];
  if (!fields || Object.keys(action).some((key) => !fields.includes(key))
    || fields.some((key) => !(key in action) && !(action.type === 'model' && key === 'reasoningEffort'))) return null;
  for (const key of fields.filter((key) => key.endsWith('Id'))) {
    if (typeof action[key] !== 'string' || !action[key] || action[key].length > 256) return null;
  }
  if ('text' in action && (typeof action.text !== 'string' || action.text.length > 200_000)) return null;
  if (action.type === 'model') {
    if (typeof action.provider !== 'string' || !action.provider || action.provider.length > 256
      || typeof action.model !== 'string' || !action.model || action.model.length > 256
      || 'reasoningEffort' in action && (typeof action.reasoningEffort !== 'string' || action.reasoningEffort.length > 256)) return null;
  }
  if (action.type === 'permission' && (typeof action.id !== 'string' || !action.id || action.id.length > 256)) return null;
  if (action.type === 'slash' && (typeof action.line !== 'string' || action.line.length > 2_000
    || !/^\/[a-zA-Z][\w-]*(?:\s|$)/.test(action.line.trim()))) return null;
  if (action.type === 'refresh') return action;
  // The draft store is local; an offline composition must survive reconnection.
  if (action.type === 'draft') return context.connected && action.sessionId === context.sessionId && !context.readOnly ? action : null;
  if (!context.connected || context.offline) return null;
  if (action.type === 'new') return action;
  if (action.type === 'open') return context.sessions?.some((row) => row.sessionId === action.sessionId && row.archived !== true) ? action : null;
  if (!context.sessionId || action.sessionId !== context.sessionId) return null;
  if (action.type === 'retry') return context.error ? action : null;
  if (action.type === 'older') return context.hasOlder && !context.olderLoading ? action : null;
  if (action.type === 'cancel') return context.running && !context.readOnly ? action : null;
  if (action.type === 'model' || action.type === 'permission' || action.type === 'planOff' || action.type === 'slash') {
    if (context.readOnly || context.pending || context.sendBusy || context.modeBusy || context.modelBusy) return null;
    if (action.type === 'permission') return context.permissionOptions?.some((item) => item.id === action.id) ? action : null;
    if (action.type === 'planOff') return context.planOn ? action : null;
    if (action.type === 'slash') return action;
    const row = context.modelOptions?.find((item) => item.provider === action.provider && item.id === action.model && item.routable !== false);
    if (!row) return null;
    if (action.reasoningEffort && !row.reasoning?.efforts?.some((effort) => effort.id === action.reasoningEffort)) return null;
    return action;
  }
  if (context.readOnly || context.pending || context.sendBusy) {
    if (action.type !== 'approve' || context.readOnly) return null;
  }
  if (action.type === 'approve') {
    const approval = context.approval;
    if (!approval || approval.responding || approval.sessionId && approval.sessionId !== action.sessionId) return null;
    if (action.approvalId !== (approval.approvalId || approval.rpcId || approval.requestId)) return null;
    const ids = approval.legacy ? ['rejected', 'allowed-once']
      : approval.actions?.length ? approval.actions.map((item) => item.id) : ['deny', 'allow'];
    return ids.includes(action.actionId) ? action : null;
  }
  if (action.type === 'send') return action.text.trim() ? action : null;
  return null;
}
