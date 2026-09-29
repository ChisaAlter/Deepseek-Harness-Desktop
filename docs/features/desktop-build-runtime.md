# Feature: Desktop build runtime contract

| Field | Value |
| --- | --- |
| **id** | `desktop-build-runtime` |
| **status** | `proposed` |
| **last verified** | 2026-09-29 — Node 24.21.0 LTS 全量构建和本地 NSIS 成功，包内 Node 版本核实；桌面 2809 通过/2 跳过，打包 P0（界面、Git/PTY、Ghostty、旧运行时替换）通过。CI 同 SHA 正式验收仍未完成。此前 2026-09-28 — 一源一目录装配通过 747 包 / 3602 边验证；tar 搬迁、循环与严格身份回归通过。桌面 2765 通过/2 跳过；源码与安装树冒烟、NSIS 与资产校验通过。ws 与平台会话资源已随包。当前仅本地演练，CI 同 SHA 候选与正式生产验收未完成。 |

## User paths

1. 维护者在仓库根执行任一文档记载的入口（`npm start`、`npm test`、`npm run setup:harness`、`npm run pack`、`npm run dist`、`npm run check:governance`、`npm run doc-sync`）都能找到对应脚本。
2. 打包流程按 `build.extraResources` 装配 `vendor/dsh-remote` 等内置插件，`scripts/after-pack.js` 在打包期完成资源断言。
3. 应用更新读取 `build.publish` 的 GitHub 元数据与 `dependencies.electron-updater`，与安装器 artifact 命名保持一致。

## Invariants

- 桌面构建与随包 Harness Node 以 `.nvmrc` 为唯一版本源，当前选用 Node 24.21.0 LTS；跨主版本后重新执行构建、桌面测试和打包启动验证。Electron 内置 Node 与 Office 锁定运行时各自独立。

- 每个运行时源 realpath 对应一个物理包目录；消费者经根内链接解析到相同或隔离的源实例。version 1 `.dsh-runtime-links.json` 仅记录相对路径，归档前移除链接、解压后恢复，实际解析边与发布文件都须通过验证。
- 账户启动依赖 `ws` 必须在根生产 dependencies 与锁文件中声明，不能依赖本机额外安装。工作区依赖同源拆分与异源合并均阻断打包，字节相同不豁免；删除副本后的依赖树必须复验，正确收拢不能因复制计数不变而失败。
- `package.json` 必须保留 `scripts`（至少含 start / test / setup:harness / sync:harness / pack / dist / check:governance / doc-sync）、`devDependencies`（electron / electron-builder / semver / pnpm）、`dependencies.electron-updater`、engines、overrides 与完整 `build` 块（asarUnpack / electronDist / extraMetadata / afterPack / publish / win / nsis / mac / dmg）。
- `build.extraResources` 的首个 vendor filter 必须包含全部内置插件目录，含 `dsh-remote/**`；`vendor/chisacode-remote/.tmp/desktop-runtime/node_modules → vendor/dshd-remote/node_modules` 的第二条资源映射不得丢。
- NSIS 品牌契约（artifact 名、installerLanguages、`build/installer.nsh`）由 `windows-installer` 卡定义，本卡只保证字段存活，不重复定义取值。
- 结构约束由 `src/main/package-contract.test.js` 机检；清单残缺时该测试本身必须失败，而不是让测试在模块加载期崩溃。`npm test` 目前是单一 glob，不额外前置 manifest preflight；维护者排查时应先直接运行该契约测试。
- **prestart 的 client 失效判定只看真实输入（2026-09-22）**：`scripts/source-scan.mjs` 是唯一谓词来源——`isClientSourceFile()` 决定文件、`createClientSourcePruner()` 决定进入哪些目录。`packages/client/**/{tests,__tests__}`、`*.spec.*`、`*.test.*`、`README*` 不算 client 输入；`docs`/`website`/`mobile`/`benchmarks` 不再被遍历。
- **官方构建按阶段凭据复用（2026-09-22）**：`vendor/deepseek-harness/scripts/build-stage-credentials.mjs` 是唯一判定实现（`scripts/build.ts` 经 `.d.mts` 导入同一份代码，`scripts/prestart-ensure.mjs` 直接消费 `.mjs`）。阶段顺序固定 `native-system → host → client → web`，`build.ts` 调用 `build:lib:host` / `build:lib:client` 子脚本而不再调用 `build:lib`。每个阶段记录 inputs / outputs 的 `size:mtime:ctime` manifest 摘要与路径绑定内容摘要，外加 `environment` 摘要与 `formatVersion`；manifest 命中即复用，manifest 变动时用内容摘要兜底（字节相同的重建仍复用）。`DSH_CLIENT_*` 只绑定在 client 与 web 上，因此 commit/version 变化只重建这两个阶段。`native-system` 在 Windows 上零产物是合法凭据，其它平台为零即 stale。产物归属由 `isGeneratedArtifact()` 按精确产物根判定（`packages/*/*/lib/**`、`apps/*/lib/**`、`apps/*/dist/**`、`native/system/packages/*/bin/**`），不得按目录名 `lib` 通配；host / client 靠 `ownsOutput` 把共用的 `lib/**` 分成两半。判定 fail-closed：凭据缺失、无法解析、schema 不符、缺 stage 条目、计数不符、环境不符、所需产物为零一律重建；`stagesToRun()` 保证前序阶段 stale 时后续全跑。`.dsh-build/client-build-environment.json` 仍是产物凭据，仍需与产物一致才可消费。
- `scripts/prepare-dshd-remote.mjs` 每次运行对同一个源目录只枚举一次（`createScanMemo()`）；server stack 与 mobile bundle 共用 protocol/client 的扫描结果。memo 只在进程内，不得落盘——跨运行的持久 mtime 记录无法区分「文件未变」与「扫描未运行」，会静默留下陈旧产物。
- **装配期复用已验证的插件依赖树（2026-09-22）**：`dsh-im` 的依赖是否重装由 `missingPluginRuntimeClosure()`（自身入口 + 深度 3 的依赖闭包）决定，不再由 `skipIfComplete: false` 无条件删除重装。检查不通过时仍走 `defaultNpmInstall()`；`skipIfComplete` 的浅语义对其余插件不变。复用前提是这些依赖为纯 JS；引入原生依赖前必须把平台与 ABI 纳入判定。

