# 市场内置桌面（与上游 dshmarket 分离）

Deepseek-Harness-Desktop 把插件市场代码**内置为桌面自有代码**，与上游 `dshmarket` 插件彻底分离：不再把市场当成默认预装的第三方插件，也不再依赖它的 npm 包 / 插件安装路径。本文取代 [2026-08-19 的预置决定](../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-19-desktop-dshmarket-preset.md)（反转记录见 [2026-08-25-desktop-owned-market-section.md](../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-desktop-owned-market-section.md)）。

[2026-08-18-marketplace-parity-design.md](2026-08-18-marketplace-parity-design.md) 里目录、白名单、失败可见性等产品约定继续有效；本文只改**所有权与渲染模型**。

## 决定

- **UI 是桌面 fork 包** `vendor/deepseek-harness/packages/client/ui-settings-market`
  （登记在 `src/shared/harness-desktop-forks.js`，MIT，版权声明保留）。仅当
  `window.shell` 暴露市场 API 时注册 `settings.section` id `market`；纯 `dsh web`
  浏览器不出现该分区。
- **引擎是主进程既有 IPC**：`marketplace-catalog.js` / `marketplace-install.js`，
  经 preload `shell:list-marketplace` / `shell:install-marketplace-plugin` 等通道。
  精选目录是唯一安装路径。
- **`dshmarket` 进 `DROPPED`**：Loader 不挂载（含用户旧装副本），目录列表隐藏，
  安装通道拒装；磁盘文件不删。只有一个 `market` 分区。
- **`ensureDshMarketPlugin` → `removeDshMarketPreset`**：启动时只清理旧桌面预置残留
  （受管 `cordis.patch.yml` 块、`desktop-plugins/dshmarket` 副本、预置 symlink），
  与 `removeDshbotPreset` 同型；skip-user-plugins 启动也执行清理。
- **打包解耦**：`extraResources` 不再带 `vendor/dshmarket`；`after-pack.js` /
  `setup-harness.js` 不再为它恢复依赖；`plugin-forensics` 的 `PRESET_PLUGINS`
  移除 `dshmarket`。
- **`vendor/dshmarket` 仅为移植参考树**（`DESKTOP-FORK.md` 标记），不自动安装、
  不打包；长期目标是把还需要的能力继续移植进 `ui-settings-market` 后删除。
- 重启归 HarnessController（`restartAfterProfileWrite` → `startHarness`），
  没有游离的 dshmarket 重启路径。
- 托盘 / 菜单「插件市场」仍经 `openMarketplace()` 跳设置 `market` 分区，
  不建独立 BrowserWindow。

## 第一切片范围

浏览 / 搜索 / 分类过滤 / 刷新、按 catalog id 安装（含 `needsAllowBuilds` 内联确认与重试）、
安装进度行、已安装列表与卸载、失败 `role="alert"` 反馈。

**显式延后**（见 feature card「Deferred」）：主题商店、备份 / Gist、诊断面板、
插件热更新、多 registry 源管理、试用通道。需要时按同一模式继续移植，
不回退到预置插件。

## 门槛

- `src/main/dshmarket-preset.test.js`（清理语义 + DROPPED + 打包排除 + 参考树标记）
- `src/main/harness-controller.test.js`（启动清理顺序、失败继续、skip 模式也清理）
- `src/shared/harness-desktop-forks.test.js`（vendor 注册三件套）
- vendor `ui-settings-market` client specs（注册条件、注入回调、界面行为）
- QA `TC-EXT-001` … `TC-EXT-005`、`TC-DESK-002`

## 关联

- Feature card：[../../features/marketplace-settings.md](../../features/marketplace-settings.md)
- Handbook：[../../handbook/modules/marketplace.md](../../handbook/modules/marketplace.md)、[../../handbook/flows/marketplace-install.md](../../handbook/flows/marketplace-install.md)
