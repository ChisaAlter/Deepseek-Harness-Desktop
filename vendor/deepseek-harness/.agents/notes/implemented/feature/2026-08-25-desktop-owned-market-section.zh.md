# Agent Note：桌面自有市场分区

状态：implemented

[English](2026-08-25-desktop-owned-market-section.md) | 中文

## 问题

[Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.zh.md) 把第三方 `dshmarket` 1.14.0 作为桌面预置：每次启动前复制进 `desktop-plugins/dshmarket`、用受管 `cordis.patch.yml` insert 注册、经 `extraResources` + `afterPack` npm install 打包。桌面产品负责人决定市场应当是**与该上游分离的桌面自有代码**：不再默认安装第三方插件，不再依赖 `dshmarket` 包。

## 决定

**本决定反转 2026-08-19 的预置决定。** 设置市场两侧均为桌面自有：

- **UI**：`packages/client/ui-settings-market`（`@deepseek-ai/dsh-client-ui-settings-market`），桌面 fork 包，注册进 web-app bundle（patch 行 `ui-settings-market`、依赖、`tsconfig.client.json` 引用），并由桌面 `harness-desktop-forks.js` 登记表固定。仅当桌面 preload 暴露目录、已安装列表、更新检查、安装、更新、卸载与进度方法时注册 `settings.section` id `market`；纯 `dsh web` 浏览器无此分区。该分区提供目录浏览 / 搜索 / 分类 chips、按 registry id 安装（进度行 + 内联 `needsAllowBuilds` 确认）、版本 / commit 更新、卸载与失败可见反馈（含「已写入 profile 但 Harness 未起」）。
- **引擎**：桌面主进程精选目录、更新检测器与共享变更锁（`marketplace-catalog.js` / `marketplace-updates.js` / `marketplace-install.js`）是唯一安装和更新路径；Harness 重启经 `restartAfterProfileWrite` 归 HarnessController。后续的 [Desktop marketplace version updates](2026-09-07-desktop-marketplace-version-updates.zh.md) 决定恢复版本 / commit 更新，但不恢复第三方运行时或 HMR 系统。
- **预置拆除**：`ensureDshMarketPlugin` 移除。每次启动运行 `removeDshMarketPreset`（受管 patch 块、`desktop-plugins/dshmarket` 副本、预置 symlink；用户自装文件保留）。`dshmarket` 进入桌面 `DROPPED` 名单：Loader 不再挂载它（含用户旧副本），以此保证只有一个 `market` 分区；目录隐藏该行、拒绝再安装。打包移除 `extraResources` 过滤项、`afterPack` dshmarket 步骤与 `setup:harness` 安装；仓库删除跟踪的 `vendor/dshmarket/node_modules`，`vendor/dshmarket` 仅作打标的 MIT 参考树（`DESKTOP-FORK.md`）。

## 曾考虑的替代方案

- **继续预置 dshmarket** —— 即先前决定；产品最主要的扩展面会一直由桌面无法编辑的第三方包持有。
- **一步移植全部 dshmarket client（5.8k 行）** —— 主题商店、备份 / Gist、诊断、热更新、多源管理暂无桌面引擎支撑；deferred 清单在桌面 feature card `marketplace-settings`。
- **让用户自装的 dshmarket 与新分区并存挂载** —— 会出现两个 `market` `settings.section` 注册；改用 `DROPPED`（文件保留、组合不挂载）。

## 后果

设置 → 市场只在桌面渲染桌面自有分区。旧 dshmarket 安装停止加载但文件保留。市场 UI 改随官方设置 token / primitives 语言，不再用第三方 CSS。目录中无法再安装 `dshmarket`。

## 测试

桌面仓库：`src/main/dshmarket-preset.test.js` 钉住清理语义、`DROPPED` 行、打包排除与打标参考树；`harness-controller.test.js` 钉住清理时序（desktop-install 之后、start 之前）及 skip-user-plugins 启动同样清理；`harness-desktop-forks.test.js` 对真实 vendor 树钉住新包、组合行与 bundle 注册。本仓库：`ui-settings-market` client specs 钉住桌面门控注册、目录渲染、搜索 / 分类过滤、安装 / 卸载流、allowBuilds 重试与进度流。

## 相关

- 反转：[Desktop presets dshmarket](2026-08-19-desktop-dshmarket-preset.zh.md)
- 引擎：[Desktop marketplace curated catalog](2026-08-18-desktop-marketplace-curated-catalog.zh.md)
- 部分反转：[Desktop marketplace version updates](2026-09-07-desktop-marketplace-version-updates.zh.md)
