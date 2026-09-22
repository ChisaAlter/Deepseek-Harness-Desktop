import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelLabel,
  gitStatusLine,
  schemeLabel,
  schemeIsDark,
  hostSettingsSection,
  settingsGroups,
} from './settings-hub.js';
import { parseVcsStatus } from '../git/vcs-parse.js';

// 对应 DshViewModel.channelLabel()。
test('channelLabel tells relay apart from LAN', () => {
  assert.equal(channelLabel('https://relay.example'), 'HTTPS 中继');
  assert.equal(channelLabel('HTTPS://RELAY.EXAMPLE'), 'HTTPS 中继');
  assert.equal(channelLabel('http://192.168.1.23:3180'), '局域网 :3180');
  assert.equal(channelLabel(''), '局域网 :3180');
});

// 对应 DshViewModel.gitStatusLine()。
test('gitStatusLine mirrors the Android status line', () => {
  assert.equal(gitStatusLine(parseVcsStatus(null)), '— · 已与上游同步');
  assert.equal(
    gitStatusLine(parseVcsStatus({ isRepo: true, refName: 'main', hasWorkingTreeChanges: true, aheadCount: 2 })),
    'main · 有未提交改动 · 领先 2',
  );
  assert.equal(
    gitStatusLine(parseVcsStatus({ isRepo: true, refName: 'feat', behindCount: 1, pr: { state: 'open', number: 7 } })),
    'feat · 落后 1 · PR #7',
  );
  assert.equal(
    gitStatusLine(parseVcsStatus({ isRepo: true, refName: 'feat', pr: { state: 'closed', number: 7 } })),
    'feat · 已与上游同步',
  );
});

test('schemeLabel and schemeIsDark cover light/dark/system', () => {
  assert.equal(schemeLabel('light'), '浅色');
  assert.equal(schemeLabel('dark'), '深色');
  assert.equal(schemeLabel('system'), '跟随系统');
  assert.equal(schemeIsDark('dark', false), true);
  assert.equal(schemeIsDark('light', true), false);
  assert.equal(schemeIsDark('system', true), true);
  assert.equal(schemeIsDark('system', false), false);
});

// 对应 Android HostRequestPane 的 sectionId 映射。
test('hostSettingsSection maps host panes to desktop settings sections', () => {
  assert.equal(hostSettingsSection('MCP'), 'mcp');
  assert.equal(hostSettingsSection('技能'), 'skills');
  assert.equal(hostSettingsSection('插件'), 'plugins');
  assert.equal(hostSettingsSection('市场'), 'market');
  assert.equal(hostSettingsSection('模型'), '');
  assert.equal(hostSettingsSection('关于'), '');
});

test('settingsGroups mirrors the Android hub group table', () => {
  const groups = settingsGroups({
    channel: 'HTTPS 中继',
    accessMode: '只读',
    gitLine: 'main · 已与上游同步',
    scheme: 'system',
  });
  assert.deepEqual(groups.map((group) => group.label), [
    '这次连接', '对话', '工作区', '这台手机', '电脑与界面', 'Host', '关于',
  ]);
  assert.deepEqual(
    groups.flatMap((group) => group.rows.map((row) => row.pane)),
    ['连接详情', '断开这台设备', '通用设置', '权限', '模型', '工作区', '文件', '外观',
      '电脑外观', '界面设置', 'MCP', '技能', '插件', '市场', '关于'],
  );
  const disconnect = groups[0].rows[1];
  assert.equal(disconnect.danger, true);
  assert.equal(disconnect.action, 'logout');
  assert.equal(groups[0].rows[0].desc, 'HTTPS 中继');
  assert.equal(groups[1].rows[1].desc, '只读');
  assert.equal(groups[2].rows[0].desc, 'main · 已与上游同步');
  assert.equal(groups[3].rows[0].desc, '跟随系统');
});

test('权限 row falls back to provider-decided copy when no snapshot mode exists', () => {
  const groups = settingsGroups({ channel: '', accessMode: '', gitLine: '', scheme: 'light' });
  const row = groups[1].rows.find((entry) => entry.pane === '权限');
  assert.equal(row.desc, '由提供方决定');
});

test('remoteReadOnly flips MCP / 技能 / 文件 descriptions to the daemon read-only copy', () => {
  const defaults = settingsGroups({ scheme: 'light' });
  const flat = (groups) => Object.fromEntries(
    groups.flatMap((group) => group.rows.map((row) => [row.pane, row.desc])),
  );
  assert.equal(flat(defaults).MCP, '在电脑上打开');
  assert.equal(flat(defaults)['技能'], '在电脑上打开');
  assert.equal(flat(defaults)['文件'], '搜索并插入到输入框');

  const remote = settingsGroups({ scheme: 'light', remoteReadOnly: true });
  assert.equal(flat(remote).MCP, '只读清单 · 电脑端管理');
  assert.equal(flat(remote)['技能'], '只读清单 · 电脑端管理');
  assert.equal(flat(remote)['文件'], '浏览 · 只读预览 · 插入路径');
  // 插件 / 市场 stay honest desktop-only placeholders — no daemon RPC.
  assert.equal(flat(remote)['插件'], '已挂载清单');
  assert.equal(flat(remote)['市场'], '在电脑上安装');
});
