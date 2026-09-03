# dsh-v0.1.2-rc.1 一跳合树

> 目标：把 vendored DeepSeek Harness 从 `dsh-v0.1.2-alpha.4` 一跳推进到官方
> `dsh-v0.1.2-rc.1`（`a66e4702047846cdaa10c66c9d3df3951f5ea70d`），
> 保留全部桌面 fork 标记与 Host 合同，完成门禁。
> 不创建 GitHub Release，不推送新版本；桌面根版本仍由独立发版计划管理。

## 约束

- 源码 pin 从 `0.1.2-alpha.4` 一跳到 `0.1.2-rc.1`（含 alpha.5 的 projcache 跨版本读兼容修复），不漂 `master`。
- 合树范围只允许 `vendor/deepseek-harness/**` 与 pin 文件；手机、sidecar、Electron 壳保持现状。
- `setup:harness` 对 `vendor/dsh-im` 强制 `npm ci --omit=dev --omit=peer` 重装产生的 devDependencies 修剪（约 2100 文件）是环境副作用，`git checkout -- vendor/dsh-im` 恢复、不入库（是否单独收窄留待独立决策）。
- `0.1.2-rc.1` 已发布 npm；`isUnpublishedHarnessNpm` 只拦 `-alpha.`/`-dev.`，npx 兜底从「拒绝」变为「可用」（无 vendor 源码时回落官方包，仍不含标题栏、Git、右栏 surfaces、底栏终端）。
- 不修改根 `package.json` 桌面版本、NSIS 或 release workflow。

## 上游增量（alpha.4 → rc.1）

- 全仓 `package.json` 版本 bump（含上游已收录的两个 directory-picker-browse 包）。
- `session-projection-cache` / `storage-domain` / `storage-json` / `storage` 的 projcache 跨版本读兼容（v3/v4/v5 fixture，`.agents` note `2026-09-02-projcache-cross-version-read-compat`）与 `docs/subsystems/storage` 更新。
- **无客户端 UI 源码变更**：设计语言无视觉漂移需裁决，仅更新钉版行。

## 执行清单

- [x] tag/SHA 核对（`git ls-remote`）与 dry-run 定价：**零冲突**，候选树只触 `vendor/deepseek-harness/**`。
- [x] 真实合树直接应用；19 个 `DESKTOP_PACKAGES` 版本统一 `0.1.2-rc.1`（17 个手工 bump，两个 directory-picker-browse 已随上游到位），`harness-desktop-forks.test.js` live 断言更新到 rc.1。
- [x] `pnpm install --frozen-lockfile`（lockfile 无漂移，桌面 importers 完好）；`npm run setup:harness`（`build:official`）通过。
- [x] 文档钉版：`docs/design-language.md` / `.en.md` 基线行，`README.md` / `README.en.md` 基线 + sync 示例（顺带修掉 README.en 停在 alpha.2 的陈旧示例）与 npx 兜底已发布表述。
- [x] 顺手修复（单独提交）：`session-persistence` memory 测试替身的 `delete` 改走 `coordinator.remove(id)`（对齐 jsonl 实现），补齐 alpha.4 时代 persistence test-double 迁移的缺口——该失败为存量问题（本次合树该包源码/测试零变更），此前从未被本机门禁覆盖（`test:gui` 只跑 client+host）。
- [x] 清理 sync worktree、backup ref 与状态文件。

## 已知附录

- 首轮焦点测试 5 个失败分解：2 个 `session-projection-cache/tests/fixtures.spec.ts` 默认 5s 超时为本机负载（隔离 + 30s 超时全过）；1 个 persistence memory 替身 `delete` 为 alpha.4 存量缺口（已修）；其余 2 个为负载 flake，复跑消失。
- vendor 测试跑前必须 `$env:NODE_ENV='test'`（本机 shell 全局 production）。

## 验收记录

| 检查 | 结果 |
| --- | --- |
| Pin | `dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d` / `0.1.2-rc.1` |
| Host build | `setup:harness`（install + `build:official`）通过 |
| Desktop fork assertion | `assertDesktopForks(rc.1)` 8/8；`composer-family-width` 7/7 |
| Desktop tests | `npm test`: 1471 pass / 0 fail / 2 skip（1473 用例） |
| Vendor 焦点（projcache/storage/persistence，30s 超时） | 20 文件 / 691 用例全绿 |
| Source smoke | 通过：titlebar 六键、surfaces/branch/git 命中、PTY echo |
| dsh-im | 恢复为已提交状态（修剪未入库） |
| Release/push | 明确不执行 |
