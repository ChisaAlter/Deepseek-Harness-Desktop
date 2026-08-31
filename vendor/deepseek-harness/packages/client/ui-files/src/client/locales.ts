/** `files` namespace dictionaries: workspace tree and file preview. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'empty.cwd': '没有工作区，无法浏览文件。',
  'empty.dir': '此目录为空。',
  'listing': '正在列出目录…',
  'error.list': '无法读取目录。',
  'error.read': '无法读取文件。',
  'preview.binary': '无法预览二进制文件。',
  'preview.truncated': '文件过长，仅显示开头。',
  'preview.copy': '复制',
  'preview.copied': '已复制',
  'preview.footnotes': '脚注',
  'mention': '引用到输入框',
  'copy.mention': '复制引用',
  'copy.relative': '复制相对路径',
  'copy.absolute': '复制绝对路径',
  'refresh': '刷新',
  'copied': '已复制',
  'search': '搜索文件',
  'search.clear': '清除搜索',
  'open.folder': '在文件夹中显示',
  'open.system': '系统默认程序',
  'preview.save': '保存',
  'preview.saved': '已保存',
  'preview.source': '源码',
  'preview.render': '渲染',
  'preview.wrap': '自动换行',
  'preview.browser': '在浏览器中打开',
  'preview.comment': '添加到对话',
  'error.write': '无法保存文件。',
  'error.changed': '磁盘上的文件已更改。再次保存将覆盖。',
} satisfies Record<string, string>

/** The files namespace key union. */
export type FilesKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'empty.cwd': 'A workspace is required to browse files.',
  'empty.dir': 'This directory is empty.',
  'listing': 'Listing directory…',
  'error.list': 'Could not list the directory.',
  'error.read': 'Could not read the file.',
  'preview.binary': 'This binary file cannot be previewed.',
  'preview.truncated': 'File is too large; showing the beginning.',
  'preview.copy': 'Copy',
  'preview.copied': 'Copied',
  'preview.footnotes': 'Footnotes',
  'mention': 'Mention in composer',
  'copy.mention': 'Copy mention',
  'copy.relative': 'Copy relative path',
  'copy.absolute': 'Copy absolute path',
  'refresh': 'Refresh',
  'copied': 'Copied',
  'search': 'Search files',
  'search.clear': 'Clear search',
  'open.folder': 'Show in folder',
  'open.system': 'System default',
  'preview.save': 'Save',
  'preview.saved': 'Saved',
  'preview.source': 'Source',
  'preview.render': 'Rendered',
  'preview.wrap': 'Word wrap',
  'preview.browser': 'Open in browser',
  'preview.comment': 'Add to chat',
  'error.write': 'Could not save the file.',
  'error.changed': 'The file changed on disk. Save again to overwrite.',
} satisfies Record<FilesKey, string>

/** Dictionary namespace owned by this plugin. */
export const NS = 'files'
