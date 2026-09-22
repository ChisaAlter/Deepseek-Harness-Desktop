# 2026-08-26 桌面启动器 / skip 救生启动 生产交付回路（审查 → 计划 → 对抗审查 → 执行）

`Touching: desktop-launcher`（次要涉及 `marketplace-settings` 已登记的 after-pack 门禁行）。

承接 PR #44（分支 `cursor/fix-skip-plugins-recovery-0238`，基于 main tip `fdf12c4d`，6 个提交、无分叉），本文档是该分支收尾交付的计划与对抗审查记录。分支选择：**继续在 #44 分支上叠加**——该分支与 main 无分叉、PR 开放、本轮全部工作都是 #44 明确列出的 follow-up，另开新分支只会拆散评审上下文。

## Phase A — 全面审查结论（#44 tip vs main）

基线：`npm test` 1069 pass / 0 fail / 3 skip（本 VM Node 22.14 实测，与 PR 描述一致）。

#44 已正确落地的三件事（复核过 CLI 源码，非 rubber-stamp）：

1. **skip 自取消已修**。`vendor/deepseek-harness/apps/cli/src/profile-boot.ts` 的 `composeProfile` 证实：`--patch` overlay 在 `skipUserPlugins=true` 下**仍然应用**（`overlays = patchFiles.flatMap(...)` 不受 skip 影响）。桌面现在只传 `desktop-plugins/install-dsh-plugin/skip-user-plugins.patch.yml`（仅 install insert），不再传整份 profile `cordis.patch.yml`。控制器与 plugins.js 单测钉死。
2. **内置组件包缺失预检**。`missingDesktopForkPackages` 双锚点（CLI + bundle manifest）+ `missingDeclaredEntries` 与打包门禁共判定；packaged 路径同样覆盖（`sourceHarnessStatus` 对解包后的 runtime 返回 `present:true`，`_ensurePackagedHarness` 先于 `buildLaunch` 执行）。
3. **打包门禁**。`assertDesktopForkRuntime` 对全部 `DESKTOP_PACKAGES` 校验 manifest + 声明入口；release.yml 的 `npm run dist` 必经 after-pack。

仍然开着的问题（P0–P2）：

- **P0-1 契约测试缺位（skip 语义漂移无护栏）**。桌面对 skip 的全部信心来自 mock 掉 `dsh.start` 的单测。两类真实漂移都测不到：
  (a) **argv 语法漂移**：CLI 的 commander 解析是「launcher flags 在前，第一个不认识的 token 起全归 app args」（`args.ts`，`passThroughOptions`）。若有人把 `--host` 挪到 `--skip-user-plugins`/`--patch` 之前，CLI 会把 skip 旗标当 app 参数吞掉——**带全部用户插件启动但桌面以为在 skip**，正是最危险的静默失效。现有 `dsh.test.js` 只断言当前确切 argv，改坏的人会顺手改测试。
  (b) **compose 语义漂移**：vendor 升级后 CLI 对 `--skip-user-plugins` + `--patch` 的组合语义若变（如 skip 下不再应用 overlay，或反过来重新吸入用户层），桌面单测全绿。
