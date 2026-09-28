# 启动器审计整改报告（F1–F10）

**日期**: 2026-09-28  
**基线**: Deepseek-Harness-Desktop / main / 81a41107d16 + 脏工作树  
**审计报告**: [2026-09-28-launcher-audit/REPORT.md](../2026-09-28-launcher-audit/REPORT.md)  
**规划**: ChatGPT `STATE: PLAN` for `c2c_plan1`（4-lane: Storage / Lifecycle / Installer / Renderer）  
**决策**: [2026-09-28-import-transaction-and-launcher-remediation](../../../decisions/implemented/bug-fix/2026-09-28-import-transaction-and-launcher-remediation.md)

---

## 整改台账

| # | 级别 | 问题 | 修复 | 文件 | 验证 |
|---|------|------|------|------|------|
| F1 | P1 | 附件 `overwrite=false` 删除目标独有文件 | `mergeDirJournaled`：dest 拷入 staging + source overlay，dest-only 恒保留 | `src/main/data-import.js`, `import-transaction.js` | 故障注入 3 场景 PASS |
| F2 | P1 | 替换非崩溃安全，恢复删唯一副本 | journaled 三段式（staged→replacing→committed）+ reconciler；无 journal staging 保留并 `blocked` | `src/main/import-transaction.js`, `data-import.js` | `import-transaction.test.js` 8 项；注入 rename-fail 保留 dest |
| F3 | P1 | 导入无保护静止，slim 无 stop | 整段 `coordinate('stop',{preConfirmed,commit})` 内执行 stop+import；start/skipped/retryFullPlugins 导入期 `import-in-progress`；slim 非空 `slim-import-unsupported`；journal `blocked` 拒新导入 | `src/launcher/launcher-service.js` | ipc.test.js 65 项；空选择不占锁不停内核 |
| F4 | P2 | 同名技能跨根静默替换 | 扫描标 `sourceCollision`，导入前按 destName 分组，多源 → `failed/ambiguous-destination` 零写入 | `src/main/data-import.js` | 注入检查 PASS |
| F5 | P2 | slim 恢复不清粘性 skip | `retryFullPluginsSlim`：停→严格读 config→重置 `pluginRecovery` 保留其余→原子写→验证→启动 | `src/launcher/launcher-service.js` | 代码路径实现（外部桌面未实机） |
| F6 | P2 | 安装完成不绑定版本 | `waitForInstall(...,targetVersion)` 要求注册表版本=请求版本；删除 same-version 捷径 | `src/launcher/runtime-install.js` | runtime-install.test.js 24 项（mock 层） |
| F7 | P2 | 附件失败不计 ok | `importSessions().ok` 检查 `attachments` 非 `failed:*`；摘要加 `共 N 项失败` | `src/main/data-import.js`, `launcher.js` | 注入检查 PASS |
| F8 | P2 | IPC 拒绝无终端诊断 | `catch`/`finally`+`importOpSeq`+`cancelImport` catch+bridge 缺失文案+`aria-live` | `src/renderer/launcher.js`, `launcher.html` | 代码 + render 测试 15 项 |
| F9 | P2 | 未定义 `--dsw-alias-layer-fill-2` | → `--dsw-alias-bg-layer-2`（确认卡 295、路由弹层 1185） | `src/renderer/launcher.css` | theme 测试 + 源代码确认 |
| F10 | P2 | tab/radio 键盘语义不全 | 主导航/导入类 roving tabindex+方向键+Home/End+Enter/Space；tab↔panel `aria-controls`/`labelledby` 全关联；`route-seg`/`route-picker` `role=radio`/`aria-checked`/方向键跳禁用 | `launcher.html`, `launcher.js` | render 测试；键盘行为手写实现 |

## UI/排版整改

| 元素 | 原 | 新 | 状态 |
|------|-----|-----|------|
| `.import-scope-detail summary/p` | 16px 继承 | `12px/18px` | 修复 |
| `.import-toolbar` | 16px 继承 | `12px/18px` | 修复 |
| `.import-foot-opts` | 16px 继承 | `12px/18px` | 修复 |
| `.import-foot-run` | 16px 继承 | `12px/18px` | 修复 |
| `.row-title`（导入行标题） | 无溢出保护 | `ellipsis` | 修复 |
| `--dsw-alias-layer-fill-2` | 未定义 | → `--dsw-alias-bg-layer-2` | 修复 |

`.line-chip`/`.line-chip-btn` 已为 12px（`.line-chip` 容器设定，`btn` 用 `font: inherit`）——审计标记为过大实为继承链正确，无需改。确认卡 `alertdialog` 焦点/Escape/Tab 循环 GPT 复核确认原已实现，予以保留。

## 验证记录

| 命令 | 结果 |
|------|------|
| `node --test src/main/data-import.test.js src/main/import-transaction.test.js` | 38/38 PASS |
| `node --test src/main/ipc.test.js`（含新增空选择测试） | 65/65 PASS |
| `node --test src/launcher/runtime-install.test.js src/launcher/install-detect.test.js` | 28/28 PASS |
| `node --test src/renderer/launcher-theme.test.js src/renderer/launcher-render.test.js` | 15/15 PASS |
| `node .tmp-qa/c2c_plan1/verify-fixes.cjs`（故障注入） | 16/16 PASS |
| 全量 `node --test`（src/{main,renderer,launcher,shared,main-launcher,preload,host}） | 1884 PASS / 7 FAIL（全部为 vendor tree 预存在：`assertDesktopForks`、`post-merge UI features`、surfaces-track ×4、ui-layout） |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 7/8 PASS；`verify-doc-budgets` 报 `docs/design-language.md` 超 51 词（工作树**预存在**溢出，非本批新增） |

## 未决项 / 风险

