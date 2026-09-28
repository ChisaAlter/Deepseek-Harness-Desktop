# Decision: 导入事务化、保护区间与启动器审计整改（F1–F10）

Status: implemented

中文 | [English](2026-09-28-import-transaction-and-launcher-remediation.en.md)

## Problem

后续文件导入、恢复取消与安装回滚缺陷见[收尾审计修复](2026-09-28-launcher-audit-closeout-fixes.md)；本篇目录事务与维护槽决定继续有效。

启动器全面审查（Codex with ChatGPT 联合审计，报告见 `docs/qa/results/2026-09-28-launcher-audit/REPORT.md`）确认：附件导入在 `overwrite=false` 下删除目标独有文件；目录替换非崩溃安全（先删 dest 再改名 staging，恢复时把唯一副本清掉）；导入绕过 task-protection 直接 `dsh.stop()`；同名技能跨根静默覆盖；slim「恢复完整插件」不清粘性跳过标记；`waitForInstall` 的 same-version 捷径把取消/失败误报为 installed；附件失败不影响 `ok`；导入 IPC 无 `catch` 使错误静默；`--dsw-alias-layer-fill-2` 未定义导致背景失效；tablist/radio 缺键盘导航与 ARIA 关联。

## Decision

1. **journaled 三段式替换（F2）**：新增 `src/main/import-transaction.js`，`replaceDirJournaled`/`commitStagedDir` 按 staging→journal(`staged`)→dest→bak(`replacing`)→tmp→dest(`committed`)→清 bak 执行；恢复按 journal 状态调和，**不删除**无 journal 的 `.import-tmp`/`.import-bak`（可能是唯一副本），报告 `pending` 并使 journal 进入 `blocked` 阻塞后续导入。
2. **附件合并（F1）**：`mergeDirJournaled` 先把 dest 拷入 staging 再 overlay source；`overwrite=false` 保留同名 dest 文件，`true` 替换；dest-only 两种模式都保留。
3. **同名技能显式拒绝（F4）**：`collectSkills` 标注 `sourceCollision`；`importSkills` 在任何写入前按 canonical destName 分组，多源同选 → `failed/ambiguous-destination` 零写入；`overwrite` 不消解歧义。
4. **受保护静止区间（F3）**：`runImportTask` 将「停内核→runImport」放进 task-protection 非终态 `coordinate('stop', {preConfirmed:true, commit})`，Host 准入锁全程持有；导入期间 `startDesktop`/`startSkippedOp`/`retryFullPlugins` 返回 `import-in-progress`；空选择占用任务锁但不写盘、不停内核。slim 非空导入 fail-closed 返回 `slim-import-unsupported`；冷恢复发现 journal `blocked` 拒绝新导入（`import-recovery-blocked`）。
5. **slim 清粘性恢复（F5）**：`retryFullPluginsSlim` 停外部桌面端→严格读桌面 `config.json`→只重置 `pluginRecovery` 空形状并保留 `disabledPlugins` 等→原子写→重读验证→启动；任一步失败不 spawn。
6. **安装绑定请求版本（F6）**：`waitForInstall(child, baseline, signal, onProgress, deps, targetVersion)` 仅当注册表版本与请求版本精确一致且 exe 存在才判成功；移除 same-version 超时捷径。
7. **附件失败计入结果（F7）**：`importSessions().ok` 要求无会话 `failed` 且 `attachments` 非 `failed:*`；`runImport().ok` 继承；摘要显示 `共 N 项失败`。
8. **IPC 终端诊断（F8）**：导入按钮加 `catch`/`finally` 恢复控件、`importOpSeq` 防迟到事件覆盖、`cancelImport` rejection 显式吞掉、无 bridge 给可行动文案、`#import-result` 加 `role="status" aria-live="polite"`。
9. **token 与排版（F9+UI）**：`--dsw-alias-layer-fill-2` → `--dsw-alias-bg-layer-2`（确认卡、路由弹层）；`.import-scope-detail`、`.import-toolbar`、`.import-foot-opts`、`.import-foot-run` 统一 `12px/18px`；`.row-title` 加 ellipsis。
10. **键盘与语义（F10）**：主导航 `aria-orientation="vertical"` + roving tabindex + ↑/↓/Home/End + Enter/Space 手动激活；导入类别横向同构；tab `id`/`aria-controls` 与 panel `aria-labelledby` 全量关联；`route-seg`/`route-picker` 补 `role="radio"`/`aria-checked`/方向键跳禁用项；既有 `alertdialog` 焦点/Escape/Tab 循环保留。

## Alternatives considered

- **附件逐文件直接写入 dest 而不用 staging**：崩溃后 dest 处于半合并状态且无事务记录；staging+事务复用同一恢复模型且永不暴露半成品。
- **恢复时沿用旧的「清 `.import-tmp`」行为**：那是 F2 的根因——staging 可能是唯一副本；保守保留+阻塞优于数据丢失。
- **slim 引入跨进程锁协议实现真导入**：超出本任务范围且未经验证；fail-closed 是明确的安全边界，UI 已有对应呈现。
- **F4 默认取优先级根（如 home 优先）**：静默选择仍可能覆盖用户预期；显式拒绝让用户在 UI 中单选，代价只是一次额外勾选。

## Consequences

