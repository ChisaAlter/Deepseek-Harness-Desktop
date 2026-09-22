// 设置 Hub 分组与 pane 路由。镜像 Android DshScreens.kt SettingsHub / SettingsOverlay 的分组表。

function channelLabel(origin) {
  return /^https/i.test(String(origin || '')) ? 'HTTPS 中继' : '局域网 :3180';
}

// 镜像 DshViewModel.gitStatusLine()。
function gitStatusLine(status) {
  const parts = [];
  if (status?.hasWorkingTreeChanges) parts.push('有未提交改动');
  if (status?.aheadCount > 0) parts.push(`领先 ${status.aheadCount}`);
  if (status?.behindCount > 0) parts.push(`落后 ${status.behindCount}`);
  if (status?.pr?.state === 'open' && status.pr.number != null) parts.push(`PR #${status.pr.number}`);
  if (!parts.length) parts.push('已与上游同步');
  return `${status?.refName ?? '—'} · ${parts.join(' · ')}`;
}

function schemeLabel(scheme) {
  if (scheme === 'dark') return '深色';
  if (scheme === 'light') return '浅色';
  return '跟随系统';
}

function schemeIsDark(scheme, systemDark) {
  if (scheme === 'dark') return true;
  if (scheme === 'light') return false;
  return systemDark === true;
}

// 镜像 Android HostRequestPane 的 pane → openSettings sectionId 映射。
function hostSettingsSection(pane) {
  switch (pane) {
    case 'MCP': return 'mcp';
    case '技能': return 'skills';
    case '插件': return 'plugins';
    case '市场': return 'market';
    default: return '';
  }
}

// 分组与行文案与 Android SettingsHub 同表。desc 为动态值时用占位键，由 settingsGroups 解析。
// remoteReadOnly = ChisaCode v2 传输：MCP / 技能有 daemon 只读清单，文件有下钻浏览。
function settingsGroups({ channel, accessMode, gitLine, scheme, remoteReadOnly = false } = {}) {
  return [
    {
      label: '这次连接',
      rows: [
        { pane: '连接详情', desc: channel || '' },
        { pane: '断开这台设备', desc: '退出并清除本机登录', danger: true, action: 'logout' },
      ],
    },
    {
      label: '对话',
      rows: [
        { pane: '通用设置', desc: '语言 · 排队' },
        { pane: '权限', desc: accessMode || '由提供方决定' },
        { pane: '模型', desc: '当前会话' },
      ],
    },
    {
      label: '工作区',
      rows: [
        { pane: '工作区', desc: gitLine || '' },
        { pane: '文件', desc: remoteReadOnly ? '浏览 · 只读预览 · 插入路径' : '搜索并插入到输入框' },
      ],
    },
    {
      label: '这台手机',
      rows: [{ pane: '外观', desc: schemeLabel(scheme) }],
    },
    {
      label: '电脑与界面',
      rows: [
        { pane: '电脑外观', desc: '背景图 · 毛玻璃' },
        { pane: '界面设置', desc: '标题栏 Git · 分栏 · 日志' },
      ],
    },
    {
      label: 'Host',
      rows: [
        { pane: 'MCP', desc: remoteReadOnly ? '只读清单 · 电脑端管理' : '在电脑上打开' },
        { pane: '技能', desc: remoteReadOnly ? '只读清单 · 电脑端管理' : '在电脑上打开' },
        { pane: '插件', desc: '已挂载清单' },
        { pane: '市场', desc: '在电脑上安装' },
      ],
    },
    {
      label: '关于',
      rows: [{ pane: '关于', desc: 'Deepseek-Harness-Desktop' }],
    },
  ];
}

export { channelLabel, gitStatusLine, schemeLabel, schemeIsDark, hostSettingsSection, settingsGroups };
