function errorMessage(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  return '';
}

function assertDaemonSuccess(payload, fallback) {
  const message = errorMessage(payload?.error);
  if (message) throw new Error(message);
  if (payload?.accepted === false) {
    throw new Error(errorMessage(payload) || fallback);
  }
  return payload;
}

/**
 * List the daemon workspace registry for the new-session chooser, most
 * recently active first. An empty registry is a visible error — new sessions
 * never guess a target from the agent list.
 */
async function listWorkspaceChoices(client) {
  const payload = await client.fetchWorkspaces({
    sort: [{ key: 'activity_at', direction: 'desc' }],
    page: { limit: 50 },
  });
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const choices = entries.flatMap((workspace) => {
    const cwd = workspace?.workspaceDirectory || workspace?.projectRootPath || '';
    if (!cwd || typeof workspace?.id !== 'string' || !workspace.id) return [];
    return [{
      id: workspace.id,
      name: typeof workspace.name === 'string' && workspace.name ? workspace.name : cwd,
      project: typeof workspace.projectDisplayName === 'string' ? workspace.projectDisplayName : '',
      cwd,
      branch: typeof workspace?.gitRuntime?.currentBranch === 'string'
        ? workspace.gitRuntime.currentBranch
        : '',
    }];
  });
  if (!choices.length) {
    throw new Error('电脑端没有可用工作区；请先在电脑端打开一个项目');
  }
  return choices;
}

/**
 * List ready + enabled providers for a chosen workspace cwd, including their
 * snapshot modes so the chooser can offer an optional permission mode.
 */
async function listReadyProviders(client, cwd) {
  if (typeof cwd !== 'string' || !cwd) {
    throw new Error('请先选择工作区');
  }
  const snapshot = await client.getProvidersSnapshot({ cwd });
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const ready = entries.flatMap((entry) => {
    if (
      entry?.enabled === false
      || entry?.status !== 'ready'
      || typeof entry?.provider !== 'string'
      || !entry.provider
    ) {
      return [];
    }
    return [{
      provider: entry.provider,
      label: typeof entry.label === 'string' && entry.label ? entry.label : entry.provider,
      modes: Array.isArray(entry.modes)
        ? entry.modes.filter((mode) => typeof mode?.id === 'string' && mode.id)
        : [],
      defaultModeId: typeof entry.defaultModeId === 'string' ? entry.defaultModeId : null,
      models: Array.isArray(entry.models)
        ? entry.models.flatMap((model) => (
            typeof model?.id === 'string' && model.id
              ? [{
                  id: model.id,
                  label: typeof model.label === 'string' && model.label ? model.label : model.id,
                  isDefault: model.isDefault === true,
                }]
              : []
          ))
        : [],
    }];
  });
  if (!ready.length) {
    throw new Error('电脑端没有已就绪的智能体提供方；请先在电脑端完成提供方设置');
  }
  return ready;
}

/**
 * Create an agent from explicit user choices. Phase 0 contract: the caller
 * (workspace/provider chooser) supplies workspaceId + cwd + provider; modeId
 * and model are optional. No guessing from the existing agent list.
 */
async function createMobileAgent(client, { workspaceId, cwd, provider, modeId, model } = {}) {
  if (typeof cwd !== 'string' || !cwd || typeof provider !== 'string' || !provider) {
    throw new Error('请先选择工作区和提供方');
  }
  const agent = await client.createAgent({
    provider,
    cwd,
    ...(typeof workspaceId === 'string' && workspaceId ? { workspaceId } : {}),
    ...(typeof modeId === 'string' && modeId ? { modeId } : {}),
    ...(typeof model === 'string' && model ? { model } : {}),
  });
  if (!agent || typeof agent.id !== 'string' || !agent.id) {
    throw new Error('电脑端没有返回会话；请重试');
  }
  return agent;
}

/**
 * Derive the permission-mode view state from an agent snapshot. The snapshot
 * is the only truth: no local fake mode ever enters this shape.
 */
function agentModeState(agent) {
  const modes = Array.isArray(agent?.availableModes)
    ? agent.availableModes.flatMap((mode) => (
        typeof mode?.id === 'string' && mode.id
          ? [{
              id: mode.id,
              label: typeof mode.label === 'string' && mode.label ? mode.label : mode.id,
              description: typeof mode.description === 'string' ? mode.description : '',
            }]
          : []
      ))
    : [];
  const currentModeId = typeof agent?.currentModeId === 'string' && agent.currentModeId
    ? agent.currentModeId
    : null;
  const current = modes.find((mode) => mode.id === currentModeId) || null;
  return {
    modes,
    currentModeId,
    currentLabel: current ? current.label : (currentModeId || ''),
  };
}

