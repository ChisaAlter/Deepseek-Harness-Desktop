# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified** | 2026-09-28 — GUI 745 文件 / 11049 通过 / 1 跳过；核心 215 文件 / 5009 通过 / 5 跳过；修复后 Node 22 桌面 2770 通过 / 2 跳过。首轮远端 vendor-gui 通过，桌面矩阵修复待同 SHA 重验；未以本地结果替代 CI 或生产安装包验收。 |

## User paths

1. PR/main CI 在既有 vendor 构建后执行无密钥的模型、工具、会话及 API 关键回归。
2. 核心功能回归使 CI 失败，不能只靠 GUI 全绿进入发布。

## Invariants

- 复用既有 Desktop tests workflow，不修改发布或权限策略。
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
