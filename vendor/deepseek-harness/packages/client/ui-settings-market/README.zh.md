# @deepseek-ai/dsh-client-ui-settings-market

[English](README.md) | 中文

桌面自有的**插件市场**设置分区（id `market`，导航文案**市场** / **Marketplace**）。浏览器插件仅在 Electron `window.shell` 暴露 `listMarketplace`、`listInstalledPlugins`、`installMarketplacePlugin`、`uninstallPlugin`、`onPluginProgress` 时注册 `settings.section`；纯 `dsh web` 浏览器没有该分区。分区分为**发现**与**已安装**两个页签（后者标签带已装数量）。发现页渲染桌面主进程从 plugins.json 拉取的精选目录（含缓存 / 离线快照回退，`warning` 原样展示）、搜索框、分类 chips、结果计数，以及逐行卡片：作者 GitHub 头像（加载失败回退首字母，不走 API）、仓库名、星标、两行描述、本地化分类标签、已弃用徽标、主页链接（桌面窗口处理器转交系统浏览器打开），和安装动作或已安装标记 + 卸载——已弃用的行与引擎未解析出安装规格的行不提供安装按钮（桌面引擎同样拒绝这类安装）。已安装页把 profile 的插件行按目录分类分组——目录之外的行归入「未分组」——展示每行安装规格、`DROPPED` 行的已退役徽标和逐行卸载；未装任何插件时指回发现页。安装只把 registry `owner/name` id 传给桌面引擎：由主进程解析并校验 CLI 规格、写入桌面 `dsh-home/profiles/web` 并重启 Harness；`shell:plugin-progress` 的进度行流入有界日志。`needsAllowBuilds` 结果会展开内联确认（`role="alertdialog"`），列出将允许的 allowBuilds key 后再重试。失败以 `role="alert"` 文本呈现——包括「已写入 profile 但 Harness 未起」的情况——绝不静默。目录刷新失败时保留已展示的目录并给出可重试的警示；只有首次加载才会落到纯错误态，且刷新进行中按钮禁用并改标「刷新中…」。

该分区取代了桌面此前预置安装的第三方 `dshmarket` 插件：市场 UI 与引擎均为桌面自有，桌面同时把 `dshmarket` 排除出挂载组合，避免注册出两个 `market` 分区。分区只经注入的桌面回调读写，不 import 其他 UI 插件的值。

## Model Experience

无：本包只管理从精选目录安装插件，不注册任何面向模型的内容。

#### KV Cache effect

无；本包不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **市场仅桌面可用** —— 目录拉取、安装锁与 CLI 都在 Electron 主进程。
- **桌面自有市场的第一切片** —— 上游 dshmarket 的主题商店、备份 / Gist、诊断、热更新、多源管理未移植；deferred 清单见桌面 feature card `marketplace-settings`。
- **已装检测按名称 / 规格匹配** —— `packageName` 精确命中优先；否则按 `owner/repo` 整段路径边界匹配存储的 spec（`spec-match.ts`），改名的 github 安装仍能匹配，而更长的仓库名（`owner/repo-extra`）不会误配。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