/**
 * Derive the model view state from an agent snapshot. The snapshot is the
 * only truth (`model`, falling back to `runtimeInfo.model`); null means the
 * provider default is in effect.
 */
function agentModelState(agent) {
  const fromSnapshot = typeof agent?.model === 'string' && agent.model ? agent.model : null;
  const fromRuntime = typeof agent?.runtimeInfo?.model === 'string' && agent.runtimeInfo.model
    ? agent.runtimeInfo.model
    : null;
  const modelId = fromSnapshot ?? fromRuntime;
  return { modelId, label: modelId || '' };
}

/**
 * List the selectable models for the current session's provider. A daemon
 * error string or an empty catalog is a visible failure, not a blank picker.
 */
async function listAgentModels(client, provider, cwd) {
  if (typeof provider !== 'string' || !provider) {
    throw new Error('当前会话没有提供方信息');
  }
  const payload = await client.listProviderModels(provider, cwd ? { cwd } : {});
  const message = errorMessage(payload?.error);
  if (message) throw new Error(message);
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const rows = models.flatMap((model) => (
    typeof model?.id === 'string' && model.id
      ? [{
          id: model.id,
          label: typeof model.label === 'string' && model.label ? model.label : model.id,
          description: typeof model.description === 'string' ? model.description : '',
          isDefault: model.isDefault === true,
        }]
      : []
  ));
  if (!rows.length) {
    throw new Error('提供方没有返回可选模型；请在电脑端检查提供方设置');
  }
  return rows;
}

function chisaCheckoutStatusToVcs(status, prPayload = null) {
  assertDaemonSuccess(status, '无法读取 Git 状态');
  const isRepo = status?.isGit === true;
  const refName = typeof status?.currentBranch === 'string' ? status.currentBranch : null;
  const baseRef = typeof status?.baseRef === 'string' ? status.baseRef : null;
  const aheadCount = Number.isInteger(status?.aheadOfOrigin) ? status.aheadOfOrigin : 0;
  const behindCount = Number.isInteger(status?.behindOfOrigin) ? status.behindOfOrigin : 0;
  const rawPr = prPayload?.error ? null : prPayload?.status;
  const pr = rawPr && typeof rawPr === 'object'
    ? {
        state: typeof rawPr.state === 'string' ? rawPr.state.toLowerCase() : null,
        number: Number.isInteger(rawPr.number) ? rawPr.number : null,
        url: typeof rawPr.url === 'string' ? rawPr.url : null,
      }
    : null;
  return {
    isRepo,
    refName,
    hasWorkingTreeChanges: status?.isDirty === true,
    hasUpstream: Number.isInteger(status?.aheadOfOrigin) || Number.isInteger(status?.behindOfOrigin),
    aheadCount,
    behindCount,
    isDefaultRef: Boolean(refName && baseRef && refName === baseRef),
    hasPrimaryRemote: status?.hasRemote === true,
    pr,
  };
}

function chisaBranchRows(payload, currentRef = '') {
  assertDaemonSuccess(payload, '无法列出分支');
  const branches = Array.isArray(payload?.branches) ? payload.branches : [];
  const details = Array.isArray(payload?.branchDetails) ? payload.branchDetails : [];
  const detailByName = new Map(details.map((detail) => [detail?.name, detail]));
  return branches.flatMap((name) => {
    if (typeof name !== 'string' || !name) return [];
    const detail = detailByName.get(name);
    const isRemote = detail
      ? detail.hasRemote === true && detail.hasLocal !== true
      : name.startsWith('origin/');
    return [{
      name,
      isRemote,
      isCurrent: !isRemote && name === currentRef,
    }];
  });
}

async function runChisaGitAction(client, name, cwd, extra = {}) {
  let result;
  if (name === 'gitFetchForStatus') {
    result = await client.checkoutRefresh(cwd);
  } else if (name === 'gitPull') {
    result = await client.checkoutPull(cwd);
  } else if (name === 'gitCommit') {
    result = await client.checkoutCommit(cwd, {
      message: extra.message || undefined,
      addAll: true,
    });
  } else if (name === 'gitPush') {
    result = await client.checkoutPush(cwd);
  } else if (name === 'gitCreateChangeRequest') {
    result = await client.checkoutPrCreate(cwd, {});
  } else if (name === 'gitSwitchBranch') {
    result = await client.checkoutSwitchBranch(cwd, extra.ref);
  } else {
    throw new Error('此 Git 操作尚不支持手机端；请在电脑端操作');
  }
  return assertDaemonSuccess(result, 'Git 操作失败');
}

export {
  agentModelState,
  agentModeState,
  chisaBranchRows,
  chisaCheckoutStatusToVcs,
  createMobileAgent,
  listAgentModels,
  listReadyProviders,
  listWorkspaceChoices,
  runChisaGitAction,
};
