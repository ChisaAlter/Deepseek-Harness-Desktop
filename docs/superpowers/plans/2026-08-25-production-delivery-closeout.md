# 生产交付收口计划（Delivery Closeout）— 2026-08-25

> **For agentic workers:** 本计划是当日开放 PR 的合并收口执行清单。步骤用 checkbox 跟踪；完成一项勾一项。

**Goal:** 把当前开放的生产 PR（#33 hardening、#34 git-titlebar）收敛成**一条可直接合入 main 的主干候选**，补齐审查残留，跑通验证门禁与实机冒烟，并对做不到的项目（Windows NSIS、npm 实发）做诚实标注而非假装完成。

**Non-goals（明确不做）:**

- 不解禁 mobile-remote（保持 parked）。
- 不修预存的 `ui-preview` tsc 错误与 translation-pairing 漂移（预存债务，单独立项）。
- 不在本 VM 假装执行 Windows NSIS 安装实测（TC-EXT-007）；只准备好 runbook 并核对 CI。
- 不做 GPU 终端嵌入 / worktree / turn-diff 等合同外能力。
- 不 force-push main；不代替维护者合并 PR。

---

## 一、开放 PR / 分支现状（2026-08-25 08:10 UTC 复核）

| PR | 分支 | 状态 | CI | 结论 |
| --- | --- | --- | --- | --- |
| #33 | `cursor/production-hardening-delivery-3eb5` | DRAFT | mac/win 单测 + vendor-gui **全绿** | 主干候选基底；已完整包含 #32（`33...32` diff 为空） |
| #34 | `cursor/git-titlebar-review-remote-switch-b001` | DRAFT | 单测绿；vendor-gui 进行中 | 与 #33 无冲突（干净合并验证过），合入收口分支 |
| #32 | `cursor/branch-review-merge-6e0a` | DRAFT | — | **建议关闭**：内容 100% 被 #33 覆盖 |
| #25 | `cursor/mobile-web-scan-parity-plan-fbe6` | DRAFT | — | 纯 plan 文档；mobile-remote parked，保持开放不动 |
| #24 | `feature/ui-settings-skills-grouping`（fork） | OPEN | — | 内容已由 #32→#33 吸收并加固；**建议关闭**（致谢来源） |

**收口分支:** `cursor/delivery-closeout-2026-08-25-cbe8` = #33 + merge(#34)。
（平台强制分支后缀 `-cbe8`，故未用 `-6e0a` 后缀。）

## 二、合并顺序建议

1. **合 #33**（或直接合本收口分支，等价于 #33+#34 一次到位）。
2. 若分开合：#33 进 main 后 rebase/merge #34 再合。
3. 合并后**关闭 #32**（被包含）与 **#24**（被吸收），PR 留言注明去向。
4. #25 保持 DRAFT parked。

## 三、修复切片（本分支执行项）

- [x] S1: 从 `origin/cursor/production-hardening-delivery-3eb5` 拉出收口分支，干净合入 #34（无冲突）。
- [x] S2: 生产级复审合并后 diff（重点：`src/main/git-ipc-guard.js`、`src/main/ipc.js`、`ui-git` 错误路径、`fileSaveCoordinator` flush、`keybindings.ts`、dshbot publish 门）。发现问题→修复或记 backlog（见「审查发现」）。
- [x] S3: 修复审查中发现的实际缺陷（若有），每个缺陷单独 commit `feature(<card>): …`。
- [x] S4: 落盘本计划 + 修完回勾。

## 四、测试矩阵

### 单测 / 门禁（本 VM，Node 22.22.2 per `.nvmrc`）

- [x] 桌面 `npm test`（`src/**/*.test.js` + `mobile/web/**/*.test.js`）
- [x] vendor `ui-git` vitest（#34 触面）
- [x] vendor `ui-surfaces` / `ui-titlebar` / `ui-user-terminal` vitest（#33 触面抽查）
- [x] dshbot publish 预检 `scripts/check-dshbot-publish.mjs`

### 实机（本 VM Linux）