1. **F6 实机验证**：真实 Windows 安装包完成/取消/UAC 拒绝需一次性环境，未执行（GPT 计划要求标记 BLOCKED/NOT RUN）。
2. **UI 截图复核**：6 页 × 2 视口 × 明暗 + 125/150/200% 缩放未重跑（本地 harness 已停）；键盘路径为手写实现，建议人工过一遍。
3. **`blocked` journal UX**：未决事务目前只在 `runImportTask` 返回 `import-recovery-blocked`；渲染层未加专门 UI 提示（结果显示错误文本）。若用户数据真的卡在 pending，需要指导手动检查 `.import-tmp`/`.import-bak`。
4. **`reconcileImportTransactionsSync` 递归目录**：当前遍历整个 `destHome` 找 txn 文件；极端深层树可能慢，但规模受限于桌面 home。

## ChatGPT 验收

已发送 `EXECUTED`（iteration 1）。GPT 独立验收返回 **`CHANGES_REQUIRED`**（3×P1 + 5×P2，R1–R8）与未闭合验证门；第 2 轮已完成 R1–R8 修复并回执 `EXECUTED`（iteration 2）；GPT 复审再次 **`CHANGES_REQUIRED`**（R1–R8 逐行收口要求），第 3 轮已按复审表完成全部收口并回执 `EXECUTED`（iteration 3），待最终验收。

### Iteration 2 追加修复（GPT 审查 R1–R8）

| 编号 | 修复 |
|------|------|
| R1 | `needsRecovery` 跨阶段传播（结构化标记，非扁平字符串）；`runImport` 检出即中止剩余阶段并写 `phase:'blocked'`（绝不写 `done`）；`recoverInterruptedImport` 处理 `blocked` journal 且 pending 未清时持续 `recovered:false`；扫描覆盖 `.agent-presets` 隐藏目录；冷启动门经 `readImportJournal` 独立检查持久 `blocked`（含直接启动路径与恢复异常 fail-closed）。 |
| R2 | 新增 `txnPathsOwned` 信任边界——恢复重命名/删除前校验 journal opId↔文件名一致、`dest`/`tmp`/`bak` 绑定同父目录且在 sweep root；untrusted journal 记 `untrusted-journal` 保留不跟随；`commitStagedDir` 拒 staging/dest 重叠；`overlayDir` 先移除 staged dest 已有 symlink/junction 再覆盖。 |
| R3 | import commit 改用 controller 级 `harness.stopDesktop()`（取消恢复定时器、作废 pending op、drain pending restart）+ `stopDesktopCleanup()`，替代裸 `stopKernelIfRunning()`；`coordinate` 前拒绝 `protection.isCommitted()` 的已提交 shutdown 与已取消信号；`disablePlugins`/`disablePlugin`/`enablePlugin`/`removePluginOp` 在 `importAbort` 占用期间返回 `import-in-progress`。 |
| R4 | `installRuntime` 冻结 `targetVersion`（优先 `info.tag` 去 `v` 前缀，保留 prerelease 身份）；`waitForInstall` 移除「空目标接受任意变化版本」fallback（空目标 fail-closed）；同版本请求要求 exe mtime > baseline stamp（或 baseline 无 exe 时新 exe 出现）。 |
| R5 | `runImport` 在任何写入前对 `selectedSkillIds` 按 canonical destName（Windows 大小写等价）分组，多源同目标直接 `ok:false`+`ambiguous-destination`，sessions/attachments 均零写；UI 对 `sourceCollision` 技能行显示同名冲突徽标+冲突来源。 |
| R6 | `retryFullPluginsSlim` 复用单操作槽 `importAbort` 覆盖 stop→config→launch 全程，并发 retry/retry、retry/Start、retry/import 互斥拒绝。 |
| R7 | 选择计数移出 `#import-result` 至 `#import-selection-line`（终态摘要不再被 rescan/选择变化覆盖）；`summarizeImport` 渲染 `result.error` 可操作文案 + `credentials` 计入 `totalFailed` + item 级错误明细（上限 8 条）；progress 事件带 `op`（renderer 生成 `opId` 经 `options.opId` 传入回显），handler 丢弃非当前 op 迟到事件；`cancelImport` rejection 显示可行动文案。 |
| R8 | `route-picker`/`route-seg` `keydown` 经 `dataset.navBound` 只绑一次（不再随 innerHTML 重渲染累积）；方向键同步 focus+selection+save（radio 语义）跳禁用项；重渲染按稳定 route id 恢复焦点；`<ul role="tabpanel">` 恢复原生 list——改在外层 `.import-sub-pane` `div[role=tabpanel]` 承载 `aria-labelledby`/`tabindex`，ul 保留原 id 供 list renderer。 |

### Iteration 2 验证

| 命令 | 结果 |
|------|------|
| `node --test`（data-import + import-transaction + ipc + runtime-install + launcher-theme + launcher-render + launcher-gate + launcher-service + task-protection + harness-controller + launcher-behavior + launcher） | 242/242 PASS |
| `.tmp-qa/c2c_plan1/verify-fixes-iter2.cjs`（needsRecovery 阻断持久、untrusted journal 不跟随、ambiguous 预检零写、preset 恢复、双次启动） | 16/16 PASS |
| 全量 `npm test` | 2569 PASS / 1 FAIL（`assertDesktopForks` vendor pin 校验失败——vendor 树被并行任务改动，非本批） |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 7/8 PASS（`verify-translation-pairing` 因 `docs/design-language` 预存在 drift；`verify-doc-budgets` 本轮通过） |

### 仍开放门槛（如实标记，未验收）

