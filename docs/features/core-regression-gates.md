# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified (release process)** | 2026-10-02 — 发布策略与工作流定向验证、文档门禁通过，详见 [发布流程验证记录](release-process.md)。新 CI 工作流尚未在 GitHub 执行，不继承历史候选结果。 |
| **last verified** | 2026-09-28 — 候选 b061501e5b4 的 Desktop tests 36460670559 全绿：Windows 2768/6 跳过、macOS 2763/11 跳过，均无失败；GUI 11049/1 跳过、核心 5009/5 跳过。Node 22 本地 2772/2 跳过；同 SHA 候选构建 36460702057 与资产校验通过。完整生产安装验收仍未完成，见发布准备报告。 |

## User paths

1. PR/main CI 在既有 vendor 构建后执行无密钥的模型、工具、会话及 API 关键回归。
2. 核心功能回归使 CI 失败，不能只靠 GUI 全绿进入发布。

## Invariants

- Desktop tests 保留完整源码矩阵；治理和生成目录前置，纯文档/验收记录提交只执行快速门禁。候选必须具有同 SHA 实际执行成功的目标平台与共享 job，不把 skipped 当成功。
- 晋级资格按 [发布操作流程](../handbook/modules/release-process.md) 判断；Windows 交付要求快速、Windows 与共享 job 成功，交付 DMG 时额外要求 macOS。
- 使用真实关键链路测试，不以源码字符串存在代替行为验证。
- 冷历史测试夹具必须提供生产控制器声明的 agents 依赖。
- 客户端目录与第三方声明各用独立 CI 步骤检查，后续成功不得覆盖前一个失败退出码。
- 桌面矩阵先构建测试所需的上游桥接库；编译产物断言显式位于构建后，不依赖开发机缓存。

## Allowed touch

- 2026-09-28 全面修复授权：vendored client 焦点生命周期、既有 CSS token 消费及失败 GUI/LLM 测试；不得跳过失败项或放宽非法响应拒绝
- .github/workflows/test.yml
- src/main/ci-isolation.test.js 与核心门禁契约测试
- vendor/deepseek-harness/packages/api/session-controller/tests/session-cold.host.spec.ts
- vendor/deepseek-harness/packages/api/session-controller/tests/test-remote.ts
- docs/handbook/modules/build-release.md、本卡与 docs/features/README.md

## Gates

- 核心集合本地通过；桌面 CI 契约测试通过。

## Sources

- Decision: [发布前 GUI 与核心回归契约对齐](../decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md)
- Implementation entry: `.github/workflows/test.yml`、`src/main/ci-isolation.test.js`