- 任一失败点都保留 ≥1 份完整副本（dest 或 bak）；`blocked` journal 需人工处理后才能再导入，重跑幂等。
- 新格式 txn journal/backup 存在时不得回退旧清理逻辑；代码回滚须先禁导入、静止、调和未完成事务。
- F6 真实 Windows 安装包行为需一次性环境复核（mock 层已覆盖）。
- 测试：`data-import` + `import-transaction` + `ipc` 103/103；故障注入 `.tmp-qa/c2c_plan1/verify-fixes.cjs` 16/16；全量 1884 通过（7 失败均为 vendor 预存在项）。

## Iteration-2 review corrections（GPT 验收审查 R1–R8）

GPT 对第 1 轮的独立验收返回 `VERDICT: CHANGES_REQUIRED`（3×P1 + 5×P2）。以下为第 2 轮追加修复，修正第 1 轮的过度声明：

1. **R1 恢复状态传播**：`needsRecovery` 现在从 `importSessions`/`importSkills`/`importPresets` 各阶段冒泡（结构化标记，不再是普通字符串）；`runImport` 检出后立即中止剩余阶段并写 `phase:'blocked'`（绝不写 `done`）；`recoverInterruptedImport` 处理 `blocked` journal，仍有 pending 时 `recovered:false` 持续阻断后续启动；恢复扫描覆盖 `.agent-presets` 隐藏目录；冷启动门新增 `readImportJournal` 独立持久 `blocked` 检查（含直接启动路径与恢复异常 fail-closed）。
2. **R2 路径信任边界**：新增 `txnPathsOwned`——恢复重命名/删除前校验 journal 的 opId 与文件名一致、dest/tmp/bak 绑定同目标父目录且都在 sweep root 内；不信任的 journal 记 `untrusted-journal` 并保留不跟随；`commitStagedDir` 拒绝 staging/dest 重叠；`overlayDir` 检测已存在于 staged dest 的 symlink/junction，覆盖前先移除。
3. **R3 真实静止区间**：`runImportTask` 的 commit 改用 controller 级 `harness.stopDesktop()`（取消恢复定时器、作废 pending op、drain pending restart）+ `stopDesktopCleanup()`，替代裸 `stopKernelIfRunning()`；`coordinate` 前拒绝 `protection.isCommitted()` 的已提交 shutdown 与已取消信号；`disablePlugins`/`disablePlugin`/`enablePlugin`/`removePluginOp` 在 `importAbort` 占用期间返回 `import-in-progress`。
4. **R4 安装目标绑定**：`installRuntime` 冻结 `targetVersion`（优先 `info.tag` 去 `v` 前缀，保留 prerelease 身份），`waitForInstall` 移除「空目标接受任意变化版本」的 fallback——空目标 fail-closed；同版本请求要求 exe mtime 大于 baseline stamp（或 baseline 无 exe 时新 exe 出现）才判成功，不再首轮即满足。
5. **R5 歧义前置预检**：`runImport` 在任何写入前对 `selectedSkillIds` 按 canonical destName（Windows 大小写等价）分组，多源同目标直接 `ok:false`+`ambiguous-destination`，sessions/attachments 均零写；UI 对 `sourceCollision` 技能行显示「同名冲突」徽标与冲突来源提示。
6. **R6 slim 重试槽位**：`retryFullPluginsSlim` 复用单操作槽 `importAbort`，并发 retry/retry、retry/Start、retry/import 互斥拒绝，覆盖 stop→config→launch 全程。
7. **R7 诊断持久+操作身份**：选择计数移出 `#import-result` 到独立 `#import-selection-line`（终态摘要不再被 rescan/选择变化覆盖）；`summarizeImport` 渲染 `result.error` 的可操作文案（slim/recovery/ambiguous/needing-recovery/shutdown/in-progress）+ `credentials` 计入 `totalFailed` + item 级错误明细（上限 8 条）；每个 progress 事件携带 `op`（renderer 生成 `opId` 经 `options.opId` 传入并回显），handler 丢弃非当前 op 的迟到事件；`cancelImport` rejection 显示为可行动文案而非静默。
8. **R8 radio 监听+语义**：`route-picker`/`route-seg` 的 `keydown` 用 `dataset.navBound` 只绑一次（不再随 innerHTML 重渲染累积）；方向键同步 focus+selection+save（radio 语义），跳禁用项；重渲染按稳定 route id 恢复焦点；`<ul role="tabpanel">` 恢复原生 list——改在外层 `<div role="tabpanel">`（`.import-sub-pane`）承载 `aria-labelledby`/`tabindex`，ul 保留原 id 供 list renderer。

**仍开放门槛**：真实 Windows 安装器完成/UAC 拒绝/early-exit/同版本歧义未在真实环境验证（标记 BLOCKED/NOT RUN）；UI 矩阵（6 页×2 视口×明暗+125%/150%/200% 缩放）未运行；`check:release-version`/`pack:launcher` 未在本轮执行；`doc-sync` 8 项中 `verify-translation-pairing` 与 `verify-doc-budgets` 因 `docs/design-language.md` 预存在超字未通过（非本次引入）；全量测试 2569 通过、1 个 vendor pin 校验失败（vendor 树被并行任务改动，与本任务无关）。