- **真实 Windows 安装器**：完成/UAC 拒绝/early-exit/同版本歧义 **BLOCKED/NOT RUN**（mock 层覆盖，无真实环境）。
- **UI 矩阵**：6 页 × 2 视口 × 明暗 + 125%/150%/200% 缩放未运行（需 Electron UI harness，源文本正则测试不足以闭合 F8–F10）。
- `check:release-version` / `pack:launcher`：本轮未执行。
- `doc-sync`：**8/8 通过**（`docs/design-language` 预存在 drift 由并行任务先行收敛，`verify-translation-pairing` 与 `verify-doc-budgets` 均恢复；本批 decision 记录配对已 `verify-translation-pairing --write` 重录）。
- 测试属确定性 fault-injection + 单测；未做真实进程崩溃断电耐久、真实安装器、UI 真机矩阵。

### Iteration 3 收口修复（GPT 复审 R1–R8）

| 编号 | 修复 |
|------|------|
| R1 | `verify-fixes-iter2.cjs` 的 `placeholder-pass` 换为真实 rename+restore 双失败注入：dest→bak 成功、staging→dest 与 bak→dest 均抛错，断言 `needsRecovery`、skills 阶段被 `recoverySoFar` 跳过、journal 写 `blocked`+`blockedReason`（非 `done`）。 |
| R2 | `txnJournalOwnsPath` 增加「journal 文件必须物理位于 dest 同父目录」；tmp/bak 由 `startsWith` 收紧为 `tmpName/bakName(dest,opId)` 精确相等；`recoverImportTransactions`（async）与 `reconcileImportTransactionsSync`（sync）共用 `decideTxnResolution` 决策表（新增 export + 对齐单测）；`committed` 分支先验 dest 存在才删 `bak`，dest 丢失则 `bak->dest` 恢复最后副本，`all-copies-missing` 记 pending。 |
| R3 | 新增 `blockedStartError()` 准入闸门：`startOp`/`startSkippedOp`/`retryFullPlugins`/`installRuntime`/`installRelease`/`installUpdate` 在进入前查 `readImportJournal(...).phase==='blocked'`（不可读 fail-closed）；`index.js` 的 `startDesktopFromLauncher`（启动器/菜单/托盘/冷启动 auto-start 共同入口）同样查 blocked journal 并路由 import tab + `desktop-failed`；`stopDesktopCleanup` 调用点改 `await`。 |
| R4 | `normalizeVersionString` 双向归一 baseline 与 observed（注册表 `v1.2.3` vs tag `1.2.3` 不再误判）；`targetVersion` 在 `installFromAsset` **调用前**冻结；同版本成功判据改为「baseline 未注册→新注册」或「exe stamp 推进」二选一，时间戳单独不再构成完成证据。 |
| R5 | skills 循环在 `copyDirAtomic` 前对 live dest 做 `fs.existsSync` 复查（scan-time conflict 判定是过期读）；扫描后出现的目标目录在 `!overwrite` 下跳过而非静默覆盖。 |
| R6 | `return await runtimeInstall.startExternalDesktop()` 持槽至 spawn 落定；`importAbortKind` 区分 `'import'`/`'retry'`；`installRuntime`/`installRelease`/`installUpdate` 在 `importAbort` 占用期间拒绝，与导入互斥。 |
| R7 | `cancelImport` 在非 `'import'` 槽或 `currentImportOpId` 不匹配时拒绝，无 opId 请求不能取消已标识操作；renderer `cancelImport({opId})` 经 `shell:cancel-import` 下传；`summarizeImport` item 明细补 `credentials` 键。 |
| R8 | `#route-picker`/`#route-seg` 补 `focusin` roving tabindex（仅当前项 `tabindex=0`，tab 停留点随方向键移动）；`pickRoute` 去重只比对 `lastIssuedRoute`（Right→Left 在 refresh 前不丢第二次保存）；`issueRouteSave`/`radioNextIndex` 导出，`launcher-behavior.test.js` 新增序列化保存、错误只报最新一次、双组 `navBound`、import tabpanel `aria-controls` 契约测试。 |

### Iteration 3 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套，含新增 launcher-behavior/import-transaction 新用例） | 242/242 PASS |
| `node --test src/main/import-transaction.test.js`（含 committed-dest-check、物理绑定、async/sync 对齐 4 新用例） | 16/16 PASS |
| `node .tmp-qa/c2c_plan1/verify-fixes-iter2.cjs`（R1a 真实故障注入 + 全部 iter2 项） | 20/20 PASS |
| `node scripts/verify-translation-pairing.mjs --write`（本批 decision 记录） | recorded |
| `npm test`（全量 2591） | 2590 PASS / 1 FAIL（`assertDesktopForks` vendor pin 校验失败——vendor 树被并行任务改动 `MenuView.tsx`，非本批） |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS（`verify-translation-pairing` 与 `verify-doc-budgets` 本轮均通过——`docs/design-language` drift 由并行任务先行收敛） |

### Iteration 4 收口修复（GPT 复审 R1–R8 剩余项）

GPT 第三轮验收 R5 闭合、R1/R2 进入 PARTIAL、R3/R4/R6/R7/R8 仍有缺口，要求把「单向 import-only 排除」升级为「任一方向皆互斥的共享维护槽」，并把所有启动/写入面接入同一准入。