- [x] `npm run smoke:source`（源码启动冒烟）：titlebar 全按钮、PTY 回显、命中测试全过
- [x] `npm run pack`（electron-builder Linux dir 包）+ `DSH_SMOKE_EXE=dist/linux-unpacked/deepseek-harness-desktop npm run smoke:packaged`：packaged 冒烟全过（Windows NSIS 本环境不可做，见诚实阻塞）
- [x] P0 定点：Files 显式保存 flush 竞态（persist/save 测试 + 代码路径核对）
- [x] P0 定点:终端焦点内 `` Ctrl+` ``（keybindings 测试 + Ghostty DOM 选择器核对)
- [x] P0 定点：`preview-automation-*` IPC 全链已不存在(grep main/preload/ui-preview)
- [x] GUI 证据：源码冒烟录屏 `/opt/cursor/artifacts/source-smoke-electron-titlebar-terminal.mp4`（真实 Electron 窗口，titlebar 含分支切换/Git actions/终端抽屉开关，PTY 回显 ok，点击命中 surfaces/branch/git 各 1）

### CI（GitHub，`gh` 只读核对）

- [x] #33 checks 全绿（mac/win 单测 + vendor-gui，run 32824257966）
- [x] #34 首批提交 run 32824786135 三 job 全 success（含 vendor-gui）；追加 3 个提交后的 run 32826879818 亦三 job 全 success；新提交已二次合入本分支并本地全套验证
- [ ] 收口分支自身 checks：`test.yml` 仅在 `pull_request` / push-main 触发，本分支尚无 PR 时不会跑；本 VM 已按 CI 三个 job 的完整步骤等价执行（desktop `npm test`、vendor `build:lib`+`test:gui`、`gen-client-catalog --check`+`gen-third-party-notices --check`）全绿；PR 开启后复核

### 诚实阻塞（本环境做不到）

- TC-EXT-007 Windows NSIS 安装实测：Linux VM 无法执行；依赖合并后 Windows CI artifact + runbook（#33 已含 runbook）。
- dshbot npm 实发：仓库无 `NPM_TOKEN`；tag 工作流已就绪，等 secret 配置。

## 五、风险

| 风险 | 缓解 |
| --- | --- |
| #34 vendor-gui 尚未完成，合入内容可能带回归 | 本地跑全量 `ui-git` 套件 + 收口分支自身 CI 兜底 |
| `git-ipc-guard` 包装层改变错误语义，前端出现双 toast 或吞错 | 复审 guard 与 `ui-git` catch 的职责边界（见审查发现） |
| Node 22.22.2 pin 与 VM 默认 node（/exec-daemon/node 22.14）不一致 | 测试全程显式 PATH 到 nvm node；CI 用 `.nvmrc` |
| 双 PR 分开合并造成 vendor 目录冲突 | 优先合收口分支一次到位 |

## 六、完成定义（DoD）

- [x] 收口分支 = #33+#34，合并干净、推送到 origin。
- [x] 本 VM:桌面 `npm test` 绿;#33/#34 触面的 vendor 套件绿。
- [x] P0 三点(save flush / Ctrl+` / automation IPC 移除)有针对性验证记录。
- [x] 审查发现的问题:已修(commit)或落入下方 backlog,无静默遗漏。
- [x] 计划勾选更新；涉及行为变化的 feature 卡 `last verified` 已由 #33/#34 更新。
- [ ] CI：收口分支 checks 全绿——等 PR 开启触发 `test.yml` 后复核（本地已等价执行三个 job 全绿）。
- [x] 报告注明 Windows NSIS / NPM_TOKEN 诚实阻塞。

## 七、审查发现（S2 输出，独立复审结论）

**质疑后不成立（无需改码）:**

- **R1（keybindings 守卫）**: 疑 `isEditableKeyboardTarget` / `isTextEntryTarget` 对非 Element target `closest` 会 throw —— 复核代码已有 `target instanceof HTMLElement` 守卫，不成立。
- **R2（guard 非 Error throw）**: 疑 `git-ipc-guard` 对字符串/undefined throw 产出 `message: 'undefined'` —— 复核 `gitIpcFailure` 已按 `error instanceof Error && message.trim()` 判定并落 fallback 文案，不成立。
- **R3（flush 并发交错）**: 推演 `FileSaveCoordinator.flush` 的 `while (inFlight) await` + 同步 `clearTimer→persistLatest`：JS 单线程下检查与启动之间无让出点，不会交错写。两个并发 flush 最坏情况是对同一 revision 冗余写一次（内容相同、`onConfirmed` 幂等），无数据丢失，可接受。
- **R4（ui-git 双重 catch）**: 桌面侧 guard 已保证 `shell:git-*` 不 reject，vendor `ui-git` 的 `.catch` 看似不可达 —— 但 vendor 包可运行于非桌面 host，双保险保留合理。

**成立项的处置:**

- **F3（git-titlebar）→ 已由 #34 追加提交解决**：`gitBranchList` 对 `safeRefName` 拒绝的名字标 `switchable: false`，picker 禁用该行并给 `branch.unsupportedName` 提示——白名单保持从严，失败不再不透明（commit 8c9aec99）。
- **F4（surfaces-work-loops）**: Files 搜索每键 `git check-ignore` 串行风暴（原 plan P4）不在 #33 范围内，维持原 plan 条目为 backlog。
- **F5（build-release）→ 代码已落地**：#34 追加 `killProcessTree`（win32 `taskkill /T /F` + POSIX 回退，带 spawn 测试 seam，`git-exec.test.js` 覆盖）（commit 54bc1e6b）；真实 Windows 行为仍待合并后 Windows CI/实机确认。

审查期间 #34 又推送 3 个提交（后台 status/fetch/PR 刷新 reject 捕获、白名单行禁用、Windows 进程树 kill），已二次合入本收口分支并复跑桌面 `npm test`（980 pass）与 `ui-git` 全套（125 pass）。本分支自身**未需要新增修复代码**：独立复审未发现上述之外的生产缺陷。

## Backlog（诚实遗留，不阻塞合并）

1. TC-EXT-007 Windows NSIS 实测（等 Windows artifact）。
2. `NPM_TOKEN` 配置后打首个 `dshbot-v*` tag。
3. `ui-preview` 预存 tsc 错误、translation-pairing 漂移（单独立项）。
4. F3 `safeRefName` 字符集放宽评估。
5. Files 搜索性能悬崖（P4，见 2026-08-25-surfaces-terminal-hardening 计划）。
6. F5 Windows 进程树 kill 验证。
