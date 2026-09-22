# Decision: 打包 CLI 的 commander 按声明范围嵌套到 apps/cli/node_modules

Status: implemented

中文 | [English](2026-09-18-packaged-cli-commander-range.en.md)

## Problem

alpha.2 发布候选在 afterPack 的 skip compose 契约失败：`dump-config` 退出码 1。根因不是契约断言，而是真实 CLI 起不来——拍平把 commander@9.5 放上顶层 `node_modules`，它带 `exports.import` 通过了 ESM 探针，却没有 `helpCommand`（^15 才提供）。源码树能过是因为 pnpm 按 `apps/cli/package.json` 的 `^15.0.0` 给它单独链接了 commander@15；拍平合把所有 `node_modules` 目录并进顶层、按遍历顺序胜者通吃，`apps/cli` 又在 `node_modules` 树外，既有版本隔离嵌套（`node_modules/<host>/node_modules`）到不了它。

## Decision

`repairFlattenedCommanderEsm` 在原有「顶层必须是 ESM」检查之后追加「CLI 声明范围」检查：读 apps/cli（deploy 目录为包根本身）`package.json` 的 `dependencies.commander`，用 `resolvePackageFrom` 按 Node 解析规则求 `apps/cli` 实际解析到的 commander，不满足声明范围就从 `.pnpm` store 取满足范围的最高版本复制到 `apps/cli/node_modules/commander`；store 无匹配版本则 fail-fast。顶层 commander 不再为 CLI 改写——需要旧版的消费者继续解析原顶层版本，嵌套只服务 CLI。

## Alternatives considered

- **顶层换成满足范围的版本** — rejected：版本隔离嵌套在 commander 修复之前已按旧顶层计算，换顶层会让需要 9.x 的包无嵌套兜底、静默解析到不兼容版本。
- **修复拍平让 apps/cli 的 node_modules 不并入顶层** — rejected：改动 `collectFiles` 的 flat 语义影响面大（所有 apps/* 的隔离都会变），与本次缺陷不相称。
- **放宽契约跳过 dump-config** — rejected：契约的目的就是在真实打包 CLI 上验证 compose，跳过等于撤掉门禁。

## Consequences

打包树新增 `apps/cli/node_modules/commander`（仅当顶层不满足声明范围时）。semver 进入 devDependencies（构建期脚本显式依赖）。契约继续在真实 CLI 上跑 skip + full 双轮；同类「workspace 包声明范围 vs 拍平顶层胜者」冲突（如 js-yaml、node-addon-require-builtin）若日后出现，沿用同一嵌套模式扩展。