- **P0-2 Recovery Board 对内置组件损坏不诚实**。当运行期错误点名 `DESKTOP_PACKAGES` 内的包（预检漏网：如内置包的传递依赖缺失），`plugin-forensics` 把它当普通 orphan suspect，`recoveryVerdict` 给出「可逐项禁用后重新启动」——禁用/skip 对模板 bundle 挂载的内置包**均无效**，正确出路只有 setup:harness / 重装。预检错误路径（`lastStart.error` 含预检文案）下，板子下方 summary 也仍是「可逐项禁用下列插件…排查冲突」误导文案。
- **P1-1 发布路径无 packaged 级 compose 验证**。after-pack 只做文件存在性断言；「打出的 Setup 里 skip 启动到底 compose 出什么」从未在发布路径被真实执行过。
- **P1-2 Feature Spine 漂移**。#44 实际改动 `src/main/dsh.js`、`plugins.js`、`plugin-tree-failure.js`，但 `desktop-launcher` 卡的 Allowed touch 未收录这些文件（invariants 更新了、touch 清单没跟上）。
- **P2-1 desktop-install 双份真相**：managed block（profile `cordis.patch.yml`）与 skip overlay 同源同 body、每次启动同函数重生成，**版本内无漂移可能**；跨版本迁移才有意义。
- **P2-2 scavenger 链**（每次启动 7 步清理/预置）→ 版本戳一次性迁移；**P2-3 双恢复 UI**（boot 页 vs 启动器 Recovery Board）。
- **P2-4 runtime 损坏时控制器仍白费一次 skip 重试**并写下 sticky skip（无害但不优雅；预检已挡住绝大多数此类 spawn）。

## Phase B — 优化/修复计划（优先级排序）

| # | 目标 | 文件 | 验收标准 | 风险 |
| --- | --- | --- | --- | --- |
| E1 | **发布路径真 CLI compose 契约门禁**：after-pack 在 tar 前，用打包出的 harness runtime 真跑 `node apps/cli/lib/bin.js web --dump-config`（skip + full 两轮），临时 DSH_HOME 植入 canary 用户行 + 用**真实** `ensureDesktopInstallPlugin` 生成 overlay/managed block；skip 轮断言 canary 消失、install insert 在场；full 轮断言两者都在 | 新 `scripts/check-skip-compose-contract.mjs`、`scripts/after-pack.js`（gate 调用一行）、单测 | 断言函数纯化可单测；本 VM 对 source-built CLI 实跑绿；dist 时任何失败 → 构建失败 | 门禁误杀发布（用真实 CLI 在本 VM 验证后再合入）；Windows 路径/env 差异 |
| E2 | **argv 语法契约测试**（每次 PR CI 都跑）：从 vendored `args.ts` 源码提取 `web` 子命令的 launcher-owned flags，断言 `buildLaunch` skip argv 的 launcher flags 全部位于第一个 app token（`--host`）之前；提取不到即 fail（不许静默跳过） | `src/main/dsh.test.js`（或独立 contract 测试） | 把 `--patch` 挪到 `--host` 后的变体必须被抓住 | 对 args.ts 文本形态有依赖——提取失败即测试失败，fail-loud |
| E3 | **Recovery Board 诚实化**：`plugin-forensics` 识别「suspect ∈ DESKTOP_PACKAGES 且不在 profile 插件清单」→ `inBox` 行 + payload `desktopRuntimeDamage`；verdict/summary 换成「内置组件损坏：禁用与跳过均无效，源码 setup:harness / 安装包重装」；行 badge「内置组件」，不再给「未在 profile 登记」的含混文案 | `src/main/plugin-forensics.js`、`src/shared/launcher-recovery.js`、`src/renderer/launcher.js` + 各自单测 | 内置包名出现在错误里时 verdict 不再建议禁用；用户层同名安装（在 profile 清单里）不受影响 | 低；纯归因/文案层 |
| E4 | **Feature Spine 对齐**：desktop-launcher 卡 Allowed touch 补 `dsh.js`/`plugins.js`/`plugin-tree-failure.js`/`launcher-recovery.js`/契约脚本；新 invariants（E1/E2/E3）；`.cursor/rules` 同步 | `docs/features/desktop-launcher.md`、`.cursor/rules/desktop-launcher-product.mdc` | 卡与代码一致 | 无 |
| D1 | desktop-install 单 overlay 收敛（去 managed block） | plugins.js + 迁移 | — | **推迟**（见对抗审查） |
| D2 | scavenger → 版本戳一次性迁移 | harness-controller 全链 | — | **推迟** |
| D3 | 双恢复 UI 收敛 | boot.* + launcher.* | — | **推迟** |
| D4 | release.yml 挂完整 packaged Electron smoke | release.yml | — | **推迟**（E1 覆盖 compose 层） |