## Iteration-3 review corrections（GPT 复审 R1–R8 收口）

GPT 对第 2 轮再次返回 `VERDICT: CHANGES_REQUIRED`，按行指出第 2 轮的过度声明与残留缺口。以下为第 3 轮收口修复：

1. **R1 真实故障注入**：`.tmp-qa/c2c_plan1/verify-fixes-iter2.cjs` 的 `placeholder-pass` 替换为真实 rename+restore 双失败注入（patch `fs.promises.rename`，dest→bak 成功、staging→dest 与 bak→dest 均抛错），断言 `runImport` 返回 `needsRecovery`、skills 阶段被 `recoverySoFar` 跳过、journal 写 `phase:'blocked'`+`blockedReason` 而非 `done`。
2. **R2 物理路径+精确名+调和器统一**：`txnJournalOwnsPath` 在 `txnPathsOwned` 之上再要求 journal 文件**物理位于 `dest` 同父目录**（payload 投放的同名文件不能自证所有权）；tmp/bak 校验由 `startsWith` 前缀收紧为 `tmpName(dest,opId)`/`bakName(dest,opId)` 精确相等；async `recoverImportTransactions` 与 sync `reconcileImportTransactionsSync` 共用一个 `decideTxnResolution(state,{destThere,tmpThere,bakThere})` 决策表（新增 export 供单测对齐断言）；`committed` 分支先验 `dest` 存在才删 `bak`，dest 丢失则执行 `bak->dest` 恢复最后副本，`all-copies-missing` 记 pending；async 侧补齐 `all-copies-missing` 与 `destThere&&tmpThere` 两个此前遗漏的格子。
3. **R3 准入闸门**：新增 `blockedStartError()`——`startOp`/`startSkippedOp`/`retryFullPlugins`/`installRuntime`/`installRelease`/`installUpdate` 全部在进入前查 `readImportJournal(...).phase==='blocked'`（含不可读 fail-closed），拒 `import-recovery-blocked`；`index.js` 的 `startDesktopFromLauncher`（启动器/菜单/托盘/冷启动 auto-start 共同入口）同样查 blocked journal 并 `sendToLauncher('import')`+`desktop-failed`；`stopDesktopCleanup` 调用点改 `await`（注入函数允许 async）；`retryFullPlugins`（非 slim）也纳入同一闸门。
4. **R4 基线归一+真实完成**：`normalizeVersionString` 同时归一 baseline.version 与 observed（注册表 `v1.2.3` vs tag `1.2.3` 不再误判为「不同版本成功」）；`targetVersion` 在 `installFromAsset` **调用前**冻结；同版本成功判据改为「baseline 未注册→出现新注册」或「exe stamp 推进」二选一，时间戳单独不再构成完成证据。
5. **R5 执行期 dest 复查**：skills 循环在 `copyDirAtomic` 前对 live dest 做 `fs.existsSync` 复查（scan 期间的 conflict 判定是过期读），扫描后出现的目标目录在 `!overwrite` 下跳过而不是被静默覆盖。
6. **R6 槽位落定+操作种类**：`return await runtimeInstall.startExternalDesktop()`——槽位在 spawn 落定前不释放（裸 `return` 会在 try/finally 提前放行后续 op）；`importAbortKind` 区分 `'import'`/`'retry'`；`installRuntime`/`installRelease`/`installUpdate` 在 `importAbort` 占用期间拒绝，与导入互斥。
7. **R7 取消作用域+明细完整**：`cancelImport` 在非 `'import'` 槽或 `currentImportOpId` 不匹配时拒绝（`not-an-import-operation`/`not-current-operation`），无 opId 请求不能取消已标识的操作；renderer `cancelImport({opId: activeImportOpId})` 经 `shell:cancel-import` 下传；`summarizeImport` 的 item 级失败明细补 `credentials` 键。
8. **R8 roving tabindex+保存竞态**：`#route-picker`/`#route-seg` 补 `focusin` roving tabindex（同组仅当前项 `tabindex=0`，方向键移动时 tab 停留点同步迁移）；`pickRoute` 去重只比对 `lastIssuedRoute`（已发出的最新值），Right→Left 在 refresh 前不再因 stale render 吞掉第二次保存；`issueRouteSave`/`radioNextIndex` 导出，`launcher-behavior.test.js` 新增序列化保存、错误只报最新一次、`navBound` 双组绑定、import tabpanel `aria-controls` 契约测试。

**验收边界（如实）**：本轮仍未执行真实 Windows 安装器（完成/UAC 拒绝/early-exit/同版本）与 UI 矩阵（6 页×2 视口×明暗+缩放）；均为 mock/单测层。`npm test` 全量 2569 中 1 个 vendor `assertDesktopForks` 失败为并行任务改动、非本批。`doc-sync` 的 `verify-translation-pairing` 因 `docs/design-language` 预存在 drift 未过——与本批无关，但 `docs/decisions/*` 配对已由 `verify-translation-pairing --write` 同步。

## Iteration-4 review corrections（GPT 复审——共享维护槽 + 全准入收口）

GPT 第三轮验收将 R5 标记为闭合、R1/R2 降为 PARTIAL，R3/R4/R6/R7/R8 仍要求修复。核心问题：此前的「单操作槽」只被 import 侧占用，install/start/retry 只做 CHECK 不做 ACQUIRE——是单向排除而非互斥；且若干启动/写入面未接入准入。第 4 轮把它升级为共享维护槽并补齐准入覆盖：

