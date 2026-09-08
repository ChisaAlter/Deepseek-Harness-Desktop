/** Browser QA fixture: real component and tokens, fake mutations only. */
import { createRoot } from 'react-dom/client'
import { MarketSection } from '../../src/client/MarketSection.tsx'
import { zh } from '../../src/client/locales.ts'
import '../../../ui-theme/src/styles/base.css'
import '../../../ui-theme/src/styles/design-platform.css'
import '../../../ui-theme/src/styles/motion.css'
import '../../../ui-theme/src/styles/scrollbar.css'
import './preview.css'

const items = [
  { id: 'acme/dsh-task-board', owner: 'acme', repo: 'dsh-task-board', description: '任务管理与会话进度面板', stars: 120, category: 'workflow', packageName: 'dsh-task-board', installSpec: 'dsh-task-board', homepage: 'https://github.com/acme/dsh-task-board', added: '2026-09-08', screenshots: ['https://raw.githubusercontent.com/dsh-market/dsh-market/v1.45.0/assets/demo-zh.png'] },
  { id: 'acme/dsh-git-changes', owner: 'acme', repo: 'dsh-git-changes', description: '查看工作区变更与提交历史', stars: 85, category: 'workflow', packageName: 'dsh-git-changes', installSpec: 'dsh-git-changes', homepage: 'https://github.com/acme/dsh-git-changes', added: '2026-09-05' },
  { id: 'acme/dsh-very-long-plugin-name-for-layout-verification', owner: 'acme', repo: 'dsh-very-long-plugin-name-for-layout-verification', description: '用于检查长名称、版本差异和操作按钮在窄屏中的布局。', stars: 23, category: 'tools', packageName: 'long-plugin', installSpec: 'long-plugin', homepage: 'https://github.com/acme/long-plugin', added: '2026-08-01' },
]
let state = { ok: true, favorites: [items[0].id], operations: [
  { id: 'previous', kind: 'update', target: 'acme/dsh-git-changes', status: 'failed', startedAt: Date.now(), error: '下载失败；已恢复原版本', log: 'registry request failed\nprofile restored\nAuthorization: [redacted]' },
] }
const props = {
  close: () => {},
  t: ((key, values) => {
    let result = zh[key]
    for (const [name, value] of Object.entries(values || {})) result = result.replaceAll(`{${name}}`, value)
    return result
  }),
  listCatalog: async () => ({ ok: true, items, categories: [{ id: 'all', label: '全部', count: 3 }, { id: 'workflow', label: '工作流', count: 2 }, { id: 'tools', label: '工具', count: 1 }], fetchedAt: Date.now(), source: 'fixture', warning: '' }),
  listInstalled: async () => [{ name: 'dsh-git-changes', spec: '1.0.0' }],
  checkUpdates: async () => ({ ok: true, checkedAt: Date.now(), updates: { [items[1].id]: { id: items[1].id, packageName: 'dsh-git-changes', kind: 'npm', current: '1.0.0', latest: '1.2.0', updateAvailable: true } } }),
  getMarketState: async () => state,
  setFavorite: async (id, favorite) => {
    state = { ...state, favorites: favorite ? [...new Set([...state.favorites, id])] : state.favorites.filter(value => value !== id) }
    return state
  },
  getDetails: async () => ({ ok: true, partial: false, readme: '# 项目说明\n\n使用 DSH 插件入口安装。\n\n- 工作区工具\n- 会话集成\n\n```sh\ndsh plugin list\n```', version: '1.2.0', requirements: ['dsh: >=0.1.0'] }),
  install: async () => ({ ok: true, harnessStarted: true }),
  update: async () => ({ ok: true, harnessStarted: true }),
  updateMany: async () => ({ ok: true, harnessStarted: true }),
  uninstall: async () => ({ ok: true, harnessStarted: true }),
  onProgress: () => () => {},
}
createRoot(document.getElementById('root')).render(<MarketSection {...props} />)
