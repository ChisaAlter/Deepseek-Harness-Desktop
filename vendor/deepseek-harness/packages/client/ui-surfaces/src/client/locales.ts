/** `surfaces` namespace dictionaries: empty-state cards and tab chrome. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'empty.title': '打开一个面板',
  'empty.subtitle': '选择要在右侧栏显示的内容。',
  'card.browser': '浏览器',
  'card.browser.description': '打开本地应用或 URL。',
  'card.browser.disabled': '浏览器预览仅在桌面应用中可用。',
  'card.terminal': '终端',
  'card.terminal.description': '在此工作区启动一个 shell。',
  'card.files': '文件',
  'card.files.description': '浏览并阅读工作区文件。',
  'card.diff': '差异',
  'card.diff.description': '查看 git 变更。',
  'card.diff.disabled': '差异仅适用于 Git 仓库。',
  'card.agents': '代理',
  'card.agents.description': '查看正在运行的代理。',
  'tab.close': '关闭',
  'tab.closeOthers': '关闭其他',
  'tab.closeToRight': '关闭右侧',
  'tab.closeAll': '全部关闭',
  'tab.add': '打开面板',
  'unsaved.title': '放弃未保存的更改？',
  'unsaved.body': '关闭后，此文件中未保存的编辑将丢失。',
  'unsaved.bodyMany': '关闭后，这些文件中未保存的编辑将丢失。',
  'unsaved.discard': '放弃更改',
  'unsaved.keep': '继续编辑',
  'unsaved.save': '保存',
  'unsaved.close': '关闭',
} satisfies Record<string, string>

/** The surfaces namespace key union. */
export type SurfacesKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'empty.title': 'Open a surface',
  'empty.subtitle': 'Choose what to show in the right panel.',
  'card.browser': 'Browser',
  'card.browser.description': 'Open a local app or URL.',
  'card.browser.disabled': 'Browser previews are only available in the desktop app.',
  'card.terminal': 'Terminal',
  'card.terminal.description': 'Start a shell in this workspace.',
  'card.files': 'Files',
  'card.files.description': 'Browse and read workspace files.',
  'card.diff': 'Diff',
  'card.diff.description': 'Review git changes.',
  'card.diff.disabled': 'Diff is only available in Git repositories.',
  'card.agents': 'Agents',
  'card.agents.description': 'Inspect running agents.',
  'tab.close': 'Close',
  'tab.closeOthers': 'Close others',
  'tab.closeToRight': 'Close to the right',
  'tab.closeAll': 'Close all',
  'tab.add': 'Open a surface',
  'unsaved.title': 'Discard unsaved changes?',
  'unsaved.body': 'Closing discards unsaved edits in this file.',
  'unsaved.bodyMany': 'Closing discards unsaved edits in these files.',
  'unsaved.discard': 'Discard changes',
  'unsaved.keep': 'Keep editing',
  'unsaved.save': 'Save',
  'unsaved.close': 'Close',
} satisfies Record<SurfacesKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'surfaces'