1. **R1 不可读 journal fail-closed**：`readImportJournal` 把「ENOENT→`null`」与「其它读/解析错误→`{unreadable:true}`」分开——前者表示无事务、后者必须阻断。新增 `journalIsBlocked`（`phase==='blocked'` 或 `unreadable`）作为统一判据，供 `launcher-service`、`index.js`、`launcher-gate.js` 三处共用；附件导入路径同样以 `sessionsNeedRecovery` 闸控；sweep 子目录读失败由「静默跳过」改为「记入 pending」。
2. **R2 真实文件系统边界+操作清单**：`txnPathsOwned` 在词法前缀之外增加 `canonicalParentChain`/`isInsideCanonical`/`parentChainIsLinkFree`——journal `dest` 必须落在规范化父目录链内且链上无 symlink/junction，堵住「dest 词法在内、实际经链接逃逸 sweep root」的信任边界绕过；`commitStagedDir` 外层 catch 的 journal 写入加护栏；两个 reconciler 接受 `allowedOpIds`（importer 在 `journal.txnIds` 注册的 opId 清单），未注册的 journal 记 `unregistered-journal` pending 而不跟随执行其重命名/删除。
3. **R3 启动/写入面接入准入**：`shell:restart`（`restartWithCleanup`）在 `taskProtection.coordinate` 前先查 `importGuard.isMaintenanceHeld()`——维护中直接返回 `code:'maintenance-in-progress'`，绕过会误让用户确认的对话框；`cleanupDesktopResources` 由 fire-and-forget 改为返回 Promise，restart/reload/quit 三处 commit 全部 `await preview.closeAll()`（不再让 BrowserView 拆除中就推进重启）；`shell:save-config`（`applyRendererConfigPatch`）、`shell:saveLauncherConfig`、`profile-ops` 的 `disablePlugins`/`enablePlugin`/`removePlugin` 全部接入 `importGuard`/`journalIsBlocked`。
4. **R4 维护中等待语义**：`waitForInstall` 在轮询前先查 `signal.aborted`——已中止信号立即返回 `'aborted'` 不再空转；同版本已注册分支在「stamp 未推进且 installer 子进程已退出」时立即 `finish(null)` 落为 `waiting`（unconfirmed），不再把已死安装器的残留时间戳当成会变化的完成证据轮询满超时。
5. **R6 双向互斥共享槽**：新建 `src/main/import-guard.js`——模块级单例 owner token（`acquireMaintenance`/`releaseMaintenance`/`isMaintenanceHeld`/`maintenanceOwner`/`assertMaintenanceFree`，`releaseMaintenance` 只对当前 owner token 生效，陈旧句柄不能丢所有权）。`runImportTask`/`installRuntimeOp`/`installUpdateOp`/`installReleaseOp`/`startOp`/`startSkippedOp`/`retryFullPlugins` 全部 `acquireMaintenanceSlot(kind)` 并在 `finally` 释放——install/start/retry 从「CHECK import 槽」变为「ACQUIRE 同一槽」，达到任意到达顺序的真正互斥。
6. **R7 取消作用域+进度归属**：renderer `cancelImport` 在 `await` 前把 `activeImportOpId` 快照为 `cancellingOpId`——不再读可能在 await 间被 run 处理器清空的共享变量；并识别 resolved `{ok:false}` 拒绝（`not-current-operation`/非导入占用）照常提示；`onImportProgress` 过滤器由「有 `op` 且不匹配才丢」收紧为「`payload.op` 必须等于当前活动 opId」——无 `op` 字段的事件同属未归属一并拒绝，杜绝无关发射器覆盖终态。
7. **R8 路由保存序列化**：`issueRouteSave` 失败时把 `lastIssuedRoute` 重置回 `selectedRoute()`——不再指向未持久化的值，同路由重试不再被「value===lastIssuedRoute」去重吞掉；`pickDownloadRoute`（radio 与 popup 共用）改经同一 `issueRouteSave`/`routeSaveGen` 代际，仅保存成功才触发 `afterSave`——两条控制路径共享标记与代际，消除 popup↔radio 交错保序分歧。

**新增测试**：`src/main/import-guard.test.js`（槽互斥 / 陈旧 token 不丢所有权 / profile 写入维护中拒绝），`launcher-behavior.test.js`「失败保存重置标记可重试」回归。

**验收边界（如实）**：真实 Windows 安装器（完成/UAC 拒绝/early-exit/同版本歧义）与 UI 矩阵（6 页×2 视口×明暗+缩放）仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2595 中 2592 通过、1 个 vendor `assertDesktopForks` 失败为并行任务改动 `MenuView.tsx`（非本批）；`check:governance` 6/6、`doc-sync` 8/8 全通过。

## Iteration-5 review corrections（GPT 复审——owner-aware delegation + write-ahead inventory + 真实谓词导出）

GPT 第四轮验收 R5 保持闭合、R6 服务层双向 acquire 已实现，但指出集成引入两个新阻断：`journalIsBlocked` 定义了却漏加 `module.exports`（各调用方走兼容性 fallback，忽略 `unreadable`）、共享槽在嵌套 restart 时把自己的 owner 当 foreign 拒绝。第 5 轮按复审收口：

