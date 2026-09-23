# Decision: 桌面清单保留完整脚本、运行时依赖与打包资源契约

Status: proposed

中文 | [English](2026-09-19-desktop-manifest-runtime-contract.en.md)

## Problem

当前工作树的 `package.json` 只剩名称、版本、engines、optionalDependencies 与 overrides：`scripts`、`devDependencies`、`build`、`dependencies` 全部消失。文档记载的 `npm start` / `npm test` / `npm run dist` 因此不存在，打包配置（NSIS 品牌、extraResources、asarUnpack、electronDist）也随之丢失；`installer-branding.test.js` 在模块加载阶段就抛错，全量测试出现 9 个与清单丢失相关的失败。与此同时，`scripts/after-pack.js` 已经要求打包并校验 `vendor/dsh-remote`，而 HEAD 的 `build.extraResources` 首个 vendor filter 并未包含 `dsh-remote/**`：即使恢复 HEAD 清单，打包后的内置远程工作区仍会缺资源。这类丢失只能靠结构门禁发现，普通单元测试在清单残缺时根本无法提供信号。

## Proposal

以 HEAD 清单为基准重建 `package.json`：恢复完整 `scripts`、`devDependencies`、`dependencies`、`build`（NSIS、asarUnpack、electronDist、afterPack、publish、win/mac、installerLanguages、extraMetadata），保留 `0.3.2`、engines、overrides 与现有依赖版本，并在 `build.extraResources[0].filter` 增加 `dsh-remote/**`。不修改 `package-lock.json`。新增 `src/main/package-contract.test.js`，在缺少任一 `scripts`/运行时依赖/关键 `build` 字段、或缺少 `dsh-remote/**` 资源过滤时明确失败。

## Alternatives considered

- **直接 `git show HEAD:package.json` 覆盖** — rejected：HEAD 的 vendor filter 缺少 `dsh-remote/**`，会让 `after-pack` 的 `assertDshdRemoteRuntime` 在真实打包时失败，也未留下契约测试。
- **重写精简版清单，只补回被文档引用的脚本** — rejected：会让 asarUnpack、electronDist、afterPack、publish 与 NSIS 品牌配置静默缺失，打包产物与更新器契约一起漂移。
- **改门禁放宽对清单字段的要求** — rejected：那些字段正是本次事故被漏检的原因；放宽等于撤掉信号。

## Acceptance criteria

`src/main/package-contract.test.js` 通过；`installer-branding.test.js` 正常加载并通过；`npm test` 不再出现清单相关失败；`after-pack` 的 `dsh-remote` 资源断言在恢复后的配置上成立；`package-lock.json` 无改动。

## Risks

把 HEAD 清单整体恢复会重新引入 HEAD 既有的其它构建配置，其中的本地/未完成项（例如打包体积与签名策略）不在本次范围内，需要后续单独评估。契约测试只校验字段存在与关键取值，不保证打包产物在真实环境可用，因此仍保留打包冒烟与安装验收。
