# dshmarket — attribution stub（源码快照已移除）

本目录只剩 LICENSE 与本说明，不再包含第三方
[dsh-market](https://github.com/dsh-market/dsh-market)（npm `dshmarket`，MIT，曾为 1.14.0 快照）的源码：

- 桌面市场是**桌面自有代码**：设置分区 `market` 由
  `vendor/deepseek-harness/packages/client/ui-settings-market`（桌面 fork 包）注册，
  目录 / 安装 / 卸载走主进程 `src/main/marketplace-catalog.js` / `marketplace-install.js`。
- 上游未移植能力（主题商店、备份 / Gist、诊断、热更新、多源、试用通道）是 v1 的
  **明确产品裁剪（不移植）**，见
  [docs/features/marketplace-settings.md](../../docs/features/marketplace-settings.md)；
  需要参考实现时直接查上游仓库，不在本仓库保留快照。
- `dshmarket` 仍在桌面 `DROPPED` 名单：Loader 不挂载它（含用户自装副本），启动只做
  残留清理（`removeDshMarketPreset`）；`ensureDshMarketPlugin` 预置安装已删除，
  不打包、不自动装。
- 保留 LICENSE（MIT）：桌面 `marketplace-catalog.js` 的 CLI spec 解析行为
  （`installTargetFor` 语义）参考自上游实现；按 MIT 要求保留其版权声明。