| 编号 | 修复 |
|------|------|
| R1 | `readImportJournal` 区分「不存在（ENOENT→`null`）」与「不可读/损坏（→`{unreadable:true}`）」，新增 `journalIsBlocked`（`phase==='blocked'` 或 `unreadable`）供 service/index/launcher-gate 三处共用作准入判据；附件导入也以 `sessionsNeedRecovery` 闸控；sweep 目录读失败由「跳过」改为「记 pending」。 |
| R2 | `txnPathsOwned` 增加 `canonicalParentChain`/`isInsideCanonical`/`parentChainIsLinkFree`：journal `dest` 必须落在规范化父链内且父链无符号链接/junction，杜绝经链接逃逸 sweep root 的信任边界绕过；`commitStagedDir` 外层 catch 的 journal 写入加护栏（写入失败不再二次抛）；reconciler 接受 `allowedOpIds`（importer 注册的 opId 清单），未注册的 journal 记 `unregistered-journal` pending 而不跟随。 |
| R3 | `shell:restart`（`restartWithCleanup`）在 `taskProtection.coordinate` 前先查 `importGuard.isMaintenanceHeld()`，维护中直接返回 `code:'maintenance-in-progress'`（不弹覆盖确认框）；`cleanupDesktopResources` 由 fire-and-forget（`void Promise.resolve(preview.closeAll())`）改为返回 Promise，restart/reload/quit 三处 commit 全部 `await`，不再让 BrowserView 拆除中推进重启；`shell:save-config`（`applyRendererConfigPatch`）、`shell:saveLauncherConfig`、`profile-ops` 的 `disablePlugins`/`enablePlugin`/`removePlugin` 全部接入 `importGuard`/`journalIsBlocked` 准入。 |
| R4 | `waitForInstall` 开头对已 `aborted` 的 signal 立即返回 `'aborted'`（不再空转到超时）；同版本已注册分支在「stamp 未推进且 installer 子进程已退出」时立即 settle 为 `waiting`（`finish(null)`），不再把已死安装器的时间戳残留当作完成证据轮询满超时。 |
| R6 | 新建 `src/main/import-guard.js` 共享维护槽模块（`acquireMaintenance`/`releaseMaintenance`/`isMaintenanceHeld`/`maintenanceOwner`/`assertMaintenanceFree`，单例 owner token）；`runImportTask`/`installRuntimeOp`/`installUpdateOp`/`installReleaseOp`/`startOp`/`startSkippedOp`/`retryFullPlugins` 全部 `acquireMaintenanceSlot('import'|'install'|'start'|'retry')` 并在 `finally` 释放——install/start 不再只「CHECK」import 槽而是真正 ACQUIRE，达到任意到达顺序的双向互斥。 |
| R7 | renderer `cancelImport` 在 `await` 前把 `activeImportOpId` 快照为 `cancellingOpId`（不再读可能在 await 间被 run 处理器清空的共享变量），并识别 resolved `{ok:false}` 拒绝（错误归属/已完成/非导入占用）照常提示；`onImportProgress` 过滤器由「有 op 且不匹配才丢」收紧为「`payload.op` 必须是当前活动 opId」——无 `op` 字段的事件同属未归属，一并拒绝，杜绝无关发射器覆盖终态。 |
| R8 | `issueRouteSave` 失败时把 `lastIssuedRoute` 重置回 `selectedRoute()`（不再指向未持久化的值，同路由重试不再被去重吞掉）并返回布尔；`pickDownloadRoute`（radio 与 popup 共用）改经同一 `issueRouteSave`/`routeSaveGen` 代际，保存成功才触发 `afterSave`——两条控制路径共享标记与代际，消除 popup↔radio 交错保序分歧。 |

新增 `src/main/import-guard.test.js`（3 用例：槽互斥/陈旧 token 不丢所有权/profile 写入拒绝）与 `launcher-behavior.test.js` 的「失败保存重置标记可重试」回归。

### Iteration 4 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套：data-import + import-transaction + import-guard + launcher-gate + launcher-behavior + ipc + task-protection） | 150/150 PASS |
| `node --test`（runtime-install + install-detect + launcher-confirm） | 35/35 PASS |
| `node --test src/main/import-guard.test.js src/renderer/launcher-behavior.test.js` | 13/13 PASS |
| `npm test`（全量 2595） | 2592 PASS / 1 FAIL（`assertDesktopForks` vendor pin 校验失败——vendor `MenuView.tsx` 被并行任务改动，非本批） / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |

### Iteration 5 收口修复（GPT 复审——owner-aware delegation + write-ahead inventory + 真实谓词导出）

GPT 第四轮验收 R5 闭合、R6 服务层双向 acquire 已实现但集成暴露「自我拒绝」回归，R1/R2/R3/R4/R7/R8 仍有阻断。核心是两点：`journalIsBlocked` 定义了却未导出（fallback 忽略 unreadable）、共享槽在嵌套 restart 时拒绝了自己的 owner。