1. **R1 共享谓词真正生效**：`journalIsBlocked` 加入 `data-import.js` `module.exports`；`launcher-service`/`index.js` 去掉 `typeof === 'function'` 兼容性 fallback 直调真谓词（此前 fallback 只查 `phase==='blocked'`、漏掉 `unreadable:true`）；`launcher-gate` 经注入 `journalIsBlocked` 用同一谓词，本地 impl 降为默认；`recoverInterruptedImport` 把 `unreadable` 与 journal shape 校验提到 `destHome` 比较之前——无 `destHome` 的不可读 journal 不再因 `!samePath` 提前返回而漏过阻断，缺 `phase`/`destHome` 的合法 JSON 也 fail-closed。
2. **R2 写入边界+库存前注册**：`replaceDirJournaled`/`commitStagedDir` 在 dest 父目录上调用 `parentChainIsLinkFree`——父链任一组件为 junction/symlink 即拒写 `unsafe-destination-link`（此前该 helper 只用于恢复校验，write 路径仍词法检查）；`copyDirAtomic`/`mergeDirJournaled` 改为 write-ahead 注册 opId（事务前 `nextOpId()`+`registerTxnId`，崩溃时 journal 已可归属，首个事务崩溃不再是「先崩后注册」的 unowned 状态）；blocked journal 重写保留 `txnIds`（原重建对象丢弃注册）；`allowedOpIds` 空 Set 语义改为「零授权」（原 `size>0` 才过滤等于空即放行），仅当 journal 实际带 `txnIds` 字段才构造 Set（无字段的旧格式仍走信任边界，不误伤手写/旧 journal）；async `recoverImportTransactions` 同步接受 `allowedOpIds`。
3. **R3/R6 owner-aware delegation + 全写入面准入**：`importGuard` 新增 `holdsMaintenance(token)`——只有当前 owner token 对象本身放行（kind 字符串、lookalike、stale token 均不放行）；`restartWithCleanup(delegatedToken)` 同 owner 委托放行、异 caller 拒绝 `maintenance-in-progress`；`startDesktopFromLauncher` 透传 `options.maintenanceToken`；service `startOp`/`startSkippedOp`/`retryFullPlugins` 把各自 `guard` token 经 `startDesktop` options 传入——合法嵌套 forced restart（skip-plugins/restore-full/clear-sticky Start）不再自我拒绝；`shell:restart` handler（`recordBootRestart`→`harness.retryFullPlugins`，controller 路径绕过 service 槽）前置 `importGuard.isMaintenanceHeld()`；`removePluginOp` 由「只 CHECK」改「ACQUIRE 持 token 贯穿 uninstall」（先 admit 的 removal 不再与后到的 import 重叠）；`profile-ops` `disablePlugins`/`enablePlugin`/`applyRendererConfigPatch` ACQUIRE 并经 `holdThrough` 持 token 到 deferred align 落定；import 的 `preConfirmed:true` 移除——import 不是显式同意 Stop 按钮，恢复正常 protected-import decision（inspect→acquire→drain→re-inspect→prompt），Stop 按钮的显式同意豁免独立保留。
4. **R4 真实同版本完成判据**：空 `targetVersion` 在 `installFromAsset` 前拒绝 `unbound-target-version`（不再让 install 副作用先行）；installer child 生命周期完整捕获（`code`+`failed`）；撤回「初生子进程退→waiting」的早退——NSIS 提升允许初生 child 先退，不能据此推定安装已死；同版本已注册分支改为「stamp 前进 AND child 未报失败」，被失败 installer 触碰的时间戳不再判成功，无可靠完成信号时维持 unconfirmed。
5. **R7 取消响应归属**：renderer `cancelImport` 的 resolved `{ok:false}` 与 rejected 两个分支写 `#import-result` 前都过 `stillOwns()`——captured `cancellingOpId` 仍是当前活动 op 且 run 仍在飞才写；A 的迟到 cancel 响应不再覆盖 A 的终态摘要或 B 的进行中状态。
6. **R8 resolved 拒绝+渲染陈旧值**：`issueRouteSave` 识别 resolved `{ok:false}`（service `saveLauncherConfig` 在维护中返回 `maintenance-in-progress`）按失败处理——重置 `lastIssuedRoute`+返回 `false`（原只 catch 异常，resolved 拒绝被当成功，重试被「value===lastIssuedRoute」去重吞掉）；`pickDownloadRoute` 去掉 `routeId===current` 早退（pending save 期间 `current` 是旧渲染值，回到该值会丢最新意图），radio/popup 统一只按 `lastIssuedRoute` dedup。

**新增回归**：`import-transaction.test.js` 空 inventory 零授权/payload txn 显式 inventory 下不执行/junction dest 父链拒写；`runtime-install.test.js` 同版本+stamp 前进+installer 失败不判成功/空 target 零 installer 调用；`import-guard.test.js` `holdsMaintenance` owner 区分/profile ACQUIRE+release；`launcher-behavior.test.js` resolved `{ok:false}` 拒绝按失败+重试持久；`ipc.test.js` start/retry 的 `maintenanceToken` 委托断言。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2603 中 2600 通过、1 个 vendor `assertDesktopForks` 失败为并行任务改动 `MenuView.tsx`（非本批）、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`git diff --check` clean。

