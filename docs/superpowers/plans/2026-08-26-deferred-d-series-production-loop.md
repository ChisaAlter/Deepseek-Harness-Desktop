# 2026-08-26 推迟项 D 系列（D1→D3→D2→D4）生产交付回路（审查 → 计划 → 对抗审查 → 执行）

`Touching: desktop-launcher`（次要涉及 `boot-page`、`usage-stats`、`windows-installer` 各自登记的行）。

承接 [2026-08-26-desktop-launcher-skip-recovery-production-loop.md](2026-08-26-desktop-launcher-skip-recovery-production-loop.md) 对抗审查里**推迟**的 D1–D4 与 P2-4。本轮**另开分支** `cursor/deferred-d-series-production-0238`（基于 PR #44 tip `9568ad47`，#44 尚未合并、与 main 无分叉），**不**混入 #44；新 PR 显式声明依赖 #44。

## Phase A — 全面审查结论（对 #44 tip 重新核对，非沿用旧结论）

基线：#44 tip = main tip `fdf12c4d` + 14 个提交，PR 开放未合并。D1–D4 描述仍准确，但本轮审查新增了四个此前未记录的**硬事实**，直接改变各项的风险评估：

1. **CLI 的 insert 不去重**（`vendor/include/src/index.ts` `applyEntryPatches`：无目标 id 的 `insert` 直接 `data.push(...insert)`）。`composeProfile` 里的 `rows` Map 只服务 launcher 自查，**不代表挂载树**。同一 insert 若同时存在于 profile patch 与 `--patch` overlay ⇒ **双挂载**。D1 的迁移必须保证「撤块」与「传 overlay」原子成对（同一 ensure 函数、每次启动、spawn 之前），不能留一次启动窗口两边都在。
2. **`parsePatchList` 拒绝非数组 YAML**（`app-boot/src/index.ts`：`must be a top-level YAML array`）。模板型 `cordis.patch.yml` = 注释 + 受管块（追加块时模板的 `[]` 已被移除）；直接 strip 后只剩注释 ⇒ YAML 解析为 null ⇒ **所有全量启动 fail-loud**。迁移 strip 后必须把「无内容文件」归一化回 `[]`。这正是任务书点名的 D1 迁移危险，实锤。
3. **HMR 热重载保留 overlay 层**（`profile-boot.ts` `composeLive`：bundle 层之下、`composed.overlays` 之上重放，注释明说 "a user edit can never displace them"）。install 行迁到 overlay 后，用户运行期编辑 `cordis.patch.yml` 不会把 install 插件挤掉。D1 对 HMR 安全。
4. **`spawnHarness` 在 Windows `.cmd` 外部 dsh 场景用 `shell: true` 且参数不加引号**。overlay 路径在 `AppData\Roaming\...`——用户名带空格是常态。今天 skip 启动已暴露此隐患；D1 把 `--patch` 扩到所有启动会把暴露面放大到全部启动。必须一并修参数引号。

另两项范围事实：

- **`cordis.patch.yml` 的桌面写入方不止 desktop-install**：`usage-panel-preset` 每次全量启动 upsert 自己的受管块（`dshd-gui-usage-panel`）；`dshbot-preset` 在 dev opt-in（config `dshbotPreset: true`）下 upsert；dshmarket/dshbot 默认路径只 strip 遗留。「回归纯用户所有」若只迁 install 一个块，主张不成立。
- **`run-packaged-smoke.mjs` 已存在且平台就绪**（win-unpacked / mac .app + 内嵌 DSH_SMOKE 结果断言），`npm run smoke:packaged` 有脚本但 release.yml 未接。release.yml 触发器含 `workflow_dispatch`——接入后可先手动 dispatch 验证再打 tag。

D3 现状：boot 页错误面 = 重试（`shell:restart` → `retryFullPlugins`，卡上钉了 last-start 写入方）/ 取消自动重启 / 下载日志；启动器 Recovery Board = 全部插件级恢复（归因、逐项/批量禁用、skip、恢复完整插件）。两面之间**没有任何跳转**——boot 页失败后用户不知道排查工具在启动器里。`shell:open-launcher` 已存在但 HARNESS_ONLY。

