// 桌面专用行永不出现在手机设置里（S10 语义保留；settings.describe 只读行已随 S9 下线）。
export const DESKTOP_ONLY_ROWS = ['关闭窗口时', 'Harness 自动恢复', '打开配置文件'];

// 路由与 Android Route 枚举对齐：Connect / Scan / Permission / Chat。设置是 chat 上的 overlay。
export function visibleScreen(state) {
  if (state?.route === 'scan') return 'scan';
  if (state?.route === 'permission') return 'permission';
  if (state?.connected) return 'chat';
  return 'connect';
}

export function settingsHasDesktopRows(labels) {
  return (labels || []).some((label) => DESKTOP_ONLY_ROWS.includes(label));
}
