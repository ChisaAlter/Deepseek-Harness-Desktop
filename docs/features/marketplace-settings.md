# Feature: Marketplace in Settings

| Field | Value |
| --- | --- |
| **id** | `marketplace-settings` |
| **status** | `active` |
| **last verified** | 2026-09-04 — v0.2.9 候选构建 run `33893084322` 的 Windows packaged smoke 双轮稳定暴露内置市场 `missing-source:package.json`：解压 runtime 只保证 `node_modules/@deepseek-ai/dsh-client-ui-settings-market`，旧解析却只查 workspace `packages/client/ui-settings-market`。解析器现保留源码 workspace 优先，并回退到 after-pack 已验证的拍平 `node_modules` 包；秒级 packaged-layout 红测由失败转绿，原始默认路径复现转绿，相关 `dsh-market-desktop` / Harness controller / dsh runtime / after-pack / packaged P0 门禁 117/117 通过。此前 2026-08-27（合并后收口第二轮）— `refresh:marketplace-snapshot` 对 live registry 刷新快照 6→200 行（退役家族行 0，快照回归测试绿）；status-rotator 行转为 npm 发布导致规格锚点变化，github 通道安装测试改钉 github-only fixture（快照刷新不再能翻转其规格）；`install_dsh_plugin` 安装通道治理收进本卡独立小节 + rules 同步；desktop `npm test` 1224/1219 绿，skip compose 契约对真实构建 CLI（Linux）通过。此前同日（收口复核）— 随包离线快照剔除退役家族行（`marketplace-registry-snapshot.json` 里的 `omdsh-dev/dsh-genui`；该行本就被 `isDropped` 渲染期过滤，但精选子集不该携带退役插件占坑），新增快照无退役行的回归测试；desktop `npm test` 1124/0/5 绿，vendor market 包 vitest 4 文件 42/42 绿，skip compose 契约对真实构建 CLI（Linux）双轮通过，`smoke:source`（xvfb）端到端通过。同日早些 — 三项收口：**(1) DROPPED 家族改名绕过封堵**——`isDroppedPluginName` 按去 scope 的 basename 整段匹配退役家族（`@changfenhuang/dsh-genui` 这类换 scope / 换 GitHub owner 的再发布不再漏网），贯通 profile 清理（`stripDroppedPlugins`）、目录隐藏（`isDropped` 同时查 `packageName` 与 `repo`）与两条安装入口（`isDroppedInstallSpec` 覆盖 npm 名、github repo 名与 `#path:` 尾段；仅整段匹配，`dsh-genui-viewer` 等相似名不受影响）；**(2) 目录响应上限**——`fetchRegistry` 流式读 body 且封顶 8 MiB（`MAX_REGISTRY_BYTES`，content-length 预检 + chunked 累计双保险），超限视同拉取失败走缓存/快照回退；**(3) 发现页分页**——每页 60 张卡（`DISCOVER_PAGE_SIZE`）+「加载更多（剩余 N）」按钮，搜索/分类变化回第一页，计数行仍报全量过滤总数（2286 行目录不再一次性挂 DOM）。desktop marketplace 引擎测试与 vendor market-section specs（29/29）全绿。此前 2026-08-26 — PR #46 全面复审（第二轮）：主进程 `installMarketplacePlugin` 补上已弃用行拒绝（此前只有 UI 隐藏安装按钮，引擎可被直接 IPC 绕过），目录刷新抛错时保留已展示目录并给出可重试 `role="alert"`（对齐市场失败约定「抛错保留上一份卡片」），刷新进行中禁用按钮并改标「刷新中…」（启用此前闲置的 `refreshing` 文案），分类 chips 组改用独立「分类」aria-label（不再与页签 tablist 同名）；README 已装匹配描述从「子串」更正为边界匹配。vendor `ui-settings-market` vitest 4 文件 40/40 绿（market-section 27、spec-match 8、browser-plugin 4、invariant 1），vendor `test:gui` 全绿（410 文件 / 5373 测试），desktop marketplace 引擎测试 48/48 绿，包目录 oxlint 干净。此前同日评审跟进：安装按钮门禁（`deprecated` / 空 `installSpec`）、页签 tab/tabpanel ARIA 关联（`market-tab-*` ↔ `market-panel-*`）、刷新按钮 `title`、`spec-match.ts` owner/repo 整段边界匹配（`github:acme/demo-extra` 不再误配 `acme/demo`）；`qa:source` 复跑全绿：73 PASS / 3 SKIP（均与市场无关）/ 0 FAIL，含 market.section / market.discover / market.installed PASS（Linux xvfb 源码运行，[结果](../qa/results/2026-08-26/market-follow-up-qa-source.md)）。同日早些时候：市场分区重排为「发现 / 已安装」双页签官方样式（`Pill` 页签、`Input` 搜索、头像 / 星标 / 分类 / 主页链接卡片、已安装按目录分类分组 + 未分组置底）。同日（PR #44）打包门禁补齐：`assertHarnessRuntime` 新增 `assertDesktopForkRuntime`，逐一校验 `DESKTOP_PACKAGES`（含 `ui-settings-market`）在打包运行时里 package.json + 声明入口文件齐全——此前门禁只点名 mcp/skills 旧包，陈旧 deploy 目录可打出缺 `ui-settings-market` 的 Setup，启动时 Loader 从 profile 目录导入该行直接 `ERR_MODULE_NOT_FOUND` 且 skip/恢复全部无效。此前 2026-08-25（合并树 `ea659884`）：consolidation #39 后 desktop `npm test` 997/0/3 绿（含 dshmarket-preset 单测）+ `qa:source` market.section/discover/installed 步骤 PASS；Deferred 定为 v1 明确不移植；`vendor/dshmarket` 收缩为 attribution stub |

