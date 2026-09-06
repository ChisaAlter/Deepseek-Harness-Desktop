# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified** | 2026-09-06 — `583b6fa92d93df2ee56363e96e2891b356af75b9` 的 Desktop tests run `34015974835` attempt 2 全绿，Windows run `34015983516` 构建和 packaged smoke 通过；26 项发布相关本地测试通过。首轮旧缓存夹具 5 秒超时保留记录，未改超时或跳过测试；独立目录/声明检查均通过。相同产物已按维护者明确授权公开为 `v0.2.9` Latest，资产摘要及标签核验一致。全库 doc-sync 和新包完整实机 P0 不宣称通过，通用门槛不修改。见 [发布记录](../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。 |

## User paths

1. PR/main CI 在既有 vendor 构建后执行无密钥的模型、工具、会话及 API 关键回归。
2. 核心功能回归使 CI 失败，不能只靠 GUI 全绿进入发布。

## Invariants

- 复用既有 Desktop tests workflow，不修改发布或权限策略。
- 使用真实关键链路测试，不以源码字符串存在代替行为验证。
- 冷历史测试夹具必须提供生产控制器声明的 agents 依赖。
- 客户端目录与第三方声明各用独立 CI 步骤检查，后续成功不得覆盖前一个失败退出码。

## Allowed touch

- .github/workflows/test.yml
- src/main/ci-isolation.test.js 与核心门禁契约测试
- vendor/deepseek-harness/packages/api/session-controller/tests/session-cold.host.spec.ts
- vendor/deepseek-harness/packages/api/session-controller/tests/test-remote.ts
- docs/handbook/modules/build-release.md、本卡与 docs/features/README.md

## Gates

- 核心集合本地通过；桌面 CI 契约测试通过。
