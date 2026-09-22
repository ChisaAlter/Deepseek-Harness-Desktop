# 合并收口（Post-consolidation closeout）：#39 落地、node-half 修复、QA 与实机缺口计划

> **For agentic workers:** 本计划同时是设计文档与执行记录：Phase 1–4 已在云端执行完毕（含证据），Phase 5–6 是留给实机/人工的可执行手册。复核时用 checkbox 对账。
> **第二轮追加（2026-08-25，模型 `claude-fable-5-thinking-high`）：** Phase 7–10 —— #40 落地记录、macOS watch 测试抖动修复、壁纸 qa:source 联网复验、TC-REM-002 解禁前置。Phase 7–8 已执行；9 见执行记录；10 为低优先设计。

**Goal:** 把合并 PR #39（`cursor/consolidate-open-prs-562f`）安全落到 `main`、关闭全部被替代 PR、删除已并入的远端分支；修复 main 上遗留的 `node-half.client.spec.ts` 红灯；用**合并后树**的新数字刷新相关 feature card 的 `last verified`；把仅剩的两个实机缺口（Windows git-titlebar、TC-EXT-007 dshbot 冒烟）落成可一键执行的验证手册。

**Non-goals:**

- 不在本轮实现任何新产品行为（无新 UI、无新 IPC、无新插件能力）。
- 不做 GPU 终端嵌入、worktree、turn-diff、review-comment pick（work-loops note 明确 out of scope）。
- 不在云端 Linux 伪造 Windows / 实机结论：跑不了的门只落手册与 Pass/Fail 标准，不填结果。
- 不动官方 `~/.dsh`、不重写 vendor pin。

**Touching:** 本文件为 docs/plans 落盘；代码改动仅 `vendor/deepseek-harness/tsconfig.base.json` 一行（测试基础设施，局部修复，不改产品契约，详见 Phase 3 的 Feature Spine 说明）；feature card 仅刷 `last verified` 字段。

**Review provenance:**

- 父代理对 PR #39 的合并审查结论（2026-08-25）：#36/#34/#37/#35/#38 已并入一支，#33/#32/#25/#24 经 ancestry 验证被 #36 包含；desktop `npm test` 997 绿；harness `test:gui` 仅剩 `node-half.client.spec.ts` 一个 main 既有红灯。
- 云端子代理本轮复核（模型 `claude-fable-5-thinking-high`，2026-08-25）：全部 ancestry 重新独立验证（见 Phase 1 证据）。

---

## 依赖顺序与风险

```
Phase 1 落地 #39 → Phase 2 关 PR / 删分支（GitHub 检测 head 可达自动完成大半）
                 ↘ Phase 3 node-half 修复（依赖合并后树，但对 main 也独立成立）
                       → Phase 4 刷 feature card last verified（依赖 3 的新绿数字）
Phase 5 Windows git-titlebar 实机   —— 独立，仅依赖 CI 安装包
Phase 6 TC-EXT-007 dshbot 冒烟      —— 独立，仅依赖 CI 安装包（手册已在库内）
Phase 7 落地 #40（本计划+node-half 修复上 main）→ 之后才可宣称 main 上 node-half 已修
                 ↘ Phase 8 macOS watch 测试抖动修复（独立分支，修的是 main 既有 CI 红）
Phase 9 壁纸 qa:source 联网复验     —— 独立，仅依赖出网 + xvfb 环境
Phase 10 TC-REM-002 解禁前置        —— 低优先设计，不阻塞收口
```

**风险 R1 —— #33 vs #37 双实现残渣。** #33（production-hardening）与 #37（surfaces/terminal Phase 0–5）都动过保存竞态、`` Ctrl+` `` 快捷键与 preview-automation 链；#39 合并时按「#37 架构胜出」解了 20 处冲突，并追加 `6343b9b3` 删掉与 #37 冒泡设计矛盾的旧 drawer-chord `preventDefault` 断言。**复核结论（本轮）：** 合并树上 `preview-automation` 仅剩两处**反向守卫**断言（`src/main/preview.test.js:795`、`src/preload/shell-api.test.js:125`，断言链路保持删除态）；`ui-titlebar` / `ui-user-terminal` 无 `.xterm` 残留；desktop 997 绿 + harness `test:gui` 5338 绿（见 Phase 3）即无残渣破门。风险闭合。

