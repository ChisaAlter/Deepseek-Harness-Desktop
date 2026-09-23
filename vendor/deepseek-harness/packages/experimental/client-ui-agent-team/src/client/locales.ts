/** Agent Teams Web dictionaries. */

/** Locale namespace owned by the Agent Teams Web UI. */
export const NS = 'agent-team'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  trigger: 'Agent Team',
  refresh: '刷新 Team',
  close: '关闭',
  loading: '正在加载 Team…',
  empty: '还没有共享任务',
  roster: '成员',
  tasks: '共享任务',
  model: '模型',
  open: '打开 teammate 会话',
  owner: 'Owner',
  unowned: '未分配',
  blockedBy: '依赖',
  writeScopes: '写入范围',
  ready: '可开始',
  blocked: '被依赖阻塞',
  'memberStatus.running': '运行中',
  'memberStatus.inactive': '未运行',
  'memberStatus.provisioning': '准备中',
  'memberStatus.failed': '失败',
  'status.pending': '待处理',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
} satisfies Record<string, string>

/** Agent Teams locale key union. */
export type TeamKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  trigger: 'Agent Team',
  refresh: 'Refresh Team',
  close: 'Close',
  loading: 'Loading Team…',
  empty: 'No shared tasks yet',
  roster: 'Members',
  tasks: 'Shared tasks',
  model: 'Model',
  open: 'Open teammate conversation',
  owner: 'Owner',
  unowned: 'Unowned',
  blockedBy: 'Blocked by',
  writeScopes: 'Write scopes',
  ready: 'Ready',
  blocked: 'Blocked by dependencies',
  'memberStatus.running': 'Running',
  'memberStatus.inactive': 'Inactive',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
} satisfies Record<TeamKey, string>
