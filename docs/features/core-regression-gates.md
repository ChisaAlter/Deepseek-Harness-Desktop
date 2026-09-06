# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified** | 2026-09-06 — 本轮桌面 1403 通过 / 2 跳过、workspace / workspace-controller / ui-workspace 262 通过；旧 CI run 34003209987 的目录检查失败被后续命令成功覆盖，改为两个独立步骤阻断失败，并从已提交源码刷新客户端目录。全库 doc-sync 有既有失败，不标全绿；新提交 CI 与安装包验收待完成。 |

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