**风险 R2 —— PR 关闭顺序。** 若先手动 close 被替代 PR 再合 #39，GitHub 将失去把它们标为 `MERGED` 的机会（close ≠ merged，追溯性差）。**正确顺序（已按此执行）：** 先把 #39 的 head 合入 main，GitHub 检测到各 PR head 可达 main 后自动把 #24、#25、#32–#38 全部标 `MERGED`，无需任何手工 close。

**风险 R3 —— 误删未并入分支。** 删除前对每支跑 `git merge-base --is-ancestor origin/<branch> main`；不满足的一律保留并上报。（本轮全部满足，见 Phase 2。）

**风险 R4 —— tsconfig paths 改动影响面。** paths 是全仓测试/静态门的源面解析入口，加错映射可能让 lib/ 双单例问题复发。缓解：只加**精确子路径**一条（exact match 优先于通配，不影响其他包）；typecheck + test:gui 全绿后才提交。

**风险 R5 —— macOS CI 抖动掩盖真回归。** `git-workspace-watch.test.js` 的「arm 时注册文件已存在 → 恰好一次信号」断言在 macOS runner 上间歇双触发（main 头 `ea659884` 的 run 32843072840 与 #40 head 的 run 32844221093 同测同因失败）。若放着不管，macos-latest 红灯会常态化，掩盖后续真回归。根因与修复设计见 Phase 8；豁免依据：与 main 头**逐字相同**的既有失败 ≠ #40 回归。

---

## Phase 1 — 落地 PR #39（已执行 ✅）

- [x] 复核 mergeability：`gh pr view 39` → `MERGEABLE`；`git rev-list origin/cursor/consolidate-open-prs-562f..main` 为空（main 无分叉，可安全合并）。
- [x] 独立重验 ancestry（不轻信 PR body）：#36/#34/#37/#35/#38/#33/#32/#25 的 head 与 #24 的 head SHA `b2dfc759` 全部是 #39 head 的祖先。
- [x] 本地 `git merge --no-ff` 合入 main，合并树跑 desktop `npm test`：**997 pass / 0 fail / 3 skip**（与父代理审查数字一致）后才 push。
- [x] `git push origin main`（普通 push，非 force）→ main `c8fdbc27..ea659884`。

## Phase 2 — PR 关闭与分支清理（已执行 ✅）

- [x] push 后确认 GitHub 自动把 **#24、#25、#32、#33、#34、#35、#36、#37、#38、#39 全部标 `MERGED`**；`gh pr list --state open` 为空。
- [x] 逐支验证包含关系后删除远端分支（14 支中 5 支已被 GitHub 自动删除，其余 9 支手动删除）：
  `consolidate-open-prs-562f`、`delivery-closeout-2026-08-25-cbe8`、`git-titlebar-review-remote-switch-b001`、`surfaces-terminal-hardening-449e`、`message-edit-production-polish-c3ee`、`marketplace-desktop-integration-7027`、`production-hardening-delivery-3eb5`、`branch-review-merge-6e0a`、`mobile-web-scan-parity-plan-fbe6`（手动）；`desktop-launcher-cold-start-fixes-c4f7`、`dshbot-standalone-plugin-6ce3`、`mobile-web-scan-android-parity-cf23`、`official-home-import-productionize-c4f7`、`surfaces-terminal-review-plan-ee9b`（自动）。
- [x] 终态：远端仅剩 `main`（+ 本轮工作分支）。

## Phase 3 — `node-half.client.spec.ts` 修复（已执行 ✅）

**症状：** `pnpm run test:gui` 下该 spec 整文件挂：`Cannot find package '@deepseek-ai/dsh-app-boot/features' imported from packages/client/modules/src/index.ts`。main 既有（早于 #39）。

