# Agent Note：市场分区「发现 / 已安装」重排

状态：implemented

[English](2026-08-26-market-section-discover-installed-restyle.md) | 中文

## 问题

桌面自有市场分区的第一切片（[2026-08-25](2026-08-25-desktop-owned-market-section.zh.md)）是一整页平铺：手写的搜索框和分类 chips、无作者身份的双列卡片、没有主页链接、没有弃用标记、也没有已安装管理视图。从已退役的 `dshmarket` 插件迁移来的用户视之为退步——原市场有「发现 / 已安装」页签、作者头像、星标和分类标签。桌面 QA 走查（`release-ui-walk.js` 的 `market.discover` / `market.installed` 步骤）仍断言那套页签结构，平铺页因此也过不了桌面 `qa:source` 闸门。

## 决定

把 `ui-settings-market` 重排到官方设置语言、对齐原市场的 UX 密度，但不恢复插件：

- **结构**：16/24 分区标题 + 说明行 + 28px 刷新图标动作（`McpSection` 模式，`aria-label` 加同文案 `title` 供悬停提示；重载进行中禁用并改标「刷新中…」），下接 `Pill` 页签对——发现与已安装（后者标签带已装数量后缀）。页签带稳定 id（`market-tab-discover` / `market-tab-installed`），`aria-controls` 指向唯一渲染的窗格；窗格是 `role="tabpanel"`，带对应 `market-panel-*` id 和指回页签的 `aria-labelledby`。页签切换走官方 `data-dsh-motion="swap"` recipe（以 tab 为 key）。
- **发现页**：`Input` 原语搜索（替换手写输入框）、`Pill` 分类 chips（保留 `radiogroup`/`radio` 语义，组带独立「分类」标签）、带 `IconWarningOutline16` 的警告条、结果计数行（保留 `data-market-count`）、auto-fill 280px 卡片网格。每张卡片展示作者 GitHub 头像（`https://github.com/<owner>.png`，浏览器缓存，失败回退首字母——上游 dsh-market 的做法）、仓库名、★ 星标、两行截断描述、本地化分类标签、目录 `deprecated` 字段驱动的已弃用徽标，以及由桌面窗口处理器转交系统浏览器的主页链接。已装行显示成功色标记 + ghost 卸载（行已弃用时同样如此）；其余行只在可安装时显示 primary 安装——`deprecated` 或引擎解析出空 `installSpec` 的行不从卡片提供安装入口，与主进程安装门禁一致（`installMarketplacePlugin` 在进 CLI 之前就拒绝已弃用行与无法解析的规格）。已装 ↔ 目录匹配优先 `packageName` 精确命中，否则用 `spec-match.ts` 的 owner/repo 整段边界匹配，`github:acme/demo-extra` 不再误配目录的 `acme/demo`。
- **已安装页**：profile 行按目录分类、按目录顺序分组，目录之外的行归入「未分组」置底；发丝线行列表（border-l1 上下 + 交互 hover token），行内展示名称、代码字体的安装规格、`DROPPED` 行的「已退役」徽标和逐行卸载。空态指回发现页，文案与 QA 走查匹配的上游文案一致。
- **只走 token**：全部颜色为 `--dsw-alias-*`；两处引用不存在的 `--dsw-alias-state-warning-primary`（此前静默落到 fallback）改正为 `--dsw-alias-state-warn-primary`。
- **失败保留**：目录重载抛错时保留已展示的目录，并在页签上方给出可重试的 `role="alert"` 行（市场失败约定）；只有首次加载才会落到纯错误态。

注入面、IPC 通道与安装 / 卸载 / allowBuilds / 进度流程不变；v1 裁剪项（主题商店、备份、诊断、热更新、多 registry、试用）继续不移植。

## 备选方案

- **保留平铺页、改 QA 走查迁就它**——否决：走查编码的是产品期望（发现 / 已安装），平铺页本身就是投诉对象。
- **移植 dshmarket 的分页器 / 详情弹窗 / 截图条**——精选目录规模下不需要；`screenshots` 字段留在类型上，未来做详情视图再用。
- **像上游那样自绘下划线页签条**——否决，用 `Pill` 原语；设计语言禁止第二套页签皮肤。

## 后果

设置 → 市场现在读起来是一张官方设置页，同时具备原市场的信息密度。桌面 QA 走查的 `market.discover` / `market.installed` 步骤重新与分区匹配（发现页签文案、带数量后缀的已安装页签、`installedEmpty` / 未分组文案）。头像是唯一新增的网络请求，懒加载自 `github.com`，失败降级为本地首字母块。

## 测试

`packages/client/ui-settings-market` vitest：4 个文件、40 个测试全绿——`market-section.client.spec.tsx` 27 个（页签对与数量后缀、tab/tabpanel ARIA 关联、逐卡作者 / 星标 / 分类 / 主页、头像失败回退、已弃用与已退役徽标、已弃用与空 `installSpec` 行的安装门禁、已装弃用行卸载、刷新 label/title、刷新进行中禁用改标、刷新失败保留目录并可重试、allowBuilds 取消、通过已装标记与分组验证的边界规格匹配、警告 + 结果计数、已安装分组顺序、已安装页卸载、空已安装文案，加上搜索 / 过滤 / 安装 / allowBuilds / 进度 / 失败 specs），`spec-match.client.spec.ts` 8 个纯函数用例，另有 browser-plugin（4）与 invariant（1）套件。桌面侧已弃用行的安装拒绝由 `src/main/marketplace-install.test.js` 钉住。桌面 `qa:source` 发布走查对重排后的分区端到端全绿（`market.section` / `market.discover` / `market.installed` PASS，Linux xvfb 源码运行）。
