/** Copy dictionaries for the Usage settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Usage',
  title: 'Usage',
  tabApp: 'App usage',
  range: 'Time range',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  tokens: 'Token usage',
  sessions: 'Sessions',
  messages: 'Messages',
  activeDays: 'Active days',
  streak: 'Current streak',
  topModel: 'Most-used model',
  share: '{share}% share',
  none: 'None',
  heatmap: 'Activity heatmap',
  less: 'Less',
  more: 'More',
  daily: 'Daily token trend',
  models: 'Model usage',
  loading: 'Loading…',
  loadFailed: 'Loading usage failed',
  tokensUnit: 'tokens',
}

export type UsageKey = keyof typeof en

/** Chinese strings (product copy language). */
export const zh: Record<UsageKey, string> = {
  nav: '使用统计',
  title: '使用统计',
  tabApp: '应用用量',
  range: '时间范围',
  last7: '最近 7 天',
  last30: '最近 30 天',
  tokens: 'tokens 用量',
  sessions: '会话数量',
  messages: '消息数量',
  activeDays: '活跃天数',
  streak: '当前连续天数',
  topModel: '最常用模型',
  share: '占比 {share}%',
  none: '无',
  heatmap: '活跃热力图',
  less: '较少',
  more: '较多',
  daily: '按天 Token 趋势',
  models: '模型用量',
  loading: '加载中…',
  loadFailed: '用量加载失败',
  tokensUnit: 'tokens',
}
