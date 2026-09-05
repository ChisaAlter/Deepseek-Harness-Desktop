# Feature: Core regression gates

| Field | Value |
| --- | --- |
| **id** | `core-regression-gates` |
| **status** | `active` |
| **last verified** | 2026-09-05 — 核心集合 173 文件 / 3672 通过 / 3 跳过；GUI 411 文件 / 5337 通过 / 1 跳过；CI 隔离、核心门禁和插件归因 29 项通过。本机 electron-builder 依赖阻塞已解决；远端 CI 与最终安装包验收仍待验证。 |

## User paths

1. PR/main CI 在既有 vendor 构建后执行无密钥的模型、工具、会话及 API 关键回归。
2. 核心功能回归使 CI 失败，不能只靠 GUI 全绿进入发布。

## Invariants

- 复用既有 Desktop tests workflow，不修改发布或权限策略。
- 使用真实关键链路测试，不以源码字符串存在代替行为验证。
- 冷历史测试夹具必须提供生产控制器声明的 agents 依赖。

## Allowed touch

- .github/workflows/test.yml
- src/main/ci-isolation.test.js 与核心门禁契约测试
- vendor/deepseek-harness/packages/api/session-controller/tests/session-cold.host.spec.ts
- vendor/deepseek-harness/packages/api/session-controller/tests/test-remote.ts
- docs/handbook/modules/build-release.md、本卡与 docs/features/README.md

## Gates

- 核心集合本地通过；桌面 CI 契约测试通过。
