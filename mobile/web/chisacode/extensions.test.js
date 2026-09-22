import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extensionStatusLabel,
  listMobileMcpServers,
  listMobileSkills,
  skillSourceLabel,
} from './extensions.js';

test('extensionStatusLabel maps all known statuses and keeps unknown verbatim', () => {
  assert.equal(extensionStatusLabel('enabled'), '已启用');
  assert.equal(extensionStatusLabel('global-disabled'), '已全局停用');
  assert.equal(extensionStatusLabel('provider-enabled'), '按提供方启用');
  assert.equal(extensionStatusLabel('provider-disabled'), '按提供方停用');
  assert.equal(extensionStatusLabel('agent-enabled'), '按会话启用');
  assert.equal(extensionStatusLabel('agent-disabled'), '按会话停用');
  assert.equal(extensionStatusLabel('future-status'), 'future-status');
});

test('skillSourceLabel maps source scopes with an unknown fallback', () => {
  assert.equal(skillSourceLabel('project'), '项目');
  assert.equal(skillSourceLabel('agents-home'), 'AGENTS 主目录');
  assert.equal(skillSourceLabel('bundled'), '内置');
  assert.equal(skillSourceLabel('martian'), '未知来源');
});

test('listMobileMcpServers maps servers with transport, source, status, and overrides', async () => {
  const client = {
    async listAgentMcpServers() {
      return {
        servers: [
          {
            name: 'github',
            label: 'GitHub',
            description: 'repo tools',
            source: 'user',
            removable: true,
            editable: true,
            config: { type: 'http', url: 'https://mcp.example' },
            statusByScope: {
              global: 'enabled',
              providers: { dsh: 'provider-disabled' },
              agents: { 'agent-1': 'agent-enabled', 'agent-2': 'agent-disabled' },
            },
            errors: ['handshake slow'],
          },
          {
            name: 'local-fs',
            source: 'system',
            config: { type: 'stdio', command: 'fs-mcp' },
            statusByScope: { global: 'global-disabled', providers: {}, agents: {} },
            errors: [],
          },
          { name: '', config: { type: 'sse' } },
        ],
        errors: ['policy file unreadable'],
      };
    },
  };
  const result = await listMobileMcpServers(client);
  assert.deepEqual(result.errors, ['policy file unreadable']);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    name: 'github',
    label: 'GitHub',
    description: 'repo tools',
    transport: 'http',
    source: 'user',
    status: 'enabled',
    statusLabel: '已启用',
    enabled: true,
    overrides: { providers: 1, agents: 2 },
    errors: ['handshake slow'],
  });
  assert.equal(result.rows[1].label, 'local-fs');
  assert.equal(result.rows[1].enabled, false);
  assert.equal(result.rows[1].statusLabel, '已全局停用');
  assert.equal(result.rows[1].source, 'system');
});

test('listMobileSkills maps skills with sources and status', async () => {
  const client = {
    async listAgentSkills() {
      return {
        skills: [
          {
            name: 'release-notes',
            description: '生成发布说明',
            sources: [
              { id: 's1', type: 'project', path: '/repo/.agents/skills/release-notes', removable: false },
              { id: 's2', type: 'weird-new-type', path: '/x', removable: false },
              { id: 's3', type: 'bundled' },
            ],
            statusByScope: { global: 'enabled', providers: {}, agents: { a1: 'agent-disabled' } },
            errors: [],
          },
        ],
        errors: [],
      };
    },
  };
  const result = await listMobileSkills(client);
  assert.deepEqual(result.errors, []);
  const skill = result.rows[0];
  assert.equal(skill.name, 'release-notes');
  assert.equal(skill.enabled, true);
  assert.equal(skill.statusLabel, '已启用');
  assert.deepEqual(skill.overrides, { providers: 0, agents: 1 });
  // Source without a path is dropped; unknown type gets the honest fallback label.
  assert.deepEqual(skill.sources, [
    { type: 'project', typeLabel: '项目', path: '/repo/.agents/skills/release-notes' },
    { type: 'weird-new-type', typeLabel: '未知来源', path: '/x' },
  ]);
});

test('empty inventories are valid states, and transport failures propagate', async () => {
  const empty = {
    async listAgentMcpServers() { return { servers: [], errors: [] }; },
    async listAgentSkills() { return { skills: [], errors: [] }; },
  };
  assert.deepEqual(await listMobileMcpServers(empty), { rows: [], errors: [] });
  assert.deepEqual(await listMobileSkills(empty), { rows: [], errors: [] });

  const failing = {
    async listAgentMcpServers() { throw new Error('daemon offline'); },
    async listAgentSkills() { throw new Error('daemon offline'); },
  };
  await assert.rejects(() => listMobileMcpServers(failing), /daemon offline/);
  await assert.rejects(() => listMobileSkills(failing), /daemon offline/);
});
