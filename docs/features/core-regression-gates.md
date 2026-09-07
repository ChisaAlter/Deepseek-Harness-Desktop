# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified** | 2026-09-07 — vendored Harness 同步到 `dsh-v0.1.3-alpha.1`（`d347e703908d0406b7a7ef80e3a0e594d86b2215`）；Host 与 Client library build 通过，Desktop tests 1425 passed / 2 skipped，重点 Client 101 文件 / 1279 项通过，package / catalog / type-equivalence 直接门禁通过。全库 doc-sync 仍受既有翻译配对、归档 note seal、JSDoc 与断链债务阻断，本次不宣称通过 packaged smoke、像素门禁或完整实机 P0。 |

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
