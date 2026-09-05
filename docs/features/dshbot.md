# Feature: dshbot detachment

| Field | Value |
| --- | --- |
| **id** | `dshbot` |
| **status** | `removed-from-desktop` |
| **last verified** | 2026-09-05 — 源码和未提交测试已校验备份；预置迁移、用户安装保留和通用禁用恢复已通过定向回归；补齐旧插件 import loader 失败归因。新 CI 安装包构建与升级验收待完成。 |

## User paths

1. 全新桌面不附带 dshbot 源码、预置、推荐卡或专属发布流程。
2. 旧桌面预置只移除受管装载块及指向旧预置副本的链接，不重新复制或装载插件。
3. 用户自行安装的 dshbot 仍作为普通插件列出；不兼容时在启动器单独禁用，独立插件修复后可重新启用。

## Invariants

- 本仓没有 `vendor/dshbot` 实现、开发预置开关消费者、专属导出/发布脚本。
- 用户插件包、manifest 依赖与 bundles、机器人设置、记忆、房间 preset 和会话不因预置清理而删除。
- 普通禁用仅移除该插件的装载声明，保留依赖和磁盘数据；通用启用可恢复装载。
- 不因本体剥离把 dshbot 加入永久禁止安装名单；市场不额外注入第一方推荐，目录与用户安装仍走通用规则。
- 旧的桌面预置代码副本可以留在磁盘作为恢复材料，但不再被自动引用。

## Allowed touch

- `vendor/dshbot/**`、`src/main/dshbot-*.test.js`、原 `src/main/dshbot-preset.js` 的移除
- `src/main/legacy-dshbot-preset.js` 及测试；`index.js`、`harness-controller.js` 仅旧预置调用
- `src/main/marketplace-catalog.js` 及测试；`release-ui-walk.js` 及测试；`src/shared/post-merge-ui.test.js`
- 本仓 dshbot 专属导出、发布脚本及 workflow 的移除
- 本卡、handbook、Feature 索引、短规则、发版说明与 QA 记录

## Gates

- 无插件源码的桌面构建与启动。
- 新 profile、旧受管 patch/link、真实用户目录安装、pnpm 链接安装均有测试。
- 单独禁用和重新启用保持其他插件及用户数据不变。
- 通用插件归因、启动失败恢复和完整桌面回归通过。

## Sources

- 独立维护边界：`ChisaAlter/dshbot`，不由本仓发布。
- 本体入口：`src/main/legacy-dshbot-preset.js`。
- 旧决策与历史验收保留于 `docs/superpowers/`、`docs/qa/`，不代表本版仍交付机器人功能。