## User paths

1. 设置 → 市场（`market`，由桌面自有包 `ui-settings-market` 注册）：「发现」页浏览目录、搜索、分类过滤、刷新；卡片带作者头像、星标、分类标签、主页链接与已弃用徽标。
2. 按 catalog id 安装 → 见进度行 → 成功则卡片标「已安装」；失败有 `role="alert"` 反馈。
3. `needsAllowBuilds` 时出现内联确认（列出 allowBuilds key），允许后自动重试。
4. 「已安装」页签（标签带数量）按目录分类分组列出 profile 插件行（目录外归「未分组」），逐行卸载后列表更新且应用仍可用；空态指回「发现」页。
5. 托盘 / 菜单「插件市场」进入设置市场分区，不出现独立 BrowserWindow。

## Invariants

- **市场是桌面自有代码**：UI 是 `vendor/deepseek-harness/packages/client/ui-settings-market`
  （桌面 fork 包，登记于 `harness-desktop-forks.js`），引擎是主进程
  `marketplace-catalog.js` / `marketplace-install.js`。不再预置安装第三方 `dshmarket`
  插件；`vendor/dshmarket` 只剩 attribution stub（LICENSE + `DESKTOP-FORK.md` +
  marker `package.json`，源码快照已删），不打包、不自动装。
- `dshmarket` 在 `DROPPED` 名单：Loader 不挂载它（含用户旧装副本），保证只有一个
  `market` 分区；磁盘文件不删除。启动时 `removeDshMarketPreset` 只清理桌面预置残留
  （受管 patch 块、`desktop-plugins/dshmarket` 副本、预置 symlink）。
- 市场是设置内 section，**无**独立 Electron 市场窗。
- 安装走桌面 IPC / catalog id（`shell:install-marketplace-plugin`），不往 Composer 塞安装草稿。
- 未安装卡片只在可安装时提供「安装」按钮：`deprecated` 或空 `installSpec` 的行不出安装入口；
  主进程 `installMarketplacePlugin` 在进 CLI 之前同样拒绝已弃用行与无法解析的规格
  （已装行不受影响，仍显示「已安装」标记 + 卸载）。
- 已安装 ↔ 目录行的规格匹配走 `spec-match.ts` 的 owner/repo 整段边界匹配
  （`packageName` 精确匹配优先），不做子串 `includes`。
- 退役判定按**家族**而非精确名：`isDroppedPluginName`（`plugins.js`）对 `DROPPED`
  精确名之外再按去 scope 的 basename 整段匹配（`DROPPED_BASENAMES`），目录隐藏与
  两条安装入口（catalog id / 直接 spec）一致执行；换 scope、换 GitHub owner 或
  `#path:` 尾段命中家族名的再发布一律拒绝，相似但不同段的名字不受影响。
- 目录拉取有硬上限：`fetchRegistry` 流式读取且封顶 `MAX_REGISTRY_BYTES`（8 MiB），
  超限按拉取失败处理（缓存 / 快照回退），不允许远端响应无界占用内存。
- 随包离线快照（`marketplace-registry-snapshot.json`）是断网首启兜底的精选子集，
  **不携带退役家族行**（快照刷新时由回归测试把关）。
- 「发现」页分页渲染：每页 `DISCOVER_PAGE_SIZE`（60）张卡 + 「加载更多」按钮，
  搜索 / 分类变化重置回第一页；计数行始终报全量过滤总数。
- 安装落点是桌面 `dsh-home/profiles/web`，不是官方 `~/.dsh`（见 [dsh-home](dsh-home.md)）。
- 重启归 HarnessController（`restartAfterProfileWrite` → `startHarness`），无游离 dshmarket 重启路径。
- Harness 未就绪时不以空市场窗硬装。
- 失败可见（`role="alert"` / 进度行），不静默；「已写入 profile 但 Harness 未起」也要提示。
  目录刷新失败时保留已展示的目录并给出可重试的 `role="alert"` 行（只有首次加载才落纯错误态）；
  刷新进行中按钮禁用并改标「刷新中…」。

## 安装通道治理（`install_dsh_plugin` 会话内工具）