**根因：** harness 的「源面 vs 制品面不混用」规则由 `tsconfig.base.json` 的 `paths` 表实现（vitest 经 `vite-tsconfig-paths` 读同一张表，且 *paths 必须赢过 package exports*，避免 lib/ 二次单例）。表里通配 `@deepseek-ai/dsh-*` 只映射到 `./packages/boot/*/src` 等**包主 id**；`@deepseek-ai/dsh-app-boot/features` 这种子路径无精确条目，通配把 `*` 吞成 `app-boot/features` 后替换出不存在的目录，解析回落到 package exports 的 `./lib/features.js` —— 未 build 即不存在。

**方案取舍：**

| 选项 | 评估 |
| --- | --- |
| A. `paths` 加精确条目 `"@deepseek-ai/dsh-app-boot/features": ["./packages/boot/app-boot/src/features.ts"]` | **选定。** 与既有先例同构（`dsh-mcp-servers-file` 主 id 映射修复、各 `/types`、`/client` 精确条目）；一行、零行为面 |
| B. 测试前先 build app-boot | 违反源面规则（lib/ 双单例风险），且把「clean tree 即绿」门做脏 |
| C. spec 内 mock 掉 features 导入 | 掩盖解析缺口，下一个从源面 import 该子路径的包还会挂 |

**Feature Spine 说明：** 这是 vendor/harness 测试基础设施的局部修复，不改任何产品契约，不属于任何 feature card 的行为面（对应卡规则中的「本地修复，不改产品契约」声明）。commit：`fix(vendor): tsconfig 补 dsh-app-boot/features 子路径映射，修复 node-half spec 源面解析`。Agent Note 豁免理由：机械性单行 paths 补条目，与先例 `3fd08587` 同类。

- [x] 复现（合并树 + 干净 install）：spec 整文件挂，报错与父代理记录一致。
- [x] 落方案 A；单 spec 重跑 **27/27 绿**。
- [x] `pnpm run test:gui`（合并树 + 修复）：**409 文件全绿（1 skip），5338 pass / 4 skip / 0 fail**。
- [x] `pnpm run typecheck` 绿（paths 改动无类型面回归）。

## Phase 4 — Feature card `last verified` 刷新（本轮执行 ✅）

只刷有**本环境新证据**的卡；不编造数字，不动不变量。

| 卡 | 刷什么 | 证据 |
| --- | --- | --- |
| `surfaces-work-loops` | 合并后树数字：desktop `npm test` 997 绿；harness `test:gui` 5338 绿（node-half 修复后 0 红）；`qa:source` 本轮结果 | Phase 1/3 + 本轮 qa:source 日志 |
| `terminal-drawer` | 同上（合并树含 drawer-chord 断言清理，`test:gui` 全绿即覆盖） | 同上 |
| `message-edit` | `test:gui` 合并树全绿（含 ui-message-edit / ui-conversation 编辑会话规格） | Phase 3 |
| `marketplace-settings` | desktop `npm test` 997 绿（含 dshmarket-preset / ui-settings-market 相关单测） | Phase 1 |
| `git-titlebar` | 合并树 desktop 997 绿（git 链单测在内）；实机 Windows 仍缺口（Phase 5） | Phase 1 |

不刷：`dshbot`（TC-EXT-007 实机仍阻塞，卡已如实记载）、`mobile-remote` / launcher / wallpaper 等本轮无新证据的卡。

## Phase 5 — Windows git-titlebar 实机验证手册（待实机执行 ☐）

**目标不变量（卡 `git-titlebar`）：** Windows 上 git 子进程超时/输出超量必须 `taskkill /PID /T /F` 杀整棵树（hooks/ssh 不残留）；taskkill 非零退出回退 `child.kill()`；兄弟仓登记后标题栏即刻授权（首载竞态修复）。

**前置：** Windows x64 实机或长驻 VM；一次 test.yml 已绿的 CI `DeepSeek-Harness-windows-x64` artifact（记录 CI SHA）；同 SHA 检出。

**步骤与 Pass/Fail：**

1. 静默安装 Setup，正常启动，打开一个真实 git 仓库工作区。
   - Pass：标题栏显示当前分支；分支菜单可搜索/切换/创建。