D2 现状：`performStartOnce` 链 = stripDroppedPlugins / healDanglingBundles / ensureDesktopInstallPlugin / removeDshMarketPreset / ensureUsagePanel / dshbot ensure-or-remove / applyDisabledBundles。全部是「无残留即 no-op」的廉价 fs 检查。

## Phase B — 计划（优先级 D1 → D3 → D2 → D4）

| # | 目标 | 文件 | 验收标准 | 风险 |
| --- | --- | --- | --- | --- |
| D1 | **desktop-install 单一 overlay**：`ensureDesktopInstallPlugin` 不再 upsert 受管块，改为每次启动 strip（新旧两代记号）+ 归一化空文件为 `[]` + 写 `desktop-install.patch.yml` overlay；控制器**所有**启动经 `--patch` 传该 overlay；**usage-panel 同规则**（自有 overlay，仅全量启动传；ensure 失败/禁用/市场 bundle 接管时不传并删 overlay）；`spawnHarness` shell 模式参数加引号；契约脚本 full 轮改传 overlay（对齐生产 argv）并断言 install 行恰好一次 | `plugins.js`、`usage-panel-preset.js`、`harness-controller.js`、`dsh.js`、`check-skip-compose-contract.js` + 各单测 | 迁移金样例单测（模板+块→`[]`+overlay；用户内容保留；legacy 记号；空文件归一化）；真 CLI dump-config skip/full 双轮实证；`npm test` 全绿 | 迁移破坏存量 profile（用金样例+真 CLI 双保险）；Windows 空格路径（引号修复+单测） |
| D3 | **双恢复面收敛**：boot 页错误态新增「回启动器排查」入口（开启动器 → home tab → Recovery Board）；插件级恢复操作继续**只**存在于 Recovery Board。`shell:open-launcher` 放开 BOOT 角色（boot 发起时附带 show-tab home） | `ipc.js`、`preload/index.js`、`boot.html/js`、`boot-recovery.js` + 单测 | ipc 角色测试（boot 允许、launcher 拒绝不变）；boot-recovery 纯函数测试 | 低；纯入口层 |
| D2 | scavenger → 版本戳一次性迁移 | — | — | **再次推迟**（见对抗审查） |
| D4 | **release 链接 packaged smoke**：release.yml windows job 在 `npm run dist` 后跑 `smoke:packaged`（win-unpacked 实启 Electron + 真 dsh web + 内嵌结果断言），**阻断发版**、内置两次尝试吸收单次 flake、策略写进 workflow 注释；首跑经 `workflow_dispatch` 验证再打 tag | `release.yml` | YAML 结构正确；策略与首跑验证路径写清 | 本 VM 无法实跑 Windows（明确不声称）；flake 策略=2 次尝试+可 re-run |
| P2-4 | 控制器无效 skip 重试 | — | — | **再次推迟**（见对抗审查） |

## Phase C — 对抗审查（攻击 Phase B，含范围修订裁决）

**Q1：D1 迁移会不会弄丢/弄坏用户数据？**
- strip 只删记号对之间的块，块外用户行保留（`stripNamedBlock` 语义，金样例钉死）。文件不存在时**不再创建**（回归用户所有的题中之义）。
- 归一化：strip 后仅剩注释/空白 ⇒ 追加 `[]`（否则 `parsePatchList` fail-loud，见 Phase A 事实 2）。有用户行则原样保留。
- 回滚：老版本会把受管块写回并且不传 `--patch` ⇒ 单份、能启动；再升级再 strip。无任何窗口双挂载（strip 与 overlay 同一 ensure、每次 spawn 前）。**残余边缘**：用户在运行期手工把旧受管块文本粘回 `cordis.patch.yml` ⇒ 该 HMR 代内双挂载——自伤行为，下次启动即被 strip，接受并记录。
- 语义变化明示：overlay 在用户层**之上**，用户/home 层不再能 patch 掉桌面自有行（原本也只是边缘可行）；usage-stats 的受支持禁用路径仍是启动器禁用名单。