## Iteration-6 review corrections（GPT 复审——fail-closed 形状校验 + 嵌套 owner 透传 + slot 泄漏封堵 + 测试 stub 补全）

GPT 第五轮验收 R5 闭合、R7 实现层闭合、R8 两处缺陷已修（仍待绑定 handler 行为测试）。剩余阻断集中在 R1 journal 形状盲区、R2 注册吞错与父链检查时序、R3/R6 嵌套 restart 自我拒绝与同步段 slot 泄漏、R4 同版本未确认仍报成功。第 6 轮收口：

1. **R1 journal 形状归一为 fail-closed**：`readImportJournal` 新增 `isUsableJournalShape`——`null`/`[]`/`{}`/不合规 JSON 不再各自返回 `null` 或裸对象，统一归一化为 `{unreadable:true,invalid:true}`。此前「合法 JSON 但 `null` 形状」会让 shape 检查永远走不到，现在 `journalIsBlocked` 对任何非 journal 形状都能阻断。
2. **R2 注册不再吞错 + 父链检查提前**：(A) `registerTxnId` 由「失败静默吞掉」改为 REQUIRED（抛错）——`copyDirAtomic`/`mergeDirJournaled` 把注册失败包装为「零落盘的拒绝」而非继续裸写；初始 journal 携带 `txnIds:[]`，blocked 重写保留 `txnIds`。(B) `mergeDirJournaled` 在 staging **之前**先做 `parentChainIsLinkFree(destParent)`——staging 不再先于边界检查发生；`parentChainIsLinkFree` 自 `import-transaction` 导出复用。
3. **R3/R6 嵌套 owner 透传 + slot 泄漏封堵**：(A) `alignHarnessAfterProfileChange(startHarness, downError, ownerToken)` 把 ownerToken 透传给 `startHarness(ownerToken)`（=`restartWithCleanup`）——嵌套 restart 被识别为同 owner 委托放行，不再自拒后谎报 `harnessRestarted:true`；resolved `{proceeded:false}` 计为失败。(B) `disablePlugins`/`enablePlugin`/`applyRendererConfigPatch`/`startOp`/`startSkippedOp`/`retryFullPlugins` 在 ACQUIRE 后的同步段用 `transferred` 标志 + try/catch——同步异常不再泄漏 slot。(C) 非 launcher 的 `shell:retry-full-plugins` 走 `recordBootRestart`：`ipc.js` 接 `importGuard.isMaintenanceHeld()` + `journalIsBlocked(readImportJournal)` 准入并返回 `{ok:false}`；`shell:restart` 与 `shell:retry-full-plugins` 都传播该拒绝；`restartWithCleanup` 同步接入 blocked journal 检查。
4. **R4 同版本未确认不再报成功**：`childDone.failed` 由初始 `false` 改为同版本已注册分支 `settled=false` 恒等（未确认→超时按 waiting 计）；installer 生命周期在 `onInstallerLaunch` 时即捕获进 `installerChildDone` 传给 `waitForInstall`（不再在 waitForInstall 内部捕获而漏掉早期退出/失败事件）。
5. **测试 stub 补全阻断面**：`ipc.test.js` 的 `stub('./data-import')` 补上 `readImportJournal`/`journalIsBlocked` 导出——缺省导出会让 `recordBootRestart` 的 try/catch 抛 `TypeError` 被静默吞成 `{ok:false}`，boot restart 测试拿不到 snapshot、失败路径也不再 rethrow；stub 缺省返回「无 journal」，blocked 路径可经 `options.readImportJournal` 覆盖。

**新增回归**：`ipc.test.js` 维护期 `shell:restart`/`shell:retry-full-plugins` 拒绝断言、`import-transaction.test.js` mergeDir 先父链后 staging、`profile-ops` 同步段异常不泄漏 slot。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2603 中 **2601 通过、0 失败**、2 skipped（vendor `assertDesktopForks` pin 校验本轮通过——并行任务 `MenuView.tsx` 收敛后不再触发）；`check:governance` 6/6、`doc-sync` 8/8、`git diff --check` clean。

## Iteration-7 review corrections（GPT 复审——完整 journal 校验 + 零授权 legacy + 入口真正 acquire）

GPT 第六轮验收 R4 同版本误报、R3/R6 profile 委托与同步异常已闭合。剩余三处：R1 共享校验不完整、`{"phase":"copying"}` 无 destHome 仍被当合法；R2 无 `txnIds` 字段的 legacy journal 仍授权发现的 sidecar、inventory 无 opId→dest 绑定、文件系统检查错误被吞；R3/R6 独立 restart 入口只查不 acquire。第 7 轮收口：

