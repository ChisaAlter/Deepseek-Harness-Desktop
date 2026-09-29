# Decision: 发布构建使用 Node 24 LTS

Status: implemented

中文 | [English](2026-09-29-node24-release-runtime.en.md)

## Problem

`.nvmrc` 自 2026-08-25 保留 22.22.2。用户要求取消旧版本约束，为当前安装包选择合适版本。桌面和 Harness 的 engines 均支持 `^22.19.0 || >=24.0.0`，无需为了兼容性固定在 22。

## Decision

`.nvmrc` 更新为 24.21.0。按 2026-09-29 的 [Node 官方发行索引](https://nodejs.org/dist/index.json)和[支持周期](https://github.com/nodejs/Release/blob/main/schedule.json)，这是最新的 Node 24 LTS；Node 26 尚未进入 LTS。使用官方 Windows x64 压缩包，并与同版本 SHASUMS256.txt 核验后构建和测试。本机项目工具放在忽略目录，不覆盖全局 Node 安装。CI 继续从同一 `.nvmrc` 读取版本。

审计：[干净 CI 可移植性修复](../bug-fix/2026-09-28-clean-ci-portability.md)部分重叠，其依赖准备与测试门禁继续有效。此次仅更新桌面构建及随包 Harness Node 基线；Electron 内置 Node 和 Office 独立锁定的运行时仍由各自版本管理。

## Alternatives considered

- Node 22 最新补丁：仍满足兼容性，但处于更早的维护周期，不继续作为新安装包的默认构建基线。
- Node 26 Current：满足 engines，但尚未进入 LTS，发布稳定性优先选择 24 LTS。

## Consequences

本地构建、CI 与随包 Node 使用相同版本；跨主版本后重新执行构建、桌面测试和打包启动验证，不能沿用 Node 22 的验证结果。未来升级按支持周期和实际兼容性重新判断。
