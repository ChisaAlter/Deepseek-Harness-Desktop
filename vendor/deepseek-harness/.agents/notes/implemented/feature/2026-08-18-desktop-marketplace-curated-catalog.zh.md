# Agent Note: 桌面插件市场精选目录

Status: implemented

[English](2026-08-18-desktop-marketplace-curated-catalog.md) | 中文

## 问题

Host 的 `installPlugin` 只接受 `github:owner/repo[#ref]`。awesome-dsh-plugin 登记表含 npm 和 `#path:` 行，走不了该 Host 通道。桌面因此为主进程 / IPC 保留精选目录拉取和 `installMarketplacePlugin(id)` 白名单，与设置里的产品市场界面分开。

## 决策

**产品市场界面不是这个标签页。** 设置 → 插件市场是预置的 `dshmarket` 插件（`settings.section` id `market`），由 [桌面预置 dshmarket](2026-08-19-desktop-dshmarket-preset.zh.md) 拥有。本笔记拥有主进程精选目录和 Host／IPC 安装白名单。没有 id 为 `marketplace` 的 `settings.plugins.tab`。托盘和菜单的 `openMarketplace()` 仍绝不创建市场 `BrowserWindow`。

**目录是 `https://awesome-dsh-plugin.com/plugins.json`。** 主进程拉取（测试用 `DSHD_MARKETPLACE_REGISTRY_URL`）。超时 4 秒。成功响应必须是带非空 `plugins` 数组的对象。`listMarketplace({ refresh?, locale? })` 的 `locale` 为 `zh` | `en`（默认 `zh`；`zh*` 映射为 `zh`）。磁盘缓存在 `app.getPath('userData')`，`CACHE_VERSION` 为 3，TTL 1 小时。回退顺序是内存、磁盘、打包快照 `src/main/marketplace-registry-snapshot.json`。`source` 为 `live` | `cache` | `snapshot`；非 live 必须带 `warning`。每一层都空时返回 `ok: false`、`items: []` 和可见警告。不搜 GitHub topic。

`installSpec` 与 dsh-market 的 `installTargetFor` 一致：合法的目录 `npm` 包名；否则从 GitHub `url` 得到 `github:owner/repo` 或 `github:owner/repo#path:/<posix>`（`/tree/<ref>/<posix>`）。`install` 的最后一个空白分词只在 `isAllowedMarketplaceSpec` 接受时使用：last-token npm 必须等于该行 `npm` 字段（`npm` 为 null 时 `installSpec` 为空）。tarball、git、file URL 不会成为 `installSpec`。目录 `id` 是 `owner/name`（name 可含 `#`）。

**安装路径分开。** `installMarketplacePlugin(id)` 在当前目录（内存，否则磁盘，否则快照）按该 id 查出这一行。只有该行的 `installSpec` 能进 `dsh plugin --profile web add`。允许的规格：通过 `isValidPackageName` 的目录 npm 包名；通过 `isValidGithubSpec` 且与该行 GitHub URL 一致的 `github:owner/repo` 或 `github:owner/repo#<gitRef>`；`github:owner/repo#path:/<posix>`，其中 posix 路径不含 `..`、`:`、反斜杠，且 owner/repo 与该行 URL 一致（`isValidMarketplacePathSpec`）。进 CLI 之前拒绝：`file:`、`link:`、tarball 或 git URL、未知 id、`DROPPED` 包、非法 `allowBuilds`。桌面其它功能已存的 GitHub Token 可用来钉 SHA；没有 Token 就装浮动 ref。

`installPlugin(spec)` 仍只接受 github（`isValidGithubSpec`），给 Host 的 `install_dsh_plugin` 控制通道用。

安装与卸载共用一把进行中互斥锁。已安装名来自新增的 profile 键、新增的 `node_modules` 目录，或与 github 身份匹配的已有 profile 规格。add 成功但没有可加载的 dsh 入口（仅布尔 `dsh.bundle.patch: true` 不够）或插入了重复 loader id：当场卸掉并报失败。`ok: false` 时不调用 `startHarness()`。若 add、Host `install-plugin` 或卸载成功而 `startHarness()` 抛错，IPC 返回 `ok: true`、`harnessStarted: false`。安装文案说明插件已写入 web profile；卸载文案说明插件已从 web profile 移除。`needsAllowBuilds` 再确认一次，然后带名单重试一次，名单含 ndjson 转义的 prepare-not-allowed 名以及 `name@git+https://github.com/owner/repo.git` 键。

## 曾考虑的替代方案

**预装或 vendor `dshmarket` 作为设置里的插件市场界面。** 由 [桌面预置 dshmarket](2026-08-19-desktop-dshmarket-preset.zh.md) 拥有。本笔记把目录拉取和 Host 只接受 github 的 `installPlugin` 路径留在该插件之外。

**保留第二个 Electron 市场窗口（`src/renderer/marketplace/`）。** 否决：第二份 `file:` 文档需要平行色板、市场 IPC 角色，以及钉在 `marketplace/index.html` 上的导航守卫。托盘和菜单的 `openMarketplace()` 打开设置页。

**用 `isValidGithubSpec` 校验 `#path:` 规格。** 否决：Host 的 `installPlugin` 必须保持只接受 `github:owner/repo[#ref]`。`#path:` 是市场目录 token。放宽 `isValidGithubSpec` 会让 Host 控制通道接受 monorepo 路径。市场路径规格走 `isValidMarketplacePathSpec`。

## 后果

没有独立市场窗口，没有 `IPC_ROLES.MARKETPLACE`，也没有 `shell:seed-install-draft`。特权导航只把 boot 的 `file:` 钉在打包的 `boot.html`。IPC 市场安装仍走目录 id。Host 的 `install_dsh_plugin` 仍只接受 github。离线目录用缓存再快照，不搜 GitHub。

## 测试

`src/main/marketplace-catalog.test.js` 钉住语言映射、`installTargetFor` 得到的 npm／github／`#path:` 规格（含仍解析为 `github:` 的 Release tarball `install` 命令）、非白名单 last-token 得到空 `installSpec`、行无目录 `npm` 时 last-token npm 为空、`DROPPED` 过滤、TTL 过期、4 秒中止，以及 live → cache → snapshot 回退。`src/main/marketplace-install.test.js` 钉住 `installMarketplacePlugin(id)` 查找、未知 id、`DROPPED`、非法 `allowBuilds`、目录 `#path:` 允许而 `installPlugin` 拒绝、路径含 `..`／反斜杠／冒号拒绝（GitHub blob 首页使 owner/repo 匹配）、owner/repo URL 不一致、tarball `install` 命令仍装 `github:`、仅在有 Token 时钉 SHA、安装卸载互斥锁、仅 node_modules 与已存在规格回滚、布尔 `patch: true` 拒绝，以及重复 loader id 回滚。`src/main/ipc.test.js` 钉住 add、Host `install-plugin` 或卸载成功后 `startHarness()` 抛错仍返回 `ok: true`／`harnessStarted: false`。`src/main/window-marketplace.test.js` 钉住 `openMarketplace` 不加载 `marketplace/index.html` 窗口。`src/main/ipc-authorization.test.js` 钉住没有 `MARKETPLACE` 角色。`src/main/local-url.test.js` 钉住不存在 `isMarketplaceNavigationUrl`。

## 相关

- [右边栏与终端工作环](2026-08-16-surfaces-terminal-work-loops.zh.md)
- [Host install_dsh_plugin 控制通道](2026-08-15-marketplace-draft-install.zh.md)
- [桌面预置 dshmarket](2026-08-19-desktop-dshmarket-preset.zh.md)
