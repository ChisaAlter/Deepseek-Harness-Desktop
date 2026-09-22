# 插件市场对齐 dsh-market

> **2026-08-25 更新**：市场的**所有权与渲染模型**已由
> [2026-08-25-marketplace-desktop-integration.md](2026-08-25-marketplace-desktop-integration.md)
> 取代——UI 是桌面自有包 `ui-settings-market`（settings section `market`），
> `dshmarket` 进 `DROPPED`。本文的目录、白名单、失败可见性等产品约定继续有效。

Deepseek-Harness-Desktop 把现有插件市场升级到 [dsh-market](https://github.com/dsh-market/dsh-market)（`dshmarket` 1.12.1）的产品行为，但不预装该插件，也不复制它的 `MarketSection.tsx` 或 HTTP 路由。

视觉语言仍是官方 `dsh web`：只用 `ui-primitives` 和 `--dsw-alias-*`。见 [design-language.md](../../design-language.md)。

## 决定

唯一界面是设置页 `settings.plugins.tab` / id `marketplace`。

桌面端不在首次启动时安装 `dshmarket`。
桌面端不再保留第二个 Electron 市场窗口。
桌面端不再回退到 GitHub `topic:dsh-plugin` 搜索。

目录、安装白名单和后续管理能力对齐 dsh-market 的约定。实现落在现有 Electron IPC 和 `MarketplaceSettingsTab`。

## 分轮

每一轮单独写实现计划，可以单独交付。

1. 精选目录、按目录 id 一键安装、退役独立窗口。
2. 安装弹窗截图，以及同一设置页内的主题页。
3. 检查更新 / 一键更新 / 全部更新，以及通过 `cordis.patch.yml` 热禁用。
4. 备份恢复和诊断（加载顺序、冲突、AI 修复 prompt）。

本文是完整产品约定。第一轮是第一次实现切片。

## 主界面

`MarketplaceSettingsTab` 仍是注册的设置标签页。

后几轮在页内增加「浏览 / 主题 / 已装 / 诊断」，不加新的 `settings.plugins.tab` id。

托盘和菜单的「插件市场」调用 `openMarketplace()`。
`openMarketplace()` 打开主窗口，跳到设置 → 插件 → 插件市场，绝不创建 `src/renderer/marketplace/index.html`。

若 Harness 尚未加载，该调用显示主窗口，记下一次待跳转，等 Harness 第一次就绪后再跳设置 → 插件市场。跳转成功才清标志。

## 目录

`src/main/marketplace-catalog.js` 拉取 `https://awesome-dsh-plugin.com/plugins.json`。
测试可用 `DSHD_MARKETPLACE_REGISTRY_URL` 指向 fixture。
渲染层不能设置这个变量。

超时 4 秒。
成功响应必须是带非空 `plugins` 数组的对象。

`listMarketplace({ refresh?, locale? })` 的 `locale` 为 `zh` | `en`（默认 `zh`），简介和分类标签在主进程按语言选好。

磁盘缓存在 `app.getPath('userData')`，`CACHE_VERSION` 为 3，不复用 GitHub topic 那份缓存。
TTL 1 小时。

在线失败时的回退顺序：当前内存缓存，然后磁盘缓存，然后打包快照 `src/main/marketplace-registry-snapshot.json`。
快照是入库文件。映射逻辑变更或主动更新离线兜底时再刷新。运行时不要把它当成第四个在线 URL 去下。
每一层都空：返回 `ok: false`、`items: []` 和可见警告。不搜 GitHub。

`source` 为 `live` | `cache` | `snapshot`。
非 live 必须带 `warning`。

### 字段映射

每条 registry 插件变成一条 `MarketplaceItem`：

| 字段 | 来源 |
| --- | --- |
| `id` | `owner/name` |
| `owner` | `owner` |
| `repo` | `name` |
| `description` | `description[locale]`，否则 `description.en`，否则 `''` |
| `stars` | `stars` 或 `0` |
| `packageName` | `npm` 或 `''` |
| `homepage` | `url` |
| `installSpec` | 与 dsh-market `installTargetFor` 相同：合法 `npm` 包名；否则从 GitHub `url` 得到 `github:owner/repo` 或 `/tree/<ref>/<posix>` → `github:owner/repo#path:/<posix>`；再否则仅当 `install` 最后 token 已是允许规格时才用它。last-token npm 必须等于该行 `npm` 字段（`npm` 为 null 时得到空 `installSpec`）。tarball / git / file URL 不会成为 `installSpec` |
| `isBundle` | `true`，除非 `deprecated` 为 true |
| `category` | registry 的 `category` |
| `added` | `added` |
| `deprecated` | `deprecated` |
| `replacement` | `replacement` |
| `screenshots` | `screenshots` 或 `[]` |
| `npm` | `npm` 或 `null` |

分类芯片来自 `registry.categories`，外加 `all`。
标签跟请求的 `locale`。
第一轮删除 `marketplace-categories.js` 及其测试。

市场页去掉 GitHub Token 输入。
装 GitHub 源时若桌面其它功能已存 Token，仍可用来钉 SHA；没有 Token 就装浮动 ref。

## 安装

两条安装函数分开。

`installMarketplacePlugin(id)` 是设置页路径。
渲染层只在 `shell:install-marketplace-plugin` 上传目录 `id`（`owner/name`）。
主进程在当前目录（内存，否则磁盘，否则快照）里查出这一行，再算出规格。
不是这次查找得到的规格，到不了 `dsh plugin add`。

`installPlugin(spec)` 仍只接受 github（`isValidGithubSpec`），给 Host 的 `install_dsh_plugin` 控制通道（`desktop-install-control.js`）用。
设置页不调用它。

允许算出的规格：

- 通过 `isValidPackageName` 的 registry `npm` 包名
- 通过 `isValidGithubSpec`、且与该行 GitHub URL 一致的 `github:owner/repo` 或 `github:owner/repo#ref`
- `github:owner/repo#path:/<posix>`：`path:/` 后无 `..`、无 `:`、无反斜杠；owner/repo 与该行 `url` 解析出的 GitHub 仓库一致（不用 `isValidGithubSpec`）

进 CLI 之前拒绝：`file:`、`link:`、tarball URL、git URL、未知 id、`DROPPED` 包、非法 `allowBuilds`。空 `installSpec` 的卡片不提供安装按钮。

安装仍通过现有 Node + pnpm shim 跑 `dsh plugin --profile web add <spec>`。
`allowBuilds` 仍是 `needsAllowBuilds` 之后的显式确认。
add 成功但新包没有可加载的 dsh 入口：当场卸掉并返回失败，避免下次启动卡死。

`MarketplaceSettingsTab` 注入 `installMarketplacePlugin(id)` 和 `uninstallPlugin(name)`。
安装路径不再是 `seedInstallDraft`。

设置页安装/卸载成功后，对应 IPC 调用 `startHarness()` 重启 Harness。
若 profile 已写入而 `startHarness()` 抛错，安装、Host `install-plugin`、卸载共用同一包装：仍返回 `ok: true`，并带 `harnessStarted: false` 与对应文案（写入后不要再安装一次；移除后不要再卸载一次）。界面不把它当成失败、不自动再 add 或 remove。
市场自己不拉起 Electron，也不拉脱离的 `dsh` 进程。

第一轮不搬 dsh-market 的 hoist / release-age / fetchTimeout 重试，也不做一键安装 pnpm。

## 退役的界面

删除或停止随包装：

- `src/renderer/marketplace/`（html / css / js）
- `openMarketplaceWindow`、`closeMarketplaceWindow` 和市场 `BrowserWindow`
- preload 角色 `marketplace` 和 `IPC_ROLES.MARKETPLACE`
- `shell:seed-install-draft` 和 `onSeedInstallDraft`
- 市场页上的 GitHub Token 输入

`shell:list-marketplace`、`refresh-marketplace`、`list-installed-plugins`、`install-marketplace-plugin`、`uninstall-plugin` 改为仅 Harness。
`shell:install-plugin` 仍仅 Harness，且只接受 github，给残留的 shell 调用方；设置页不用它。

钉在 `marketplace/index.html` 上的导航守卫随窗口一起去掉。
`local-url` / `window-nav` / `ipc-authorization` 测试跟着改。

## 第二轮 — 截图与主题

截图只在打开详情弹窗后加载。
只请求 `https://raw.githubusercontent.com/` 和 `https://github.com/` 的图片 URL。
其它主机丢弃。
图片失败就空着，弹窗仍可用。

主题是 registry 里 `category === 'theme'` 的插件，显示在页内主题页。
启用一个主题会打开该插件，并关掉其它已装主题插件（互斥）。
这不改桌面壳自己的外观家族（`src/shared/themes.js` 里的 `deepseek` / `midnight` / `celadon` 等）。
卸载当前主题后，不再有社区主题插件处于启用。

## 第三轮 — 更新与热禁用

更新检测：npm 比较已装版本与 `latest`；GitHub 比较钉住的 commit 与 `HEAD`。
更新单个或全部，走同一套目录白名单。
会降级的 npm 更新直接拒绝。
`link:` / `file:` 安装不从市场更新。

热禁用往 web profile 的 `cordis.patch.yml` 写入 `- id: …` + `disabled: true|false`，放在桌面托管块里，或不改手写行的明确所属块。
补丁文件已经坏了就不动它。
宿主基础设施插件（含桌面安装用的 Host 插件）不能开关。

## 第四轮 — 备份与诊断

通过桌面保存对话框，把 web profile 的插件清单和配置导出为可读 JSON。
导入采用合并：备份之后新装的插件保留。
写入前校验，失败回滚。
导出前提醒备份可能含凭据。

若做 WebDAV 和私有 Gist 同步，放在主进程：只走 HTTPS，拒绝内网目标，WebDAV 密码永不落在渲染层。

诊断展示 bundle 顺序、官方/社区、重复 loader 条目、依赖不一致、非法配置。
改加载顺序先跑试组合，通过才写入。
AI 修复把诊断 prompt 复制到剪贴板，不代发。

## 失败

目录：有缓存或快照就展示卡片并带警告；只有每一层都失败才空列表。
设置页对成功返回的空 `items` 清掉卡片；`listMarketplace` 抛错则保留上一份卡片。`listInstalled` 抛错不挡住目录应用；保留上一份已安装映射，并在目录成功时显示 `marketError`。

安装：弹窗标题和正文用活人能懂的 `error`。
pnpm 的 ndjson 进度对象不当失败正文，最多放进可展开日志。

`needsAllowBuilds`：再确认一次，然后带名单重试一次。

profile 已经改成功但 `startHarness()` 失败：安装与卸载 IPC 都返回 `ok: true` / `harnessStarted: false`。安装文案说插件已写入 web profile、不要再安装一次；卸载文案说插件已从 web profile 移除、不要再卸载一次。界面不自动再跑一遍 add 或 remove。

截图 / 主题 / 更新 / 备份 / 开关的失败遵守上面各轮约束：不留下半启用的主题，也不把补丁写得更坏。

## 测试

第一轮只跑相关的：

- 目录映射 fixture：中英简介、`installSpec` 跟 dsh-market `installTargetFor`（npm 字段优先于 tarball `install` 命令；GitHub URL 含 `/tree/` 时得到 `#path:`；last-token npm 必须等于行 `npm`；行无 `npm` 时 last-token 包名为空）、退役条目 `isBundle: false`、官方分类标签。
- `#path:` 的 `..` / `:` / `\` 拒绝测试用 GitHub blob URL（owner/repo 匹配，但不是仓库首页），钉住 posix 校验。
- 在线拉取失败依次落到缓存、快照。
- `installMarketplacePlugin(id)` 查 fixture 目录；拒绝未知 id；收录的 npm 与 github 能过闸；`file:` / tarball 不可能从目录 id 查出，因此到不了 CLI。
- `installPlugin(spec)` 对 Host 通道仍拒绝非 github 规格。
- 卸载仍拒绝带 shell 语法的包名。
- `MarketplaceSettingsTab` 能列表、筛选、用 `installMarketplacePlugin(id)` 安装、确认卸载，没有 Token 栏。成功空目录即使 `listInstalled` 抛错也清卡片。安装/卸载 `harnessStarted: false` 用本地化文案，不把 IPC 中文串当失败。
- 安装、Host `install-plugin`、卸载在 `startHarness()` 抛错后仍 `ok: true` / `harnessStarted: false`。
- `openMarketplace` 不再加载 `marketplace/index.html`。
- IPC 授权不再定义 marketplace 渲染角色。

后几轮再加：截图 URL 拒绝、主题互斥、更新不降级、开关不破坏 patch、备份校验与回滚。

本工作不跑完整 vendor 套件。
桌面 `npm test` 覆盖主进程测试。
设置页改动时，vendor GUI 测试用 `pnpm run test:gui`，范围限制在 `ui-settings-plugin-inventory`。

## 同一变更里的文档

- 目录与安装决定写一条 Agent Note。
- README / README.en.md：市场是 awesome-dsh-plugin 精选目录，不是 GitHub topic。
- `AGENTS.md` / 设计语言里仍说 `marketplace.css` 有平行色板的句子：独立页删掉后一并删掉这些警告。

## 文件（第一轮）

主进程：`src/main/marketplace-catalog.js`、`src/main/marketplace-install.js`、`src/main/ipc.js`、`src/main/window.js`、`src/main/ipc-authorization.js`、`src/preload/index.js`、新的快照 JSON，以及钉这些模块的测试。

客户端：`vendor/deepseek-harness/packages/client/ui-settings-plugin-inventory/src/client/{MarketplaceSettingsTab.tsx,desktop-shell.ts,index.ts,locales.ts}` 和 `tests/marketplace.client.spec.tsx`。

删除：`src/renderer/marketplace/*` 和市场窗口接线。

## 不在范围内

- 安装或内置 `dshmarket` npm 包。
- 复制 dsh-market 的 React、CSS 或 `/dsh-market/*` HTTP 路由。
- 用社区主题插件替换桌面自带外观。
- 给没有打包 shim 的机器一键下载 pnpm。
- 让市场重启 Electron。
- 第四轮之前做 WebDAV / Gist。
- 改 `agent-loop` 或新增 vendor 客户端包。