1. **R1 共享校验升级为完整契约**：`isUsableJournalShape` 现要求 object 非数组 + `phase` ∈ `{copying,blocked,recovered,done}` + `destHome` 非空 string + `txnIds`（存在时）为 string 数组——`{"phase":"copying"}` 无 destHome、未知 phase、畸形 inventory 一律归一 `{unreadable:true,invalid:true}`。`recoverInterruptedImport` 移除重复 shape 判断，recovery 与手动准入消费同一 reader verdict（不再引入第二个更严解释层）。
2. **R2 零授权 legacy + 目的地绑定 + 检查错误 fail-closed**：(A) 无 `txnIds` 字段的 legacy journal 授权集合改永远为空 Set——字段缺失=零授权而非 trust-boundary 兜底，payload 投放的 sidecar 记 `unregistered-journal` 保留不执行。(B) 新增 `txnDests` opId→dest 绑定：`registerTxnId(journalFile, opId, dest)` 写映射，两个 reconciler 接受 `allowedTxnDests`——已注册 opId 出现在错误 dest 记 `unbound-destination`；blocked/done journal 重写保留 `txnDests`。(C) `isLinkLike` 仅 ENOENT 判非链接，其余检查错误 fail-closed 判 link-like；`canonicalParentChain` 仅 ENOENT 继续上溯、其余错误返回 null——检查失败不再被重构成 lexical 路径当安全边界。
3. **R3/R6 入口真正持有操作**：`recordBootRestart` 由只查 `isMaintenanceHeld` 改 `acquireMaintenance('boot-restart')` + finally release（pending 期间竞争者被拒，反向时序排除闭合）；acquired token 经 `startHarness(acquired)` 委托嵌套 `restartWithCleanup` 不自拒。`restartWithCleanup` 无 delegated owner 时自 acquire 'restart' 并在 settle 后 release。`startDesktopFromLauncher` 非 forceRestart 路径 acquire 'start'、外来持有 refuse。`profile-ops` 新增 `configureProfileOps({journalBlocked})`——`acquireMaintenance` 写配置前先判 blocked journal，`acquireRefusalReason()` 区分 `import-recovery-blocked`/`maintenance-in-progress`。

**新增回归**：`data-import.test.js`（缺 destHome/非法 phase/畸形 inventory admission+recovery 一致拒绝、valid/missing 对照、field-less legacy 保留 payload sidecar、已注册 opId 错误 dest 拒执行）、`ipc.test.js`（boot restart pending 持槽竞争者被拒、外来持有 refuse 不写 marker）。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2609 中 **2607 通过、0 失败**、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 打包成功、`check:release-version` 需 release tag 参数（发布期 gate）未跑、`git diff --check` clean。

## Iteration-8 review corrections（GPT 复审——destination 绑定强制 + overlay 检查错误中止 + reload/removal 准入）

GPT 第七轮验收 R1 校验缺陷与独立 start/restart 入口 acquire 已闭合。剩余三处：R2-A `txnDests` 缺失仍放行（ID-only inventory 隐含授权）、R2-B overlay 检查错误被当 symlink 重演 F1 删除路径、R3 reload-to-start 与 plugin removal 绕过 blocked journal。第 8 轮收口：

1. **R2-A destination 绑定强制 + 裸调用 fail-closed**：`allowedOpIds` 为 Set 时（inventory 模式），opId 必须有合法 `txnDests[opId]` 字符串绑定且与 journal.dest 匹配——无 map/空 map/缺 key/非 string 值/不匹配一律记 `unbound-destination` 保留不执行；ID-only 旧 inventory 不再隐含 destination 授权。**未传 inventory 的裸 reconciler 调用同样 fail-closed**：`allowedOpIds` 缺省回退为 `EMPTY_SET`——可 inspect/report unowned pending，绝不 rename/delete（既有测试 fixture 改为显式传 `allowedOpIds`+`allowedTxnDests` 作为授权 control）。`isUsableJournalShape` 同步校验 `txnDests` 形状（存在时必须是 object→string 映射，畸形 map 整 journal fail-closed）。
2. **R2-B overlay 检查错误中止而非删除**：`isLinkLike` 重构为 `classifyLink(p)` 四态（`link`/`clean`/`missing`/`error`）。`parentChainIsLinkFree`/`isLinkLike` 对 `error` 继续 fail-closed（不可判=不安全的写入边界）；`overlayDir` 改用 `classifyLink`——`error` 直接 throw `overlay-inspection-failed` 中止 staging（绝不递归删除含 dest-only 数据的目录，重演 F1 的删除路径封堵），`link` 仍按 overwrite 删后重拷。
3. **R3 reload/removal 准入补齐**：`reloadWithCleanup` 区分真 reload 与会 start 内核——`willStartKernel`（win 存在且 kernel 非 ready）时先判 `isMaintenanceHeld`+`journalIsBlocked`，再 `acquireMaintenance('reload-start')`+finally release，blocked journal 下菜单 Reload 不再绕过 start 准入；kernel ready 时纯 `showHarness` 无锁。`removePluginOp` 在首个副作用前调 `blockedStartError()`——blocked journal 下不 stop 内核、不 uninstall、不写 config。

**新增回归**：`data-import.test.js`（ID-only inventory/空 map/缺 key/非 string 绑定均 blocked+sidecar 保留）、`import-transaction.test.js`（overlay lstatSync EACCES → 中止且 dest-only/conflict 字节保留）、`ipc.test.js`（blocked journal 下 remove-plugin 零副作用：不 stop/uninstall/save）。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2616 中 **2614 通过、0 失败**、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 打包成功、`git diff --check` clean；`check:release-version` 需真实 tag（发布期 gate）保留 DEFERRED。

## Iteration-9 review corrections（GPT 复审——reload dispatch 拒绝传播 + 测试层修正）

