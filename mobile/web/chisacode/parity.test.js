import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentModelState,
  agentModeState,
  chisaBranchRows,
  chisaCheckoutStatusToVcs,
  createMobileAgent,
  listAgentModels,
  listReadyProviders,
  listWorkspaceChoices,
  runChisaGitAction,
} from './parity.js';

test('listWorkspaceChoices maps the daemon workspace registry, most recent first', async () => {
  const calls = [];
  const client = {
    async fetchWorkspaces(options) {
      calls.push(options);
      return {
        entries: [
          {
            id: 'ws-desktop',
            name: 'desktop',
            projectDisplayName: 'acme/desktop',
            workspaceDirectory: '/repo/desktop',
            projectRootPath: '/repo/desktop',
            gitRuntime: { currentBranch: 'main' },
          },
          {
            id: 'ws-mobile',
            name: '',
            projectRootPath: '/repo/mobile',
          },
          { id: 'ws-broken' },
        ],
      };
    },
  };

  assert.deepEqual(await listWorkspaceChoices(client), [
    {
      id: 'ws-desktop',
      name: 'desktop',
      project: 'acme/desktop',
      cwd: '/repo/desktop',
      branch: 'main',
    },
    {
      id: 'ws-mobile',
      name: '/repo/mobile',
      project: '',
      cwd: '/repo/mobile',
      branch: '',
    },
  ]);
  assert.deepEqual(calls, [{
    sort: [{ key: 'activity_at', direction: 'desc' }],
    page: { limit: 50 },
  }]);
});

test('listWorkspaceChoices rejects an empty registry visibly', async () => {
  await assert.rejects(
    () => listWorkspaceChoices({
      async fetchWorkspaces() {
        return { entries: [] };
      },
    }),
    /没有可用工作区/,
  );
});

test('listReadyProviders keeps only ready+enabled providers with their modes', async () => {
  const calls = [];
  const client = {
    async getProvidersSnapshot(options) {
      calls.push(options);
      return {
        entries: [
          { provider: 'codex', status: 'unavailable', enabled: true },
          { provider: 'disabled', status: 'ready', enabled: false },
          {
            provider: 'dsh',
            status: 'ready',
            enabled: true,
            label: 'DeepSeek Harness',
            modes: [
              { id: 'plan', label: '规划' },
              { id: '', label: 'broken' },
            ],
            defaultModeId: 'plan',
            models: [
              { id: 'ds-r3', label: 'DeepSeek R3', isDefault: true },
              { id: '', label: 'broken' },
            ],
          },
          { provider: 'bare', status: 'ready' },
        ],
      };
    },
  };

  assert.deepEqual(await listReadyProviders(client, '/repo'), [
    {
      provider: 'dsh',
      label: 'DeepSeek Harness',
      modes: [{ id: 'plan', label: '规划' }],
      defaultModeId: 'plan',
      models: [{ id: 'ds-r3', label: 'DeepSeek R3', isDefault: true }],
    },
    { provider: 'bare', label: 'bare', modes: [], defaultModeId: null, models: [] },
  ]);
  assert.deepEqual(calls, [{ cwd: '/repo' }]);
});

test('listReadyProviders rejects missing cwd and empty snapshots visibly', async () => {
  await assert.rejects(() => listReadyProviders({}, ''), /请先选择工作区/);
  await assert.rejects(
    () => listReadyProviders({
      async getProvidersSnapshot() {
        return { entries: [{ provider: 'codex', status: 'unavailable' }] };
      },
    }, '/repo'),
    /没有已就绪的智能体提供方/,
  );
});

test('createMobileAgent passes the explicit workspace, provider, and optional mode to createAgent', async () => {
  const createCalls = [];
  const client = {
    async createAgent(options) {
      createCalls.push(options);
      return { id: 'agent-new', provider: options.provider, cwd: options.cwd, status: 'idle' };
    },
  };

  const created = await createMobileAgent(client, {
    workspaceId: 'ws-mobile',
    cwd: '/repo/mobile',
    provider: 'dsh',
    modeId: 'plan',
  });
  assert.equal(created.id, 'agent-new');

  await createMobileAgent(client, { cwd: '/repo/mobile', provider: 'dsh' });
  await createMobileAgent(client, { cwd: '/repo/mobile', provider: 'dsh', model: 'ds-r3' });
  assert.deepEqual(createCalls, [
    { provider: 'dsh', cwd: '/repo/mobile', workspaceId: 'ws-mobile', modeId: 'plan' },
    { provider: 'dsh', cwd: '/repo/mobile' },
    { provider: 'dsh', cwd: '/repo/mobile', model: 'ds-r3' },
  ]);
});

test('createMobileAgent rejects missing choices and malformed daemon results visibly', async () => {
  await assert.rejects(
    () => createMobileAgent({}, { cwd: '', provider: 'dsh' }),
    /请先选择工作区和提供方/,
  );
  await assert.rejects(
    () => createMobileAgent({}, { cwd: '/repo', provider: '' }),
    /请先选择工作区和提供方/,
  );
  await assert.rejects(
    () => createMobileAgent({
      async createAgent() {
        return {};
      },
    }, { workspaceId: 'ws', cwd: '/repo', provider: 'dsh' }),
    /没有返回会话/,
  );
});

test('agentModeState derives modes and the current label from the agent snapshot only', () => {
  assert.deepEqual(agentModeState({
    currentModeId: 'accept-edits',
    availableModes: [
      { id: 'plan', label: '规划', description: '只读计划' },
      { id: 'accept-edits', label: '自动接受编辑' },
      { label: 'broken-no-id' },
    ],
  }), {
    modes: [
      { id: 'plan', label: '规划', description: '只读计划' },
      { id: 'accept-edits', label: '自动接受编辑', description: '' },
    ],
    currentModeId: 'accept-edits',
    currentLabel: '自动接受编辑',
  });

  assert.deepEqual(agentModeState(null), { modes: [], currentModeId: null, currentLabel: '' });
  assert.deepEqual(agentModeState({ currentModeId: 'ghost', availableModes: [] }), {
    modes: [],
    currentModeId: 'ghost',
    currentLabel: 'ghost',
  });
});

