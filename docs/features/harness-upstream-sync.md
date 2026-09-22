# Feature: Harness 上游同步

| Field | Value |
| --- | --- |
| **id** | `harness-upstream-sync` |
| **status** | `active` |
| **last verified** | 2026-09-18 — alpha.2 正式构建、GUI 7906 通过/1 跳过、桌面 1775 通过/2 跳过、同步契约 67 通过；源码冒烟通过并已重启桌面应用 |

## User paths

1. 开发者同步官方 Harness 固定版本，保留桌面扩展和已有用户修改。
2. 完成冲突解决、构建和回归后从源码启动桌面应用。

## Invariants

- 使用以旧 pin 为共同祖先的三方合并，禁止整树覆盖桌面定制。
- 上游契约优先、桌面特性保真；不弱化断言或 fork 标记来掩盖回归。
- pin 仅在合并树成功应用后更新；未完成验证不得称为可发布版本。
- 不创建分支，不提交或发布；同步过程不改写任务开始时的五个文档修改，保留其原始快照及其他任务后续的独立更新。
- 设计语言、关闭按钮在标题右侧、独立桌面家目录和插件恢复契约保持。

## Allowed touch

- `vendor/deepseek-harness/` — 官方更新、冲突解决与必要兼容修复。
- `vendor/harness-upstream.json`, `vendor/README.md` — pin 与桌面差异说明。
- `src/shared/harness-desktop-forks.js`, `src/shared/harness-desktop-forks.test.js` — 等价迁移不变量与版本检查。
- `src/main/dsh.test.js` — 随上游解析器变更验证桌面启动参数。
- `docs/design-language*`, `docs/handbook/modules/build-release.md`, `docs/features/`, `docs/decisions/` — 升级契约与兼容裁定记录。

## Do not touch

- 已有发布说明、desktop-pet 和 windows-installer 卡的未提交修改。
- 用户数据、凭据、其他 vendor 插件、发布或部署状态。

## Gates

| Kind | What |
| --- | --- |
| Automated | sync/upstream/forks 单测、vendor 构建和 GUI/核心契约测试、`npm test`、`npm run doc-sync` |
| Manual / QA | `npm run smoke:source` 与源码应用重启 |

## Sources

- Design: [设计语言](../design-language.md)
- Spec / plan: [上游同步方案](../superpowers/plans/2026-08-18-harness-rc7-vendor-pin.md)
- Decision: [alpha.2 桌面适配](../decisions/implemented/architecture/2026-09-18-harness-alpha2-desktop-adaptation.md)
- Implementation entry: [harness-sync.js](../../src/shared/harness-sync.js)
