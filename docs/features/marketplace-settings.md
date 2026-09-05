# Feature: Marketplace in Settings

| Field | Value |
| --- | --- |
| **id** | `marketplace-settings` |
| **status** | `active` |
| **last verified** | 2026-09-05 — v0.2.9 候选 run `33932288931` 证明仅增加拍平 `node_modules` fallback 仍不够：市场 overlay 在 `dsh.start()` 解压 packaged Harness 之前生成，因此默认 runtime 路径当时必然不存在。新增 pre-extract 生命周期红测，overlay 生成不再要求默认 sourceDir 已落盘；显式传入错误 sourceDir 仍 fail closed，解压后的统一 `missingDesktopForkPackages` 与 after-pack 门禁继续校验市场包及声明入口。相关市场 / controller / dsh / after-pack / packaged P0 测试 118/118 通过。此前 2026-09-04 — run `33893084322` 首次暴露 `missing-source:package.json`，补齐源码 workspace 与拍平 runtime 两种解析。此前 2026-08-27 — 市场目录、安装治理、离线快照与分页收口，desktop / vendor / source QA 全绿。 |

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