| 编号 | 修复 |
|------|------|
| R1 | `journalIsBlocked` 加入 `data-import.js` `module.exports`（此前定义未导出，service/index 走兼容性 fallback 只查 `phase==='blocked'`、忽略 `unreadable:true`）；service/index 去除 fallback 直调真谓词；`launcher-gate` 经注入 `journalIsBlocked` 用同一谓词；`recoverInterruptedImport` 调整顺序——先判 `unreadable` 与 journal shape（缺 `phase`/`destHome` 的合法 JSON 也 fail-closed `blocked:true`）再比 `destHome`，不再让无 `destHome` 的不可读 journal 提前返回漏过阻断。 |
| R2 | `replaceDirJournaled`/`commitStagedDir` 加 `parentChainIsLinkFree(destParent)`——dest 父链任一组件是 junction/symlink 即拒写（`unsafe-destination-link`），写入不再经别名逃逸到 home 外或只读 source；opId 改 **write-ahead 注册**（`copyDirAtomic`/`mergeDirJournaled` 在事务前 `nextOpId()`+`registerTxnId`，崩溃时 journal 已可归属）；blocked journal 重写保留 `txnIds`；`allowedOpIds` 空 Set=零授权（原 `size>0` 才过滤改为「传了 Set 就只认 Set 内」），仅当 journal 实际带 `txnIds` 字段才构造 Set（旧格式无字段走信任边界）；async `recoverImportTransactions` 同步接 `allowedOpIds`。 |
| R3/R6 | **owner-aware delegation**：`importGuard` 加 `holdsMaintenance(token)`——只有当前 owner token 本身放行；`restartWithCleanup(delegatedToken)` 同 owner 委托放行、异 caller 拒绝；`startDesktopFromLauncher` 把 `options.maintenanceToken` 透传给 `restartWithCleanup`；service `startOp`/`startSkippedOp`/`retryFullPlugins` 把各自 `guard` token 经 `startDesktop` options 传入——合法嵌套 forced restart 不再自我拒绝，异 caller 仍拒；`shell:restart` handler（`recordBootRestart`→`harness.retryFullPlugins`，绕过 service 槽）前置 `importGuard.isMaintenanceHeld()`；`removePluginOp` 由 CHECK 改 ACQUIRE 持 token 贯穿 uninstall；`profile-ops` `disablePlugins`/`enablePlugin`/`applyRendererConfigPatch` ACQUIRE 并经 `holdThrough` 持 token 到 deferred align 落定；import 的 `preConfirmed:true` 移除（恢复正常 protected-import decision，stop 按钮的显式同意豁免仍保留）。 |
| R4 | 空 `targetVersion` 在 `installFromAsset` 前拒绝（`unbound-target-version`，零 installer 调用）；捕获 installer child 生命周期（`code`+`failed`）；撤回「初生子进程退→waiting」早退（NSIS 提升允许初生 child 先退，不能据此判安装死了）；同版本分支改为「stamp 前进 AND child 未报失败」，被失败 installer 触碰的时间戳不再判成功。 |
| R7 | renderer `cancelImport` 两个响应分支（resolved `{ok:false}` 与 rejected）写 `#import-result` 前都过 `stillOwns()`——captured `cancellingOpId` 仍是当前活动 op 且 run 仍在飞才写，A 的迟到 cancel 不再覆盖 A 的终态或 B 的进行中状态。 |
| R8 | `issueRouteSave` 识别 resolved `{ok:false}`（如 `maintenance-in-progress`）按失败处理——重置 `lastIssuedRoute`+返回 `false`（原只 catch 异常，resolved 拒绝被当成功导致重试被吞）；`pickDownloadRoute` 去掉 `routeId===current` 早退（pending save 期间 current 是旧渲染值，回到该值会丢最新意图），radio/popup 统一只按 `lastIssuedRoute` dedup。 |

新增/扩充回归：`import-transaction.test.js`（空 inventory 零授权、payload txn 在显式 inventory 下不执行、junction dest 父链拒写）、`runtime-install.test.js`（同版本+stamp 前进+installer 失败不判成功、空 target 零 installer 调用）、`import-guard.test.js`（`holdsMaintenance` 区分 live owner/foreign/kind-string/stale token、profile ACQUIRE+release）、`launcher-behavior.test.js`（resolved `{ok:false}` 拒绝按失败+重试持久）、`ipc.test.js`（start/retry 的 `maintenanceToken` 委托断言）。

### Iteration 5 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套：data-import + import-transaction + import-guard + launcher-gate + launcher-behavior + runtime-install + install-detect + launcher-confirm + ipc + task-protection + harness-controller） | 255/255 PASS |
| `node --test`（runtime-install 单文件含 2 新用例） | 26/26 PASS |
| `node --test`（import-transaction + import-guard + launcher-behavior 含 6 新用例） | 35/35 PASS |
| `npm test`（全量 2603） | 2600 PASS / 1 FAIL（`assertDesktopForks` vendor pin——并行任务 `MenuView.tsx` 改动，非本批） / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `git diff --check` | clean |

### Iteration 6 收口修复（GPT 复审——fail-closed 形状校验 + 嵌套 owner 透传 + slot 泄漏封堵 + 测试 stub 补全）

GPT 第五轮验收 R5 闭合、R7 实现层闭合、R8 两处缺陷已修（仍待绑定 handler 行为测试）。本轮聚焦 R1 journal 形状盲区、R2 注册吞错与父链检查时序、R3/R6 嵌套 restart 自我拒绝与同步段 slot 泄漏、R4 同版本未确认仍报成功。

| 编号 | 修复 |
|------|------|
| R1 | `readImportJournal` 新增 `isUsableJournalShape`：`null`/`[]`/`{}`/不合规 JSON 不再返回 `null` 或裸对象，一律归一化为 `{unreadable:true,invalid:true}`——`journalIsBlocked` 因此对「合法 JSON 但非 journal 形状」也能 fail-closed，修复此前 `null` 形状检查永远走不到的盲区。 |
| R2 | (A) `registerTxnId` 由「失败吞掉」改为 REQUIRED（抛错）：`copyDirAtomic`/`mergeDirJournaled` 把注册失败包装成「零落盘的拒绝」而非继续裸写；初始 journal 带 `txnIds:[]`，blocked 重写保留 `txnIds`。(B) `mergeDirJournaled` 在 staging **之前**先做 `parentChainIsLinkFree(destParent)`——staging 不再先于边界检查发生；`parentChainIsLinkFree` 从 `import-transaction` 导出复用。 |
| R3/R6 | (A) `alignHarnessAfterProfileChange(startHarness, downError, ownerToken)` 把 ownerToken 透传给 `startHarness(ownerToken)`（= `restartWithCleanup`）——嵌套 restart 被识别为同 owner 委托放行，不再自拒后谎报 `harnessRestarted:true`；resolved `{proceeded:false}` 计为失败。(B) `disablePlugins`/`enablePlugin`/`applyRendererConfigPatch`/`startOp`/`startSkippedOp`/`retryFullPlugins` 在 ACQUIRE 后的同步段用 `transferred` 标志 + try/catch——同步异常不再泄漏 slot。(C) 非 launcher 的 `shell:retry-full-plugins` 走 `recordBootRestart`：`ipc.js` 接 `importGuard.isMaintenanceHeld()` + `journalIsBlocked(readImportJournal)` 准入返回 `{ok:false}`；`shell:restart` 与 `shell:retry-full-plugins` 都传播该拒绝；`restartWithCleanup` 同步接入 blocked journal 检查。 |
| R4 | `childDone.failed` 由初始 `false` 改为同版本已注册分支 `settled=false` 恒等（未确认→超时按 waiting 计）；installer 生命周期在 `onInstallerLaunch` 时即捕获进 `installerChildDone` 传给 `waitForInstall`（不再在 waitForInstall 内部捕获而漏掉早期事件）。 |
| 测试 stub | `ipc.test.js` 的 `stub('./data-import')` 补上 `readImportJournal`/`journalIsBlocked` 导出——缺省导出会让 `recordBootRestart` 的 try/catch 抛 TypeError 被静默吞成 `{ok:false}`，导致 boot restart 测试拿不到 snapshot；stub 缺省返回「无 journal」，blocked 路径可被 `options.readImportJournal` 覆盖。 |