**Q2：D1 只迁 install 行吗？**
- 只迁 install ⇒「`cordis.patch.yml` 回归纯用户所有」是假话（usage 块每次全量启动照写）。**裁决：install + usage 都迁**；usage overlay 仅全量启动传，天然保持「skip 不预置用量」的既有卡片不变量。
- dshbot dev 预置（`dshbotPreset: true`，默认关闭、log-only）继续用受管块：迁移它要动第三张卡换一个 dev-only 场景，收益/风险不成比例。**裁决：保留为唯一显式 opt-in 例外并写进卡片**；默认产品路径下桌面对该文件只删不写。
- overlay 文件名从 `skip-user-plugins.patch.yml` 改 `desktop-install.patch.yml`（角色已变——所有启动都用）；ensure 顺手删除旧名残留。卡与 rules 同步改。

**Q3：D3 为什么不按字面「boot 页只留回启动器入口」执行？**
- 「重试」是运行期崩溃/瞬时失败的第一动作（`shell:restart` 走 `retryFullPlugins` 清 skip——desktop-launcher 卡 invariant 钉住的 last-start 写入方之一）；「下载日志」在唯一持有日志的面上；「取消自动重启」与 boot 页实时倒计时状态天然一体。三者都不是「插件级恢复」，砍掉= 纯 UX 倒退 + 重写两张卡的既有用户路径与 QA 用例。
- 真正的产品缺口是 boot 失败面到 Recovery Board **没有桥**。**裁决：收敛 = 职责分割 + 建桥**——boot 页管「瞬时重启、日志、跳板」，Board 独占一切插件级恢复（本来如此，写成卡片不变量钉死）；boot 错误态新增「回启动器排查」。此为对抗后的范围修订，不是照抄字面。

**Q4：D2 为什么再次推迟（这次给出比上轮更硬的理由）？**
- `stripDroppedPlugins` 承载「dshmarket DROPPED：不挂载、恢复禁止」的**持续性**产品不变量：dsh-home 是用户数据，可被备份还原、可被外部 `dsh plugin` 写入；版本戳一次性迁移会让「戳已打、残留回来」的组合**永久漏网**（戳在 config 则备份还原必然错位；戳在 dsh-home 则外部写入仍漏）。要守住不变量就得每启动复查——那「一次性迁移」就退化回现状+多一份状态。
- 该链每步均为 no-op 廉价检查，没有在解决任何实测性能/正确性问题。**裁决：推迟＝拒绝**，除非未来出现真实事故或大版本迁移需求。
- P2-4 同上轮：动 `performStart` 生命周期超出卡片允许面，预检已挡主路径。**继续推迟。**

**Q5：D4 阻断发版 vs 隔离不挡？**
- release 是 tag 触发的发版链，不是 PR merge——门禁红了挡的是「把没验证过的安装包发出去」，这正是要的效果。**裁决：阻断**，配两条对冲：(a) 步骤内置两次尝试（单次 flake 不否决，连续两次失败=真问题）；(b) release.yml 触发器本就含 `workflow_dispatch`，接入后先手动 dispatch 跑一轮 windows job 验证 smoke 步骤本身，再打 tag。策略原文写进 workflow 注释。
- 本 VM 是 Linux：**不声称** Windows packaged smoke 已实跑。Linux 侧以 `smoke:source`（同一套内嵌 smoke 断言机制）作 near-real 佐证（若本 VM GUI 依赖允许）。

**修订后本轮执行范围：D1（install + usage 双 overlay + 引号修复 + 契约对齐）、D3（建桥式收敛）、D4（阻断式接入 + 文档化门槛）。D2、P2-4 再次推迟（理由如上，比上轮更硬）。**

## 执行与验证记录

执行提交（本分支，`feature(<id>)` 逐项）：