会话内模型可见的安装工具由桌面自有 Host 插件 `dshd-desktop-plugin-install`
（`src/host/install-dsh-plugin.mjs`）注册；`@deepseek-ai/dsh-tools` 从运行中的
Harness 解析，解析失败只跳过注册、不拖垮 Host。

- **注册条件**：仅当主进程 `desktop-install-control.js` 把回环控制端点注入环境
  （`DSH_DESKTOP_INSTALL_URL` / `DSH_DESKTOP_INSTALL_TOKEN`）时注册。端点只听
  `127.0.0.1` 随机端口，鉴权是每次启动新生成的 64-hex Bearer token，body 上限 64 KiB。
- **通道范围 github-only**：工具客户端与端点两侧共用同一份 `isValidGithubSpec`
  （`src/host/install-dsh-plugin-client.js`）校验 `github:owner/repo[#ref]`
  （owner/repo/ref 全模式校验；`..`、`@{`、尾 `.` / `/` 拒绝）。npm 名、tarball、
  本地路径、git URL、`#path:` monorepo 规格一律进不了该通道——`#path:` 只能走
  curated 目录 `installMarketplacePlugin(id)`（`shell:install-marketplace-plugin`）。
- **allowBuilds 白名单**：`normalizeAllowBuilds` 上限 32 条，仅接受合法包名 /
  `github.com/owner/repo` / `name@git+https://github.com/owner/repo.git` 三种 key；
  非法整体拒绝，不进 CLI。`needsAllowBuilds` 握手：pnpm 拦下 prepare scripts 时
  工具返回 key 列表，模型必须先问用户、再带获批 allowBuilds 重试。
- **信任边界在主进程**：端点内 `installPlugin` 独立复验（github-only +
  `isDroppedInstallSpec` 退役家族拒绝 + 与市场安装共享 `withPluginLock` 互斥）；
  Host 工具侧校验只是提前失败，不是安全边界。
- 安装成功（且无 needsAllowBuilds）后由 `startHarness` 延迟重启：HTTP 响应先
  flush、工具结果先落会话日志，再触发重启。

Gate：`src/host/install-dsh-plugin-client.test.js`、`src/main/desktop-install-control.test.js`、
`marketplace-install.test.js` 的 `installPlugin` 拒绝面。

## Deferred（v1 明确不移植 — 产品裁剪）

主题商店、备份 / Gist、诊断面板、插件热更新、多 registry 源管理、试用通道：
**won't port**，不是待办。桌面自有市场 v1 的范围就是精选目录浏览 / 搜索 / 安装 / 卸载。
`vendor/dshmarket` 的源码快照已删除（只剩 attribution stub）；若未来某项能力重新立项，
从上游仓库取参考、按 `ui-settings-market` 第一切片的模式新写 desktop fork 包 + 桌面 IPC，
先开新 feature card，不回退到预置插件。

## Allowed touch

- `src/main/dsh-market-desktop.js`（桌面内置市场 overlay 与源码/打包 runtime 包解析）及对应测试
- `src/main/marketplace-*.js`、`dshmarket-preset.js`（清理模块）、`desktop-install-control.js`、`plugins.js`（DROPPED 行）
- `scripts/after-pack.js` 的 `assertDesktopForkRuntime` 打包门禁（只加断言，不动装配逻辑）
- `src/host/install-dsh-plugin-client.js`
- `vendor/deepseek-harness/packages/client/ui-settings-market/`（桌面自有市场 UI）
- `src/shared/harness-desktop-forks.js`（登记行）与 web-app bundle 的注册三件套
- `vendor/dshmarket/`（attribution stub：LICENSE + DESKTOP-FORK.md + marker package.json；不得恢复源码快照或自动安装）
- 相关桌面测试与本卡 / handbook 市场章

## Do not touch

- 恢复独立市场 BrowserWindow
- 恢复 `ensureDshMarketPlugin` 预置安装或 extraResources 打包 dshmarket
- 无关邻域：壁纸、Surfaces、Models（除非用户扩大 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/marketplace-*.test.js`、`dshmarket-preset.test.js`（清理语义）、`harness-desktop-forks.test.js`（vendor 注册三件套）；vendor `ui-settings-market` client specs；`npm run qa:source` 市场分区存在性 |
| Manual / QA | `TC-EXT-001` … `TC-EXT-005`；`TC-DESK-002`（托盘进市场） |

## Sources

- Handbook：[../handbook/modules/marketplace.md](../handbook/modules/marketplace.md)、[../handbook/flows/marketplace-install.md](../handbook/flows/marketplace-install.md)
- Spec：[../superpowers/specs/2026-08-25-marketplace-desktop-integration.md](../superpowers/specs/2026-08-25-marketplace-desktop-integration.md)、[../superpowers/specs/2026-08-18-marketplace-parity-design.md](../superpowers/specs/2026-08-18-marketplace-parity-design.md)
- Agent note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-desktop-owned-market-section.md`