新增回归：`ipc.test.js` 维护期 `shell:restart`/`shell:retry-full-plugins` 拒绝断言、`import-transaction.test.js` mergeDir 先父链后 staging、`profile-ops` 同步段异常不泄漏 slot。

### Iteration 6 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套：data-import + import-transaction + import-guard + launcher-gate + launcher-behavior + runtime-install + install-detect + launcher-confirm + ipc + task-protection + harness-controller） | 158/158 PASS |
| `node --test src/main/ipc.test.js`（含 recordBootRestart 准入 2 新用例） | 65/65 PASS |
| `npm test`（全量 2603） | 2601 PASS / 0 FAIL / 2 skipped（vendor pin 校验本轮通过——并行任务 `MenuView.tsx` 收敛后不再触发） |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `git diff --check` | clean |

### Iteration 7 收口修复（GPT 复审——完整 journal 校验 + 零授权 legacy + 入口真正 acquire）

GPT 第六轮验收 R4 同版本误报、R3/R6 profile 委托与同步异常已闭合；剩三块：R1 共享校验不完整（`{"phase":"copying"}` 无 destHome 仍被当合法）、R2 无 `txnIds` 字段的 legacy journal 仍授权发现的 sidecar、R3/R6 独立 restart 只查不 acquire。第 7 轮收口：

| 编号 | 修复 |
|------|------|
| R1 | `isUsableJournalShape` 升级为完整契约校验：object 非数组 + `phase` ∈ `{copying,blocked,recovered,done}` + `destHome` 非空 string + `txnIds`（存在时）必须为 string 数组。`recoverInterruptedImport` 移除重复 shape 判断——recovery 与手动准入（`journalIsBlocked`）消费同一 reader verdict，缺 destHome/非法 phase/畸形 inventory 一律 fail-closed。 |
| R2 | (A) 无 `txnIds` 字段的 legacy journal 授权集合改永远为空 Set——字段缺失=零授权，payload 投放的 sidecar 记 `unregistered-journal` 保留不执行。(B) 新增 `txnDests` opId→dest 绑定：`registerTxnId(journalFile, opId, dest)` 写入映射，两个 reconciler 接受 `allowedTxnDests`——已注册 opId 出现在错误 dest 记 `unbound-destination`；blocked/done journal 重写保留 `txnDests`。(C) `isLinkLike` 仅 ENOENT 判非链接，其余检查错误（EACCES/EIO）fail-closed 判 link-like；`canonicalParentChain` 仅 ENOENT 继续上溯，其余错误返回 null——检查失败不再被重构成 lexical 路径当安全。 |
| R3/R6 | `recordBootRestart` 由「只查 isMaintenanceHeld」改为 `acquireMaintenance('boot-restart')` + finally release——pending 期间竞争者被拒（反向时序排除闭合）；acquired token 经 `startHarness(acquired)` 委托给嵌套 `restartWithCleanup` 不被自拒。`restartWithCleanup` 无 delegated owner 时自行 `acquireMaintenance('restart')` 并在 operation settle 后 release。`startDesktopFromLauncher` 非 forceRestart 路径（`harness.start()`）同样 acquire 'start'；外来持有时 refuse。`profile-ops` 新增 `configureProfileOps({journalBlocked})`——`acquireMaintenance` 在写配置前先判 blocked journal（index.js 注入 `readImportJournal`+`journalIsBlocked`），`acquireRefusalReason()` 区分 `import-recovery-blocked`/`maintenance-in-progress`。 |

新增回归：`data-import.test.js`（缺 destHome/非法 phase/畸形 inventory 三形态 admission+recovery 一致拒绝、valid/missing 对照、field-less legacy journal 保留 payload sidecar、已注册 opId 错误 dest 拒执行）、`ipc.test.js`（boot restart pending 持槽竞争者被拒 + 外来持有时 refuse 且不写 marker）、既有 `recovery reconciles a journaled interrupted session copy` 改为注册 opId+dest 绑定的合法 inventory 场景。

### Iteration 7 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套：data-import + import-transaction + import-guard + profile-ops + launcher-service + launcher-gate + launcher-behavior + runtime-install + install-detect + launcher-confirm + index + ipc + ipc-launcher） | 164/164 PASS |
| `npm test`（全量 2609） | 2607 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功（`dist-launcher/win-unpacked`） |
| `npm run check:release-version` | NOT RUN（需要 release tag 参数——设计为发布期 gate，非独立可跑） |
| `git diff --check` | clean |

### Iteration 8 收口修复（GPT 复审——dest binding 必需 + overlay 检查错误中止 + reload/removal 准入）

GPT 第七轮验收 R1 校验、独立 start/restart acquire 已闭合。剩三处：R2-A `txnDests` 缺失仍隐含授权、R2-B overlay 检查错误被当 symlink 重演 F1、R3 reload-to-start 与 plugin removal 绕过 blocked journal。第 8 轮收口：