## Allowed touch

- `.nvmrc` — 2026-09-29 用户授权重选合适的 Node 构建版本。

- `scripts/runtime-instance-graph.js`、`src/shared/runtime-links.js`、`src/main/harness-extract.js` 与对应测试 — 2026-09-28 用户全面修复授权下的一源一目录装配、链接清单和提取恢复
- `package.json` — 清单字段与打包配置
- `src/main/package-contract.test.js` — 结构门禁
- `package-lock.json` — 2026-09-28 用户授权补齐 `ws@8.21.3` 生产锁记录，不改已有依赖版本
- `scripts/after-pack.js`、`src/main/after-pack-workspace.test.js`、`src/main/after-pack-identity.test.js` — 2026-09-28 用户授权恢复实例合并/拆分阻断并修正删除后的收敛复验
- `scripts/source-scan.mjs`、`scripts/source-scan.test.mjs` — 构建输入的共享谓词、目录剪枝、单次运行 memo 及其机检
- `scripts/prestart-ensure.mjs` — client 失效判定、阶段凭据调用与输入扫描调用
- `vendor/deepseek-harness/scripts/build-stage-credentials.mjs`、`.d.mts`、`.client.spec.ts` — 阶段凭据的判定实现、类型声明与机检
- `vendor/deepseek-harness/scripts/build.ts` — 阶段驱动与产物记录刷新
- `scripts/prepare-dshd-remote.mjs` — DSHD remote 输入目录的扫描调用
- `scripts/after-pack.js` — 打包期资源断言与内置插件依赖树的完整性判定（与 `remote-workspace` 卡共享，只改断言相关行）
- `scripts/setup-harness.js` — `setup:harness` 复用同一份完整性判定
- `.github/workflows/release.yml` — 打包与上传编排（与 `windows-installer` 卡共享）
- 本卡与 [build-release handbook](../handbook/modules/build-release.md)

## Do not touch

- `package-lock.json` 的其他解析结果与已锁定依赖版本（上述 ws 补齐授权除外）
- `SHA512SUMS.txt` 生成与更新器校验流；发行资产名称按 `windows-installer` 卡同步
- 真实发布、签名与 mac DMG 上传策略

## Gates

实例与生产依赖回归：`node --test src/main/after-pack-identity.test.js src/main/after-pack-workspace.test.js src/main/after-pack.test.js src/main/package-contract.test.js`。

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/package-contract.test.js src/main/installer-branding.test.js`（scripts / runtime deps / build 关键字段 / vendor filter / NSIS 字段；15/15）、`node --test scripts/source-scan.test.mjs`（构建输入谓词、目录剪枝、单次运行 memo；7/7）、`node vendor/deepseek-harness/node_modules/vitest/vitest.mjs run scripts/build-stage-credentials.client.spec.ts --environment node`（阶段凭据复用与 fail-closed 负例；11/11）、`node --test src/main/after-pack.test.js`（装配完整性判定；35/35）；`npm run check:governance` |
| Manual / QA | 打包冒烟 `npm run smoke:packaged`（真实产物）；安装器实机项见 `windows-installer` 卡的 `TC-INST-*` |

## Sources

- Decision: [发布构建使用 Node 24 LTS](../decisions/implemented/process/2026-09-29-node24-release-runtime.md)

- Decision: [运行时按源实例装配并在解压后恢复链接](../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md)
- Decision: [打包实例门禁恢复与账户运行时依赖补齐](../decisions/implemented/bug-fix/2026-09-28-packaging-identity-gates-and-ws.md)
- Decision: [桌面清单保留完整脚本、运行时依赖与打包资源契约](../decisions/proposed/bug-fix/2026-09-19-desktop-manifest-runtime-contract.md)
- Decision: [构建输入按真实来源判定，每次运行只枚举一次](../decisions/proposed/process/2026-09-22-build-input-scan-dedup.md)
- Decision: [官方构建按阶段验证输入-产物凭据，命中即复用](../decisions/proposed/process/2026-09-21-build-stage-credentials.md)
- Decision: [打包装配复用已验证的插件依赖树](../decisions/proposed/process/2026-09-22-packaging-plugin-reuse.md)
- Evidence: [2026-09-19 审计修复计划](../superpowers/plans/2026-09-19-audit-repair-optimization.md)
- Implementation entry: `package.json`、`scripts/after-pack.js`、`scripts/source-scan.mjs`、`src/main/package-contract.test.js`
- 相关卡：`windows-installer`（NSIS 品牌）、`remote-workspace`（dsh-remote 资源）、`desktop-launcher`（updater 元数据）