## Phase C — 对抗审查（攻击 Phase B）

**Q1：做完 E1–E3，skip 还有哪些静默失效面？**
- vendor PR 级别的 compose 回归在**每次 PR CI** 仍测不到（E1 只在 dist/release 路径跑；test.yml 的 vendor-gui job 只 build:lib + test:gui）。若本 VM 验证「build:lib 产物足以跑 dump-config」，可顺手在 vendor-gui job 后加一步（低成本）；验证不过就明确接受缺口并记录。**裁决：条件性纳入 E1b，以实测为准。**
- CLI 真 boot 时的行为（`!!js` 求值、Loader 实际 import 每行）dump-config 覆盖不了——这是设计边界（dump 是 boot-free 的），由预检 + ESM 失败分类兜底，不假装覆盖。
- 用户手动改 `config.json` 里 `pluginRecovery` 等——非目标威胁模型。

**Q2：单测的假信心在哪里？**
- 一个「自跳过」的 dump-config 契约测试放进 `src/main/*.test.js` 是最典型的假修复：desktop CI job 不装 vendor 依赖 → 永远 skip → 永远绿。**裁决：契约实跑只放在保证有 built runtime 的位置（after-pack / vendor-gui 条件步）；desktop 单测只测断言函数（喂真实 dump 输出样本）与 argv 语法（不需构建）。**
- E2 用正则读 args.ts：若提取逻辑宽松到「什么都匹配」，等于没测。**裁决：提取必须精确到 web 子命令块，提取结果必须非空且包含已知两 flag，否则测试失败。**
- E1 若把 canary 断言写成「stdout 不含 canary」而 dump-config 因错误提前退出输出为空 → 假绿。**裁决：先断言 exit 0 + stdout 含 install insert（正向证据），再断言 canary 缺席；两轮互为对照（full 轮 canary 必须在场，证明 canary 植入本身有效）。**

**Q3：Windows packaged 与 Linux CI 有什么会裂开？**
- E1 在 after-pack 里 spawn `process.execPath`（electron-builder 的 node）跑 bin.js：Windows 下路径含空格（args 数组 spawn 无 shell，安全）；env 需强制 `DSH_HOME=<temp>` 并清掉 `DSHD_HOME`（遵守 dsh-home 规则：绝不读官方 `~/.dsh`）。temp 目录用 `fs.mkdtempSync(os.tmpdir())`，Windows CI 可写。
- `renderConfigDump` 输出含绝对路径注释——断言只认行 id（`dshd-desktop-plugin-install` / canary id），不认路径分隔符。
- 本轮无法在 Windows 上真打 Setup（本 VM 是 Linux、无 wine 保证）；**明确交付措辞：E1 已在 Linux 对 source-built runtime 实证，Windows 侧由 release CI 的 dist 首跑验证。不声称 Windows packaged smoke 已过。**

**Q4：哪些「简化」对本轮交付过于侵入？**
- **D1 单 overlay 收敛**：收益 = 消掉一份同源重生成的副本（版本内零漂移风险）；成本 = 迁移用户 profile 的 managed block、老版本回滚会重写回去、compose 层级从用户层挪到 overlay 层（用户层想 patch install 行的行为改变）。收益/风险严重不成比例。**推迟，等有真实漂移事故或下一次大版本再做。**
- **D2 scavenger → 迁移**：动每条启动路径 + 需要持久化版本戳与回滚语义，是独立设计文档量级。**推迟。**
- **D3 双恢复 UI**：boot 页恢复与启动器 Recovery Board 分属主窗/启动器两个产品面，收敛是产品决策不是重构。E3 的诚实文案两处共享 `launcher-recovery.js`，已消掉最疼的不一致。**推迟。**
- **D4 release.yml 挂 Electron GUI smoke**：CI runner 上拉整个 Electron + NSIS 产物，flake 概率高且失败会挡发版；E1 已把「打出的 runtime compose 对不对」放进 dist 必经路径。**推迟。**
- **P2-4 控制器跳过无效 skip 重试**：需动 `performStart` 生命周期，超出 desktop-launcher 卡对 harness-controller 的 touch 限制（仅 sticky skip 委托），且预检已挡主路径。**推迟。**