| 编号 | 修复 |
|------|------|
| R2-A | destination 绑定改强制（inventory 模式下）：`allowedOpIds` 为 Set 时，opId 必须有合法 `txnDests[opId]` 字符串绑定且与 journal.dest 匹配——无 map/空 map/缺 key/非 string/不匹配一律 `unbound-destination` 保留不执行；ID-only 旧 inventory（有 txnIds 无 txnDests）不再隐含授权。`isUsableJournalShape` 同步校验 `txnDests` 形状（存在时必须是 object→string 映射）。无 inventory 的裸 reconciler 调用维持 trust-boundary。 |
| R2-B | `isLinkLike` 重构为 `classifyLink(p)` 四态（`link`/`clean`/`missing`/`error`）：`isLinkLike`/`parentChainIsLinkFree` 对 `error` fail-closed（仅 `clean`/`missing` 放行）；`overlayDir` 对 `error` throw `overlay-inspection-failed` 中止 staging——检查错误不再被解读成可删除链接，dest-only 数据在 aborted merge 中字节级保留，`link` 仍按 overwrite 删后重拷。 |
| R3 | `reloadWithCleanup` 区分真 reload 与会 start 内核：`willStartKernel`（win 存在且 kernel 非 ready，同 controller 判定）时先判 `isMaintenanceHeld`+`journalIsBlocked`，再 `acquireMaintenance('reload-start')`+finally release——blocked journal 下菜单 Reload 不再绕过 start 准入；kernel ready 的纯 `showHarness` reload 无锁。`removePluginOp` 在首个副作用前调 `blockedStartError()`——blocked journal 下不 stop 内核、不 uninstall、不写 config。 |

新增回归：`data-import.test.js`（ID-only inventory/空 map/缺 key/非 string 绑定均 blocked+sidecar 保留）、`import-transaction.test.js`（overlay lstatSync EACCES → 中止且 dest-only/conflict 字节保留）、junction 测试改 `ctx.skip`（不支持的宿主不误报为 pass）、overlay 断言升级字节级 + 中止分支断言。

### Iteration 8 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套含新回归） | 255/255 PASS |
| `npm test`（全量 2618） | 2616 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功（`dist-launcher/win-unpacked`） |
| `npm run check:release-version` | DEFERRED（需真实 tag——发布期校验，非 remediation gate） |
| `git diff --check` | clean |

### Iteration 9 收口修复（GPT 复审——reload dispatch 拒绝传播 + 目录级 overlay + fixture 修正）

GPT 第八轮验收 no-context recovery API gap、reload unsafe-start、overlay 检查错误、junction ctx.skip 已闭合。剩一处 P2：dispatch-time reload 拒绝被 coordinator 吞掉（commit 返回值被丢弃，refusal resolve 成正常完成）。另有测试层修正。第 9 轮收口：

| 编号 | 修复 |
|------|------|
| R3 | `reloadWithCleanup` dispatch-time 拒绝传播：commit 内拒绝改写入局部 `dispatchRefusal` 变量，外层 `.then` 优先返回它——coordinator 丢弃 commit 返回值不再把 refusal resolve 成正常完成；entry-time 与 dispatch-time 拒绝形态一致（`{proceeded:false, code}`）。ready→idle 变更期间 foreign owner/blocked journal 都被拦下且不启动内核。 |
| 测试修正 | `reconcileImportTransactionsSync refuses opId that mismatches the filename` / `refuses a journal pointing outside the tree` 现在带显式 ownership（`allowedOpIds`+`allowedTxnDests`）让 binding 检查通过、落到意图验证的 `untrusted-journal` 分支——fixture 跟随更严 API 契约，非新生产缺陷。`overlayDir` 测试升级为目录级 staged dir（含 conflict+dest-only）+ 断言精确字节保留 + reject `overlay-inspection-failed`。 |

### Iteration 9 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套） | 255/255 PASS |
| `npm test`（全量 2618） | 2616 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功（`dist-launcher/win-unpacked`） |
| `npm run check:release-version` | DEFERRED（需真实 tag——GPT 确认应从无条件 gate 移除） |
| `git diff --check` | clean |

### Iteration 10 收口修复（GPT 复审——reload 可测 seam + fixture/生产路径补全）

GPT 第九轮验收：**生产代码缺陷全闭合**（reload refusal propagation 修复确认），剩余为验证/证据层。第 10 轮收口：

| 项 | 修复 |
|----|------|
| desktop-reload 可测 seam | 新建 `src/main/desktop-reload.js` 导出依赖注入的 `createReloadWithCleanup(deps)`——index.js 用真实 `getMainWindow`/`dsh`/`harness`/`taskProtection`/`importGuard`/`readImportJournal`/`journalIsBlocked`/`cleanupDesktopResources`/`getUserDataDir` 组合，test 用同一实现走 fixture（不复制函数、不导出 Electron 入口）。 |
| reload race 回归 | 新建 `src/main/desktop-reload.test.js`（4 用例，真 `createTaskProtection` 丢弃 commit 返回值的生产语义 + deferred cleanupGate）：ready→idle+foreign owner 零 start+`maintenance-in-progress` 拒绝+foreign owner 保留；ready→idle+blocked journal 零 start+`import-recovery-blocked`；ready 全程纯 view reload 无 start 无锁泄漏；idle+授权 start 持槽到 settle 后释放。 |
| fixture 修正 | `reconcileImportTransactionsSync refuses opId that mismatches the filename` 补 `allowedOpIds:{OTHER}+allowedTxnDests`——否则 fail-closed 撞 unregistered 而非意图验证的 `untrusted-journal`。 |
| production-path merge 回归 | `data-import.test.js` 新增 `importSessions`（importAttachments:true）注入 staged tmp 目录 lstatSync EACCES——merge 中止不发布，dest-only/conflict 精确字节保留。 |

### Iteration 10 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套含 desktop-reload 4 新用例） | 260/260 PASS |
| `node --test src/main/desktop-reload.test.js` | 4/4 PASS |
| `npm test`（全量 2623） | 2621 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功（`dist-launcher/win-unpacked`） |
| `git diff --check` | clean |