2. **兄弟仓首载竞态**（TC-WS-006 / TC-GIT-001 实机位）：以 `Documents\Deepseek-Harness-Desktop` 类目录启动，会话 cwd 指向兄弟目录仓（如 `C:\Ai\ChisaTerminal`），观察首次登记后**不聚焦窗口**的行为。
   - Pass：登记写入 `workspace.json` 后标题栏无需重新聚焦即显示分支（`shell:git-workspaces-changed` 推送生效）；Fail：空态或需点窗才刷新。
3. **进程树查杀**：在仓库 `.git/hooks/pre-commit` 挂一个 `powershell -c sleep 600` 的 hook，触发 commit 使 git 超时。
   - Pass：超时后 `tasklist` 无残留 `git.exe`/`powershell.exe` 子树、`.git/index.lock` 不残留；再次 commit 正常。
   - 变体：用受限 ACL 使 `taskkill` 拒绝访问 → Pass 标准为 git **直接子进程**仍被 `child.kill()` 收掉、UI 报错不永久 loading。
4. 白名单外分支名（如含 `^` 的合法 git 名）：picker 列出但该行禁用 + hint。
5. 跑生产表 `TC-GIT-001`…`007`、`TC-WS-006`。

**证据落点：** `docs/qa/results/<日期>/git-titlebar-windows.md`（步骤输出 + CI SHA + tasklist 截查），回填 production-acceptance 汇总表；更新 `git-titlebar` 卡 `last verified` 移除「实机 Windows 仍未覆盖」句。

## Phase 6 — TC-EXT-007 dshbot 安装冒烟（待实机执行 ☐）

执行手册已完整落库：[docs/qa/tc-ext-007-dshbot-install-smoke.md](../../qa/tc-ext-007-dshbot-install-smoke.md)（Phase A 默认无页签 / Phase B 市场一键装+建群 / Phase C 卸载无残留，A/C 自动化探针 `plugin.dshbot.*` 已在 walk 内）。

**阻塞（复核仍成立）：** 云端 Linux 跑不了 Windows NSIS 安装包与打包 Electron GUI；唯一纯手工步骤是 Phase B 的建群冒烟。**不得**用旧「停放 Pass」冒充。

**证据落点：** `docs/qa/results/<日期>/` 三相报告 + CI SHA；汇总表 TC-EXT-007 行；`dshbot` 卡 Open follow-ups 首行。

**占位脚手架（第二轮已落）：** [docs/qa/results/2026-08-25/](../../qa/results/2026-08-25/README.md) 内含 Phase 5 报告模板 `git-titlebar-windows.md` 与 Phase 6 报告模板 `tc-ext-007-dshbot.md`，全部字段 ☐ NOT RUN，实机执行日若晚于 2026-08-25 整体挪到实际日期目录。

## Phase 7 — 落地 PR #40（第二轮已执行 ✅）

**合并前检查单（依序执行，均通过）：**

- [x] `gh pr view 40` → `MERGEABLE`；head `7c7689d4`（三 commit：tsconfig 一行、本计划、五卡刷新）。
- [x] main 未分叉：`git rev-list origin/cursor/post-consolidation-closeout-562f..main` 为空，merge-base == main 头 `ea659884` —— PR head 树**就是**合并后树，CI 对 head 的结论直接适用于合并结果。
- [x] CI 对 head 的结论：`vendor-gui`（windows，`pnpm install + build:lib + test:gui + gen-client-catalog/notices --check`）**SUCCESS**；`Desktop unit tests (windows-latest)` **SUCCESS**；`Desktop unit tests (macos-latest)` **FAILURE**。
- [x] macOS 失败豁免核查：失败测试为 `git-workspace-watch.test.js` 第 332 号「arming … fires the initial signal once」（2 !== 1），与 main 头 `ea659884` 的 run 32843072840 **同测试、同断言、同错误** —— 既有抖动，非 #40 回归（根因与修复见 Phase 8）。豁免理由已写进合并 commit message。
- [x] 本地 `git merge --no-ff` + `git push origin main`（非 force）→ main `ea659884..cecfbade`；GitHub 自动把 #40 标 `MERGED`（12:00:34Z）。
- [x] ancestry 验证后删除远端分支 `cursor/post-consolidation-closeout-562f`。