| 项 | 提交 | 内容 |
| --- | --- | --- |
| D1 | `1f6c3da0` | `ensureDesktopInstallPlugin` strip（新旧两代记号）+ 空文件归一化 `[]` + `desktop-install.patch.yml` overlay + 删旧名 `skip-user-plugins.patch.yml`；`ensureUsagePanelPlugin` 同规则（`desktop-usage-panel.patch.yml`，禁用/失败/市场 bundle 接管时删 overlay）；控制器所有启动传 install overlay、全量另传 usage overlay；`harnessSpawnPlan` Windows `.cmd` shell 参数引号；契约脚本双轮传 overlay + 迁移回放 + 恰好一次断言 |
| D3 | `5deaedf3` | `shell:open-launcher` 放开 BOOT 角色（boot 发起 → home tab）、launcher 角色仍拒；boot preload 暴露 `openLauncher`；boot 页错误态「回启动器排查」按钮（仅 settled error 态，自动重启排程/进行中不出现）；`boot-recovery.js` 纯函数 + 单测钉死动作行 |
| D4 | `92e8c76a` | release.yml windows job `npm run dist` 与上传之间新增阻断式 `smoke:packaged` 步骤（pwsh 两次尝试、`DSH_SMOKE_TIMEOUT_MS=600000`、策略写注释）；推翻 `d9481ce7` 的「release 不跑 smoke:packaged」钉子并在 `ci-isolation.test.js` 重钉新位置（dist 后、上传前、含重试、无 continue-on-error、macos 不加）；`packaged-p0.test.js` 改为只禁 `qa:packaged` 进 release |
| 卡/rules | `b8c26e65` | desktop-launcher / boot-page / windows-installer / usage-stats 卡 + 三个 `.cursor/rules` + plugin-recovery handbook 流程同步 |

Phase E 实现自审中发现并处理：

- `ci-isolation.test.js` 与 `packaged-p0.test.js` **双钉** `smoke:packaged` 不进 release.yml（`d9481ce7`「分离质量验证与安装包构建」）。裁决：D4 本质就是推翻该钉——但推翻是**收窄的**：`npm test` / `test:gui` 仍禁止进 release（那才是「重复质量门」）；smoke 需要 dist 产物、只能存在于发布链，属产物验收。两处钉子改写为钉新不变量而非删除断言。
- usage ensure 失败时返回值可能带 `overlayFile`（磁盘上可能残留）——控制器只在 `ok !== false` 时收编 overlay，且 ensure 失败路径主动删 overlay 文件（防陈旧 overlay 复活），单测钉死。

Phase F 实证（本 Linux 云 VM，Node 22.22.2 / nvm，vendor `build:lib` + `apps/web build` 后）：

1. **`npm test` 全绿**：1094 tests，1091 pass / 0 fail / 3 skipped（skip 为环境性跳过，与本轮改动无关）。
2. **真 CLI 契约门禁**：`node scripts/check-skip-compose-contract.js vendor/deepseek-harness` 通过——fixture 预埋 canary 用户行 + 旧受管块，run 内断言迁移后 `cordis.patch.yml` 无受管记号且 canary 保留；skip 轮 canary 消失 + install 行在；full 轮（传 overlay）canary 回来 + install 行**恰好一次**。
3. **迁移边缘实证（真 CLI）**：模板型 profile（注释 + 受管块、无用户行——旧 upsert 已吃掉模板 `[]` 的最常见存量形态）经 ensure 迁移后 = 注释 + `[]`；`bin.js web --patch <overlay> --dump-config` exit 0、install 行恰好 1——证明 strip 归一化对 `parsePatchList` 安全、无双挂载。
4. **near-real GUI 冒烟（真 Electron + 真 dsh web，Xvfb :1）**：`npm run smoke:source` PASS（UI frame / titlebar 六键 / hit-testing surfaces+branch+git / PTY echo 全健康）——该冒烟走的就是 D1 后的全量启动路径（install + usage 双 overlay 经 `--patch`）。`DSH_SMOKE_KEEP=1` 复跑后检查现场 profile：`cordis.patch.yml` = CLI 自写的纯用户模板（注释+`[]`，桌面未写一字）；`desktop-install.patch.yml` / `desktop-usage-panel.patch.yml` 内容与设计一致。
5. **release.yml**：YAML 解析通过（python yaml.safe_load）；`ci-isolation.test.js` / `packaged-p0.test.js` 新钉全绿。

**诚实边界**：Windows NSIS Setup 的 packaged smoke（D4 新步骤本体）未在本 VM 实跑（Linux 环境）；已在卡与 workflow 注释写明「首个 tag 前须 `workflow_dispatch` 手动跑一轮 windows job 验证」。Windows 引号修复由 `harnessSpawnPlan` 单测（isWin 注入）覆盖，非实机。

**再次推迟（维持 Phase C 裁决）**：D2（清道夫链版本戳化——会把「dshmarket 永不挂载」等持续性不变量降级为一次性检查，备份还原/外部写入即漏）；P2-4（控制器无效 skip 重试——超出卡片允许面，`buildLaunch` 预检已挡主路径）。