GPT 第八轮验收 no-context recovery API gap、reload unsafe-start、overlay 检查错误、junction ctx.skip 已闭合。剩一处 P2：dispatch-time reload 拒绝被 task-protection coordinator 吞掉（commit 返回值被丢弃，`{proceeded:false}` 不传播，resolve 成正常完成）。第 9 轮收口：

1. **R3 dispatch-time 拒绝传播**：`reloadWithCleanup` commit 内拒绝改写入局部 `dispatchRefusal` 变量，外层 `.then` 优先返回它——coordinator 丢弃 commit 返回值不再把 refusal resolve 成正常完成；entry-time 与 dispatch-time 拒绝形态一致（`{proceeded:false, code}`）。ready→idle 变更期间 foreign owner/blocked journal 都被拦下且不启动内核；foreign token 不被误释放（只 release 本调用 acquire 的）。
2. **测试 fixture 修正**：`reconcileImportTransactionsSync refuses opId that mismatches the filename` 与 `refuses a journal pointing outside the tree` 改带显式 ownership（`allowedOpIds`+`allowedTxnDests`）让 binding 检查通过、落到意图验证的 `untrusted-journal` 分支——fixture 跟随更严 API 契约。
3. **overlay 测试强化**：升级目录级 staged dir（含 conflict+dest-only）+ 断言精确字节保留 + reject `overlay-inspection-failed`，对齐 GPT 要求的目录级 F1 重演场景。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2618 中 **2616 通过、0 失败**、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 打包成功、`git diff --check` clean；`check:release-version` GPT 确认应从无条件 gate 移除、DEFERRED 至真实 tag。

## Iteration-10 review corrections（GPT 复审——reload 可测 seam + fixture/生产路径补全）

GPT 第九轮验收生产代码缺陷全闭合（reload refusal propagation 静态确认），剩余为验证/证据层：reload 缺可测 seam、filename-mismatch fixture 未跟随新 API 契约、overlay 缺 production-path 佐证。第 10 轮收口：

1. **desktop-reload 可测 seam**：新建 `src/main/desktop-reload.js` 导出依赖注入的 `createReloadWithCleanup(deps)`——index.js 以真实 `getMainWindow`/`dsh`/`harness`/`taskProtection`/`importGuard`/`readImportJournal`/`journalIsBlocked`/`cleanupDesktopResources`/`getUserDataDir` 组合成同一实现（不复制函数、不捕获 stale runtime、不导出 Electron 入口、不加 renderer hook）。
2. **reload race 回归**：`src/main/desktop-reload.test.js`（4 用例，真 `createTaskProtection`——丢弃 commit 返回值的生产语义 + deferred `cleanupGate`）：ready→idle+foreign owner 零 start+`maintenance-in-progress` 拒绝+foreign owner 保留；ready→idle+blocked journal 零 start+`import-recovery-blocked`；ready 全程纯 view reload 无 start 无锁泄漏；idle+授权 start 持槽到 settle 后释放。
3. **fixture/生产路径补全**：`refuses opId that mismatches` 补 `allowedOpIds:{OTHER}+allowedTxnDests` 落 `untrusted-journal`；`data-import.test.js` 新增 `importSessions`（importAttachments:true）注入 staged tmp 目录 lstatSync EACCES——merge 中止不发布、dest-only/conflict 精确字节保留（helper 层 overlayDir 用例之外的 production-path 佐证）。

**验收边界（如实）**：真实 Windows 安装器与 UI 矩阵仍未在真实环境执行——mock/单测层覆盖。`npm test` 全量 2623 中 **2621 通过、0 失败**、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 打包成功、`git diff --check` clean。

## Iteration-11 verification push（GPT 复审——reload 完整回归 + fresh-process 中断恢复）

GPT 第十轮验收无新增生产缺陷，剩验证/证据层。第 11 轮推进：

1. **reload 回归补齐**：`desktop-reload.test.js` 扩到 8 用例——coordinator decline、cleanup rejection、controller rejection（异常传播+锁释放）、deferred-controller 所有权持有至 settle；foreign token 在 test cleanup 释放不污染后续。
2. **附件注入收窄**：staged `attachments.import-tmp-op/sub` 精确命中（不再全 `.import-tmp-` 通配）——断言注入真触发、期望失败原因、源+目标字节双向保留、无 `.import-tmp-*` 残留发布。
3. **fresh-process 事务中断/恢复**：`import-crash.test.js` fork 真子进程跑 `importSessions`，patch `fs.promises.rename`/`fs.renameSync` 在事务检查点 `process.exit(9)`（真崩溃非 planted journal）；4 检查点（dest->bak、tmp->dest、staged、committed）。断言 journal 状态、dest 字节完整、source 未动、recovery 幂等。staged crash=丢弃 staging 保留原 dest（不提交半成品）。

**验收边界（如实）**：`npm test` 全量 2631 中 **2629 通过、0 失败**、2 skipped；`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 成功、`git diff --check` clean。**bound R7/R8 DOM handler 测试与 UI matrix 仍未执行**——环境无 jsdom/linkedom，stub-DOM 仅能测纯函数；真实 Windows 安装器 BLOCKED/NOT RUN；`check:release-version` DEFERRED 至真实 tag。