**合并后验证（云端 Linux，本轮已跑）：**

- [x] desktop `npm test`（合并树 + Phase 8 修复）：**1000 tests / 997 pass / 0 fail / 3 skip**。
- [x] harness `test:gui` + typecheck：全量不在本地重跑 —— CI `vendor-gui` 已对**同一棵树**（head == merge 树）全绿；另在本地（`setup:harness` 后）单跑 `node-half.client.spec.ts` **27/27 绿**，直接钉死 main 上的修复。
- 复核命令（任何人可重放）：`gh pr view 40 --json state,mergedAt`；`git log --oneline -3 main`；`npm test`。

## Phase 8 — macOS `git-workspace-watch` 测试抖动修复（第二轮已执行 ✅）

**症状：** macos-latest 间歇失败「arming with an already-existing registry fires the initial signal once」，`fired` 为 2 而非 1。Linux/Windows 稳定。

**根因：** 测试先写入 `workspace.json` 再 arm（debounceMs=10）。arm 时 statSync 补发一次初始信号（产品设计如此，卡 `git-titlebar` 不变量明载）；随后 macOS FSEvents（libuv 进程级共享 stream，新增 watch 路径时重启 stream 会带出 arm **之前**的写事件）把这次 pre-arm 写**再投递一次**。生产 debounce 200ms 能把重放并进同一窗口；测试用的 10ms 窗口早已关闭 → 第二次 onChange。即：双触发是**平台重放 + 测试窗口过小**的组合，不是 watcher 逻辑缺陷 —— 实现注释本就声明「spurious refresh 是廉价的 status 重读」。

**方案取舍：**

| 选项 | 评估 |
| --- | --- |
| A. 断言改「补发 + 静默收敛」：`fired ≤ 2` 且再等 150ms 不增长 | **选定。** 测的是真实契约（recovery + quiescence），对重放时刻不敏感，确定性最高 |
| B. 测试 debounce 调大到 ≥150ms 保住「恰好一次」 | 仍是与 FSEvents 重放赛跑，慢 runner 上重放晚于窗口照样红 |
| C. 实现里 arm 后吞掉短窗内的 watch 事件 | 会吞真实变更，为测试改产品语义，违背「spurious 廉价、漏发才是 bug」的设计 |

**Feature Spine：** Touching `git-titlebar`（Allowed touch 含 `git-*.js` 单测）；纯测试断言修正，产品行为与卡不变量**零改动**。

- [x] 修改 `src/main/git-workspace-watch.test.js`：改名「fires the initial signal and settles」，断言 `settled ≤ 2` + 150ms 静默复查。
- [x] 本地验证：该文件 `node --test` 连跑 5 次 8/8 绿；全套 `npm test` 997 绿。
- [ ] 观察本分支 CI 的 macos-latest 结果；合并后连续 2 次 main run macOS 绿即视为抖动闭合（Linux 无 FSEvents，本地无法复现双触发路径，只能以 CI 为准）。注：#40 合并 commit `cecfbade` 的 main push run 32845265073 全绿（含 macOS）——抖动本就间歇，单次绿不构成闭合，修复仍需落 main。

## Phase 9 — 壁纸 `qa:source` 三步联网复验（第二轮设计 + 执行记录）

**背景：** Phase 1–4 轮在云端跑 `qa:source` 时 `appearance.localCrop` / `gallery.confirmSet` / `appearance.frost` 三步失败，被记为「既知环境失败，非回归」。该结论需要在**具备出网**的环境复验一次才能钉死「env-only」。三步的依赖链：`gallery.confirmSet` 需要 Bing Daily 缩略图真实加载（出网）；`appearance.frost` 接受「壁纸设置成功后的滑杆」或「本地裁剪后的滑杆」两条路径，前一步失败会连锁；`appearance.localCrop` 走本地文件注入 + 裁剪对话框，理论上不依赖网络，需单独归因。