test('agentModelState reads the snapshot model with runtimeInfo fallback', () => {
  assert.deepEqual(agentModelState({ model: 'ds-r3' }), { modelId: 'ds-r3', label: 'ds-r3' });
  assert.deepEqual(
    agentModelState({ runtimeInfo: { model: 'ds-lite' } }),
    { modelId: 'ds-lite', label: 'ds-lite' },
  );
  // null model = provider default in effect.
  assert.deepEqual(agentModelState({}), { modelId: null, label: '' });
  assert.deepEqual(agentModelState(null), { modelId: null, label: '' });
});

test('listAgentModels maps daemon models and surfaces failures visibly', async () => {
  const calls = [];
  const client = {
    async listProviderModels(provider, options) {
      calls.push([provider, options]);
      return {
        models: [
          { id: 'ds-r3', label: 'DeepSeek R3', isDefault: true },
          { id: 'ds-lite' },
          { label: 'broken-no-id' },
        ],
      };
    },
  };
  assert.deepEqual(await listAgentModels(client, 'dsh', '/repo'), [
    { id: 'ds-r3', label: 'DeepSeek R3', description: '', isDefault: true },
    { id: 'ds-lite', label: 'ds-lite', description: '', isDefault: false },
  ]);
  assert.deepEqual(calls, [['dsh', { cwd: '/repo' }]]);

  await assert.rejects(() => listAgentModels(client, '', '/repo'), /没有提供方信息/);
  await assert.rejects(
    () => listAgentModels({
      async listProviderModels() { return { error: 'provider offline' }; },
    }, 'dsh'),
    /provider offline/,
  );
  await assert.rejects(
    () => listAgentModels({
      async listProviderModels() { return { models: [] }; },
    }, 'dsh'),
    /没有返回可选模型/,
  );
});

test('chisaCheckoutStatusToVcs maps checkout and PR payloads to the mobile model', () => {
  assert.deepEqual(chisaCheckoutStatusToVcs({
    isGit: true,
    currentBranch: 'feature/mobile',
    isDirty: true,
    baseRef: 'main',
    aheadBehind: { ahead: 2, behind: 1 },
    aheadOfOrigin: 3,
    behindOfOrigin: 0,
    hasRemote: true,
    error: null,
  }, {
    status: { state: 'OPEN', number: 55, url: 'https://github.example/pr/55' },
    error: null,
  }), {
    isRepo: true,
    refName: 'feature/mobile',
    hasWorkingTreeChanges: true,
    hasUpstream: true,
    aheadCount: 3,
    behindCount: 0,
    isDefaultRef: false,
    hasPrimaryRemote: true,
    pr: { state: 'open', number: 55, url: 'https://github.example/pr/55' },
  });
});

test('chisaBranchRows maps daemon suggestions and marks the current branch', () => {
  assert.deepEqual(chisaBranchRows({
    branches: ['main', 'feature/mobile', 'origin/release'],
    branchDetails: [
      { name: 'main', hasLocal: true, hasRemote: true },
      { name: 'feature/mobile', hasLocal: true, hasRemote: false },
      { name: 'origin/release', hasLocal: false, hasRemote: true },
    ],
    error: null,
  }, 'feature/mobile'), [
    { name: 'main', isRemote: false, isCurrent: false },
    { name: 'feature/mobile', isRemote: false, isCurrent: true },
    { name: 'origin/release', isRemote: true, isCurrent: false },
  ]);
});

test('runChisaGitAction delegates mobile-safe actions and rejects structured failures', async () => {
  const calls = [];
  const client = {
    checkoutRefresh: async (...args) => { calls.push(['refresh', ...args]); return { error: null }; },
    checkoutPull: async (...args) => { calls.push(['pull', ...args]); return { error: null }; },
    checkoutCommit: async (...args) => { calls.push(['commit', ...args]); return { error: null }; },
    checkoutPush: async (...args) => { calls.push(['push', ...args]); return { error: null }; },
    checkoutPrCreate: async (...args) => { calls.push(['pr', ...args]); return { error: null }; },
    checkoutSwitchBranch: async (...args) => { calls.push(['switch', ...args]); return { error: null }; },
  };

  await runChisaGitAction(client, 'gitFetchForStatus', '/repo');
  await runChisaGitAction(client, 'gitPull', '/repo');
  await runChisaGitAction(client, 'gitCommit', '/repo', { message: 'ship parity' });
  await runChisaGitAction(client, 'gitPush', '/repo');
  await runChisaGitAction(client, 'gitCreateChangeRequest', '/repo');
  await runChisaGitAction(client, 'gitSwitchBranch', '/repo', { ref: 'feature/mobile' });
  assert.deepEqual(calls, [
    ['refresh', '/repo'],
    ['pull', '/repo'],
    ['commit', '/repo', { message: 'ship parity', addAll: true }],
    ['push', '/repo'],
    ['pr', '/repo', {}],
    ['switch', '/repo', 'feature/mobile'],
  ]);

  await assert.rejects(
    () => runChisaGitAction({
      async checkoutPush() {
        return { error: { message: 'remote rejected' } };
      },
    }, 'gitPush', '/repo'),
    /remote rejected/,
  );
  await assert.rejects(
    () => runChisaGitAction(client, 'gitCreateBranch', '/repo', { name: 'feature/new' }),
    /请在电脑端操作/,
  );
});