### Iteration 11 验证层推进（reload 完整回归 + fresh-process 事务中断/恢复）

GPT 第十轮验收确认 reload 抽取、filename fixture、附件生产路径、**无新增生产缺陷**。本轮把验证层往 DONE 推进：reload 回归补齐 decline/异常/延迟 controller 用例、附件注入收窄到 staged conflicting dir、新建 fresh-process 事务中断恢复测试。

| 项 | 内容 |
|----|------|
| reload 回归扩展 | `desktop-reload.test.js` 8 用例：coordinator decline（拒绝传播+无锁泄漏）、cleanup rejection（异常传播+锁释放）、controller rejection（异常传播+锁释放）、deferred-controller 所有权持有至 settle；foreign token 不污染后续测试。 |
| 附件注入收窄 | `importSessions` 注入改为只命中 staged `attachments.import-tmp-op/sub`——断言注入真正触发（`injected>0`）、期望 attachment 失败原因、源字节+目标字节双向保留、无 `.import-tmp-*` 残留发布。 |
| fresh-process crash/recovery | 新建 `src/main/import-crash.test.js` + `test-fixtures/import-crash-child.js`/`import-recover-child.js`：fork 真子进程跑 `importSessions`，patch `fs.promises.rename`/`fs.renameSync` 在事务检查点 `process.exit(9)` 模拟真崩溃（非 planted journal）；4 检查点（dest->bak、tmp->dest、staged、committed）。每点断言：journal 状态、dest 字节完整、source 未动、recovery 幂等（committed 二次 recover 不退化）。staged crash 恢复=丢弃 staging 保留原 dest（不提交半成品）。 |

### Iteration 11 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套含 reload 8 用例 + crash 4 用例） | 268/268 PASS |
| `node --test src/main/desktop-reload.test.js` | 8/8 PASS |
| `node --test src/main/import-crash.test.js` | 4/4 PASS（真子进程中断+另进程恢复） |
| `npm test`（全量 2631） | 2629 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功 |
| `git diff --check` | clean |
| bound R7/R8 DOM handler tests | NOT RUN（无 jsdom/linkedom 可用，stub-DOM 仅能测纯函数） |
| isolated UI matrix | NOT RUN |
| real Windows installer | BLOCKED/NOT RUN |
| check:release-version | DEFERRED（需真实 tag） |

### Iteration 12 验证层推进（bound-handler 真 Electron + 断言强化 + fixture 修正）

GPT 第十一轮验收无新增生产缺陷（fresh-process、reload decline/exception/deferred、attachment 收窄已确认），剩断言强化与 bound-handler/UI-matrix。第 12 轮收口：

| 项 | 内容 |
|----|------|
| bound-handler 真 Electron | 新建 `src/renderer/launcher-bound.child.cjs`（Electron main：`BrowserWindow(show:false)` load 真 `launcher.html` + 真 `src/preload/index.js` 经 `--dshd-shell-role=launcher` 暴露 `window.shell` + fixture `shell:*` IPC）+ `launcher-bound.test.js`（node:test spawn electron 解析 BOUND_RESULT）。(1) **delayed cancel A→B**：run-import A 挂起→cancel A 捕获 opA 挂起→resolve A→import B(opB)→送达 A 迟到 cancel `{ok:false}`→DOM `importResult='正在导入…'`（B 进行中未被覆盖，`stillOwns()` 拒绝 stale 写）；(2) **route resolved-refusal→retry**：点 beta→`saveLauncherConfig` #1 返回 `{ok:false}`（QA_ROUTE_FAIL_ONCE）→再点 beta→`saveLauncherConfig` #2 真发出（resolved refusal 当失败、`lastIssuedRoute` 重置、重试不被 dedup）。 |
| reload foreign-owner | token 释放移到 try/finally cleanup——失败断言不再污染后续测试。 |
| runChild 生命周期 | `setTimeout` 在真实 exit 时 clear、超时 SIGKILL 仅 fixture child、保留有界 stderr、超时/异常 exit 显式失败。 |
| fresh-process 断言强化 | 每检查点预期明确 `recovered`（不许 `blocked` 当成功）+ 精确字节 + source/unowned 未动 + owned txn artifacts（tmp/bak/txn）清理 + 每点二次 recover 幂等。staged crash=OLD bytes 保留（丢弃 staging）；dest->bak/tmp->dest/committed crash=SRC bytes 落地。 |
| fixture 修正 | `reconcileImportTransactionsSync refuses opId that mismatches` 补 `allowedOpIds:{OTHER}+allowedTxnDests` 落 `untrusted-journal`；attachment 测试断言期望 `failed:.*overlay-inspection-failed` 原因 + 去 catch-all + 源字节断言 + 无 `.import-tmp-*` 残留发布。 |

### Iteration 12 验证

| 命令 | 结果 |
|------|------|
| `node --test`（聚焦全套含 bound-handler 2 用例 + crash 4 + reload 8） | 270/270 PASS |
| `node --test src/renderer/launcher-bound.test.js` | 2/2 PASS（真 Electron BrowserWindow + 真 preload bridge） |
| `node --test src/main/import-crash.test.js` | 4/4 PASS（真子进程中断 + 另进程恢复） |
| `npm test`（全量 2633） | 2631 PASS / 0 FAIL / 2 skipped |
| `npm run check:governance` | 6/6 PASS |
| `npm run doc-sync` | 8/8 PASS |
| `npm run pack:launcher` | 打包成功 |
| `git diff --check` | clean |
| isolated UI matrix（6 页×2 视口×明暗+125/150/200% 缩放） | NOT RUN（Electron harness 已证明可用，matrix 本身未实现） |
| real Windows installer | BLOCKED/NOT RUN |
| check:release-version | DEFERRED（需真实 tag） |