**复验手续（联网机器 / 出网云环境通用）：**

1. 前置探测：`curl https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1` 与 `curl https://wallhaven.cc/api/v1/search?purity=100` 均须 200（先证明「网络可用」，失败归因才有效力）。
2. 环境就绪（顺序敏感）：Node 版本对齐 `.nvmrc`（22.22.2；22.14 会因 engine 不满足让 tsdown 缺 `unrun` 直接炸 build）→ 根 `npm ci` → **`npm run setup:harness`**（vendor pnpm install + **full build**——desktop 的 `sourceHarnessStatus` 检查 `apps/cli/lib/bin.js` 与 `apps/web/dist/index.html`，仅 `build:lib` 不够，walk 会停在 boot 页把全部步骤连锁打红）。
3. `xvfb-run -a npm run qa:source`（本地有显示器则免 xvfb）。
4. 判读：只看三步的 step 行。三步全 PASS → 钉死 env-only，更新 `wallpaper-gallery` 卡 `last verified`（带日期 + 环境描述）；`gallery.confirmSet` 仍 FAIL 且步骤 1 的 200 成立 → **真回归**，开修复项、不许再记环境失败；`appearance.localCrop` 单独 FAIL → 与网络无关，按 file-input/crop 对话框链路排查。

**本轮执行记录（出网云 Linux + xvfb）——已闭合 ✅：**

- [x] 步骤 1：Bing 与 Wallhaven 均 200 —— 本环境出网可用，具备复验效力。
- [x] 步骤 2 教训（已回填进上面的手续）：首跑仅 `build:lib` → walk 停在 boot 页（bootLogs：「还没安装依赖或构建。请运行 npm run setup:harness」），60 步连锁全红 —— 该失败形态与「壁纸三步失败」**完全不同**，判读时不可混淆。
- [x] 步骤 3：`setup:harness` 后复跑 —— 出网正常（Bing 缩略图加载、确认对话框出现并点击「设为壁纸」成功），三步**仍失败**：`localCrop`「file assigned, crop missing」、`confirmSet`「Bing confirmed」（确认成功但裁剪未现）、`frost`「sliders missing」。三步共因收敛到**裁剪对话框从未被 walk 识别**。
- [x] 步骤 4 真根因：**walk 匹配器缺英文标题**。裁剪对话框标题 `wallpaper.crop` 为 zh「调整背景图」/ en「Adjust wallpaper」，walk 的 `dshDialogNamed('调整背景图|crop wallpaper|crop')` 两者皆不匹配英文标题；本环境 UI 走英文局点（themeSwitch/surfaces 文案均英文），故对话框实际打开但 walk 视而不见、从不点「Use this image」，壁纸永不落地 → frost 滑杆永不出现。**此前「环境失败」的真面目 = 无网环境缩略图不加载（旧云）+ 英文局点匹配缺口（凡英文环境）两个不同原因；均非产品回归。**
- [x] 修复：`release-ui-walk.js` 两处裁剪匹配器补 `adjust wallpaper`（QA 基础设施局部修复，不改产品契约；`wallpaper-gallery` 卡行为面零改动）。
- [x] 复跑证据：`qa:source` **exit 0、failed=[]、三步全 PASS**（`crop confirmed` / `Bing confirmed and cropped` / `frost+pixelate after wallpaper`）——首次在云端拿到全绿 qa:source。desktop `npm test` 997 绿不回归。
- [x] 结论回填：`wallpaper-gallery` 卡 `last verified` 刷新（真实证据）；QA 矩阵该行状态更新；「既知 3 项环境失败」豁免**作废**，此后 qa:source 允许 0 失败为基线。

## Phase 10 — TC-REM-002 真机扫码解禁前置（低优先设计 ☐）

**现状：** `mobile-remote` 卡 `parked`，`REMOTE_FEATURE_ENABLED = false`，QA 汇总表 TC-REM-001…003 记 N/A 是**设计口径**而非缺口；`#offer=` 自动登录链路已在真 `RemoteGateway` + 真 `mobile/web` 树上 e2e 钉死（remote.test.js 31/31）。