**修订后本轮执行范围：E1（+条件性 E1b）、E2、E3、E4。其余 D1–D4、P2-4 推迟并按上述理由记录。**

## 执行与验证记录

全部修订范围（E1 + E1b + E2 + E3 + E4）已落地；`npm test` **1080 pass / 0 fail / 3 skip**（1083 total，本 VM Node 22 实测）。

- **E1**：`scripts/check-skip-compose-contract.js`（纯断言函数 + 注入式 spawn，单测 5 例覆盖「正向证据先行、canary 复活、非零退出、缺 CLI」）；`scripts/after-pack.js` 在 `assertHarnessRuntime` 后、tar 前调用 `runSkipComposeContract(harnessDest)`。**实机证据（Linux，source-built CLI，`vendor/deepseek-harness`）**：skip 轮 dump 仅含 `dshd-desktop-plugin-install`、canary 缺席；full 轮 canary + install 都在（单轮 dump-config ~90ms，boot-free）。**反证**：把 `--patch` 换回整份 `cordis.patch.yml` 后 canary 在 skip 轮复活（grep 命中 2 行）——旧行为会被门禁当场击落。
- **E1b（对抗审查 Q1 的条件项，实测通过后纳入）**：test.yml `vendor-gui` job 在 build:lib 之后直接跑契约脚本——已验证 pnpm install + build:lib 产物足以运行 dump-config（`apps/cli` 在 tsdown host face 的 workspace 里）。该 job 在 windows-latest 上跑，同时提前验证了脚本的 Windows 路径/env 行为。
- **E2**：`dsh.test.js` 从 vendored `args.ts` 的 web 子命令块提取 launcher flags（提取为空或缺已知两旗标即 fail-loud），按 CLI 的「首个未知 token 截断」语义行走 `buildLaunch` argv，断言 `--skip-user-plugins`/`--patch` 全部位于语法前缀内。
- **E3**：`plugin-forensics` 新增 `isInBoxPackageName`（精确名 + 子路径 specifier）；orphan suspect 命中 `DESKTOP_PACKAGES` → `inBox: true` + payload/summary `desktopRuntimeDamage`；`launcher-recovery.recoveryVerdict` 内置损坏文案压过 sticky skip 分支（skip 修不了运行时损坏），`sortPluginRows` inBox 置顶；launcher.js badge「内置组件」+ 行说明「禁用或跳过均无效，需重装桌面端」，`forensicsSummaryText` 同步。同名用户插件在 profile 清单内时仍是普通可禁用 suspect（反向测试钉死）。
- **E4**：`docs/features/desktop-launcher.md`（last verified、3 条新 invariants、Allowed touch 扩入 skip 救生链路文件与契约脚本并注明理由、Gates 更新）；`.cursor/rules/desktop-launcher-product.mdc` 同步一段。
- **顺手修复（不在计划内但挡合入）**：main 上两处既有 CI 红——`installer-branding.test.js` 的 NSIS 宏断言不容忍 Windows autocrlf 检出（`\r?\n`）；vendor `remote-section.client.spec.tsx` 违反 `exactOptionalPropertyTypes`（TS2379，`??` 兜底）。
- **Windows 侧未验证项（明确不声称）**：真实 NSIS Setup 的 after-pack 契约门禁首跑将发生在下一次 release CI `npm run dist`；本轮 Linux 已实证 source-built 路径，E1b 让 windows-latest 每 PR 都跑同一脚本。