**解禁 TC-REM-002 的前置（依序）：**

1. 产品决策解除停放：翻 `REMOTE_FEATURE_ENABLED`，对 `mobile-remote` 卡开新 Touching（改 status、User paths 去停放注）—— 无此决策则 TC-REM-002 保持 N/A，**不是**本收口计划的欠账。
2. 带该开关的打包构建（Windows Setup 或 Linux 包均可，网关在主进程）。
3. 真机侧：手机与桌面同 LAN；扫码页要求 secure context（`BarcodeDetector` + `getUserMedia`）——LAN 明文页降级为粘贴 offer，跑 TC-REM-002 时两条路径都要各验一次；HTTPS 中继模式另验 relay origin。
4. 执行 TC-REM-001…003 并回填汇总表（从 N/A 改实测值）；Android 侧同二维码走 Compose 客户端对照。

**不做：** 本计划不翻开关、不改卡状态；此 Phase 仅把「哪天要解禁时从哪里开始」写死，避免重新考古。

## QA 矩阵：哪些门在云端/CI 可闭合，哪些必须实机

| 门 | 云端/CI | 实机 Windows/人工 | 本轮状态 |
| --- | --- | --- | --- |
| desktop `npm test` | ✅ | — | 997/0/3 绿（合并树） |
| harness `pnpm run test:gui` | ✅ | — | 5338/0 绿（修复后） |
| harness `pnpm run typecheck` | ✅ | — | 绿 |
| `npm run qa:source`（xvfb + 源码 Electron） | ✅ | — | 第二轮（Phase 9）：walk 裁剪匹配器补英文标题后**全绿 exit 0（failed=[]）**，含壁纸三步；「既知 3 项环境失败」豁免作废 |
| `smoke:packaged` / `qa:packaged`（Linux 包） | ✅（CI artifact） | — | 未在本轮重跑（无行为改动） |
| TC-WS-006 / TC-GIT-001…007 实机 | rehearsal 仅 | **必须**（Phase 5） | ☐ 待实机 |
| TC-EXT-007 dshbot 三相 | A/C 探针 rehearsal | **必须**（Phase 6，B 相纯手工） | ☐ 待实机（模板已就位 `docs/qa/results/2026-08-25/`） |
| TC-REM-002 真机扫码 | — | 必须（前置见 Phase 10；停放期 N/A 是设计口径） | ☐ |
| macos-latest desktop 单测 | ✅（CI） | — | Phase 8 修复已落分支，待 CI 连续 2 绿闭合 |
| 壁纸 qa:source 三步（联网） | ✅（出网环境） | — | Phase 9 执行中（见其执行记录） |

## Rollout / rollback

- **Rollout：** main 已含全部合并；本工作分支（plan + tsconfig 一行 + 卡刷新）独立可并，无 stacking（#39 已落地，方案 (b)：直接基于新 main）。
- **Rollback：** 若合并树暴露未预见回归，用 `git revert -m 1 ea659884` 一次性回退整个 consolidation 合并（分支已删但对象仍在，PR #39 页面可找回）；node-half 修复独立成 commit，可单独 revert；卡刷新纯 docs。**不 force-push main。**
- **第二轮 rollback：** #40 的合并可 `git revert -m 1 cecfbade` 整体回退（内含 tsconfig 一行 + 纯 docs）；Phase 8 测试修复独立 commit 可单独 revert（回退后 macOS 抖动回归原状，非产品风险）；QA 模板与本计划追加均纯 docs。
- 分支删除均验证过 ancestry，可随时从对应 merge commit / PR 页恢复。

## Open questions

无阻塞性未决项。Phase 5/6 仅等待实机资源（Windows x64 + 已绿 CI artifact），手册、Pass/Fail 标准与报告模板（`docs/qa/results/2026-08-25/`）已备齐。Phase 8 待 CI macOS 连续绿确认；Phase 9 待本轮 `setup:harness` 后复跑回填；Phase 10 待产品解禁决策（非欠账）。
