# Decision: 预览权限按 session、origin 与 frame 收紧

Status: proposed

中文 | [English](2026-09-19-preview-permission-origin-scope.en.md)

## Problem

`configurePreviewSession` 的权限处理器曾只看权限名：请求处理器 `callback(ALLOWED_PREVIEW_PERMISSIONS.has(permission))`，检查处理器同样如此，都忽略 `webContents`、请求方 origin 与 frame。预览面板允许打开任意 http(s) 文档，因此 `https://evil.example` 的主 frame 能拿到 `clipboard-read`，来自同一站点的 iframe 能拿到 `geolocation`，`notifications` 同理。审计探针在主 frame 与跨站 iframe 两种位置都复现了授权成功。这是最小权限缺陷：外部页面获得了应用级授权，而不是它自己域名下的授权。

## Proposal

审计修复先采用 **deny-by-default**：`ALLOWED_PREVIEW_PERMISSIONS` 置空，不引入审批 UI，四类旧授权与未知权限全部拒绝。保留的授权判定 seam `isPreviewPermissionAllowed(ses, webContents, permission, origin, details)` 也必须 fail closed：`webContents` 必须明确属于本 session、非 destroyed，顶层与请求 frame 的 origin 都必须是可解析的 http(s)，请求 frame 起源必须 loopback（`localhost` / `127.0.0.1` / `0.0.0.0` / `::1`，IPv6 字面量按 `URL#hostname` 的括号形态归一），且子 frame 必须与嵌入它的顶层文档同源；任何 owner/origin 缺失、opaque 或不可解析 input 都不得回退成父级 origin。未来若要恢复某类授权，允许名单只是必要条件，不能绕过上述绑定。

## Alternatives considered

- **直接拒绝全部权限请求** — accepted as the hotfix: 不引入宽泛审批 UI，先止血；若后续证明本地开发工作流确需某类能力，再按 origin/frame 绑定单独放行。
- **只信任主 frame、不放行任何 iframe** — rejected：同源的本地开发页面常用 iframe 承载编辑器或画布，同源放行既安全又保留能力。
- **在页面层加白名单只在 UI 提示** — rejected：授权发生在主进程的权限处理器里，UI 提示不能替代主进程判定，也无法阻止 iframe 的请求。

## Acceptance criteria

`node --test src/main/preview-session.test.js` 全绿：默认拒绝四类旧授权、`clipboard-write`、`local-fonts`、`media` 与未知权限；公开 origin、跨站 frame、异 session/无 session、destroyed `webContents`、opaque/不可解析 origin 一律拒绝。允许名单非空时才验证 loopback 主 frame 与同源 loopback frame 的绑定正例，并继续拒绝上层 owner/origin 不匹配。真实页面与 OS 层行为不在本轮断言范围内。

## Risks

拒绝全部权限后，浏览器预览页的剪贴板读取、定位、通知等能力会不可用，这是本轮有意的功能取舍；审查若证明普通复制/粘贴或本地开发工作流受损，应单独设计 origin/frame 绑定的授权，而不是恢复按名字放行。判定依赖 `webContents.getURL()` 与 Electron 传入的 `requestingUrl`/`isMainFrame`：若上游改变这些字段语义，判定会收敛为拒绝（安全失败），需要同步更新测试。

## Addendum: host-generation teardown (2026-09-20)

同一轮加固还给 `registerPreviewIpc` 加了宿主代际跟踪，并被审查发现一个确定性竞态：换代时 `reapHost()` 把 teardown 排进微任务，同一个 `shell:preview-open` 处理器随后才创建新预览；排队中的**全局** `live.closeAll()` 因而不是清掉旧宿主的资源，而是把新宿主的预览一起销毁，同时仍向新宿主返回成功。

修正后的不变式：

- Teardown 按**代**收敛。离开的那一代只关闭它自己登记过的 preview id 与共享单例，新宿主创建的资源永不被上一代的清理触及。
- 共享单例（悬浮文件窗、`workspace-preview` 服务器、PiP）的归属在宿主发出请求时**同步**登记。若登记发生在其首次 `await` 之后，上一代排队中的 teardown 会先一步执行并关闭它（`preview-workspace.js` 的 `close()` 会把端口复位为 0，受害者会拿到一个死 URL）。
- 后续宿主重新占用同一单例即接管归属；上一代的 teardown 只在归属未变时才关闭它。
- 单个清理失败只记录，不阻止其他资源的收敛——但也不得把失败静默当成已成功清理。

残留限制：清理与「新宿主占用」之间仍非原子；该不变式依赖所有共享资源都在拥有它的 handler 里同步登记，新增可跨宿主存活的单例时必须一并登记，否则会退回到这一缺陷类。

## Addendum: 单例归属的隐式依赖与清理时序（2026-09-20，迭代 9）

上一节的代际收敛存在两个真实缺陷，均由审查复现并经代码确认：

1. **隐式依赖未登记。** `shell:preview-open-file-window` 处理器只登记了 `file-preview-window`，但 `createFilePreviewWindowController(...).open()` 内部会调用 `workspacePreview.fileUrl(input)`（`src/main/preview-file-window.js:139-142`），因此悬浮文件窗**依赖** `workspace-preview` 服务器。后果有二：宿主 B 仅打开悬浮窗就可能把宿主 A 仍在拥有的服务器换掉；反过来，从悬浮窗入口起步的宿主会留下一个**无主**服务器，任何一代的 teardown 都不会回收它（泄漏）。修正：该处理器在发出请求时**同步**追加 `ownSingleton('workspace-preview', generation)`。
2. **清理在队列里失去所有权校验。** `teardownOwnedResources` 先读 `singletonOwner` 再排队关闭，并在关闭真正执行**之前**就删除了归属记录；若继任宿主在该窗口期认领同一单例，上一代排队中的关闭仍会把它关掉。修正：每次单例关闭都包在 `closeIfStillOwned(close)` 中，在真正调用关闭**之前**同步复查 `singletonOwner.get(name) !== generation`，只有复查通过才关闭并删除归属。

同一轮还统一了失败可观测性：所有关闭路径共用 `reportTeardownFailure`，`Promise.allSettled` 的 rejection 不再被丢弃，过期结果的关闭失败也经同一路径上报，不再用空的 `.catch(() => {})` 吞掉。

**可检验的判据（回归测试）**：悬浮窗入口必须让远端宿主看到仍在使用中的端口并提供预期内容；仅走悬浮窗入口的宿主在 teardown 后不得留下无主服务器；在「选定待清理资源」与「真正执行关闭」之间插入受控挂起点、让继任者先认领后，继任者的资源必须存活；注入的关闭失败必须能通过 `onTeardownError` 观察到且不阻塞其他清理。

## Addendum: 验收谓词与失败诊断（2026-09-20，迭代 9）

真实 Electron 权限运行器的**验收谓词**存在一个空洞：正控观测使用「未处于 `denied`」判定，因此 `timeout`（探针根本没有解析）会被当作「已观测到放行」。受控对照把每个探针都强制超时后，旧谓词报告 `positiveControlObserved=true`，新谓词报告 `false`。

修正后的判据是**逐 frame 的精确状态**：必须恰好为 `main.query_geolocation=granted`、`same.query_geolocation=granted`、`cross.query_geolocation=denied`，且每个 frame 的其余必需探针恰好为 `denied`；`missing`、`unsupported`、`timeout`、`threw:` 在**两种模式**下都判失败，默认拒绝模式因此不再可能空转通过。

失败时不再重试、不放宽断言，而是把**完整报告**（`checks`、`handlerDecisions`、`permissionChecks`、`browserOutcomes`、`positiveControlObserved`）、失败检查名与明细、分阶段耗时和运行时身份一并输出，使下一次偶发失败可以只凭产物定位。此前把它记为「负载敏感的测试装置抖动」属于推断而非测量；现改为**成因未确认的偶发验收失败**。

**独立清理边界**：独立运行（未提供 `DSHD_PREVIEW_PROFILE_ROOT`）时，profile 根目录原先由 Electron 进程在 `process.once('exit')` 里删除——该钩子触发时 Chromium 尚未释放文件句柄，删除会失败且失败被静默吞掉，泄漏目录不留任何记录。修正：Electron 进程只创建根目录，并把根路径与自身 pid 交给一个 `detached` 的纯 Node 清理监督进程（`scripts/preview-profile-cleanup.cjs`）；监督进程等待拥有者进程真正退出后再删除**恰好那一个**目录，退出状态不确定或删除无法确认时**保留目录并在 stderr 报告路径**。调用方提供的根目录始终归调用方所有，两个文件都不会删除它。（把监督逻辑放在 Electron 入口文件内被实测否决：Electron 父进程同步等待 Electron 子进程会死锁。）

## Addendum: 清理监督器的失败契约（2026-09-20，迭代 11）

上一节的监督进程只是把删除移出了 Electron，**失败本身仍不可观测**，且另有安全判定不成立：

1. **失败输出被丢弃。** 启动器用 `stdio: 'ignore'` 生成子进程并立即 `unref()`，所以「等待超时」与「删除失败」的 stderr 没有任何接收方——直接调用 helper 的单测能看到这些信息，真实接线看不到。
2. **异步启动失败没有出口。** 启动器只有同步 `try/catch`，没有 `'error'` 监听；spawn 失败经事件到达时无人处理。
3. **探测异常等于「已死」。** `isAlive()` 除 `EPERM` 外一律返回 `false`，于是**任何意外探测错误都被当作已确认进程退出**，进而授权删除。
4. **输入未校验。** helper 只检查根目录非空、pid 是整数，未落实其文档承诺的绝对路径约束、正 pid、有限期限与归属交接。

修正后的契约：

- **三态探活**：`process.kill(pid, 0)` → `alive`；`EPERM` → `alive`；`ESRCH` → `dead`；其它错误 → `unknown`。**只有 `dead` 可以推进到删除**；`unknown` 立即保留，超时也保留。
- **归属交接**：启动器在生成监督进程之前写入 `<root>/.dshd-cleanup-owner.json`（`version/token/ownerPid/createdAt/profileRoot`），并把同一 token 作为 `argv[7]` 传入；helper 必须校验形状与 token 相等才允许删除。缺失或不匹配一律保留。
- **持久收据**：helper 在**profile 根目录之外**写一份原子更新的 JSON 收据 `{version, state: pending|removed|retained, reason, profileRoot, ownerPid, updatedAt, detail}`；启动器先写 `pending`，helper 在每个出口（含参数校验失败、归属不匹配、探测未知、超时、删除失败、已不存在）落终态再退出。启动失败由启动器同步写 `retained` / `supervisor-start-failed`。
- **输入拒绝面**：非绝对根、根等于文件系统根或系统临时目录本身、非正 pid、非有限正期限、收据路径缺失/非绝对/位于根内、缺 token——全部保留并非零退出。
- **报告边界**：runner 的成功与失败报告都带 `profileCleanup: {state: pending|not-owned|retained, receiptPath, profileRoot, ownerPid}`；独立运行时为 `pending`，**权限测试通过不代表清理已完成**；调用方提供的根始终 `not-owned`，两个文件都不会删除它。

**可检验的判据**（真实子进程回归，非正则断言）：拥有者进程真实退出后收据落 `removed` 且目录消失；拥有者存活超过期限 → `retained`/`owner-timeout`；探测错误 → `retained`/`owner-probe-unknown`；非法输入与归属不匹配 → 保留且相邻无关哨兵目录不变；删除失败 → `retained`/`removal-failed`；启动失败 → `retained`/`supervisor-start-failed`；调用方自有根不被删除。

同一轮还补齐了过期预览关闭的最后一条静默路径：`shell:preview-open` 的迟到结果分支原先用 `void Promise.resolve(live.close(result.id)).catch(() => {})` 吞掉关闭失败，且同步抛出会绕过 `Promise.resolve`。现改为 `await Promise.resolve().then(() => live.close(id)).catch(reportTeardownFailure)`，拒绝与同步抛出都进入统一上报路径；过期调用方仍按原语义抛 `ERR_DSH_IPC_SENDER`，已接受的代际收敛与单例归属逻辑不变。

## Addendum: 收据发布与观察契约（2026-09-20，迭代 12）

上一节的收据机制仍有两处会**毁掉自己的证据**或**误判完成**：

1. **替换失败会删掉上一份可读收据。** 启动器与 helper 各自实现的写入器在 rename 遇到 `EEXIST`/`EPERM` 时先 `unlink` 目标再重试；若第二次 rename 失败，先前那份 `pending` 已被删除，且在 unlink 与 rename 之间存在**无收据窗口**。这与「原子替换」的表述相反，恰好在发布终态失败时抹掉唯一证据。
2. **观察者只等「文件存在」。** 独立运行测试先等根目录消失，再只等收据文件出现；但启动器在生成监督进程**之前**就写好了 `pending`，所以第二次等待根本不等待终态发布。helper 又是**先删目录、后写终态收据**，因此合法执行可能产生「目录消失 → 测试读到 `pending` → 测试失败 → helper 才发布 `removed`」的假失败。

修正后的契约：

- **共享写入器 `scripts/lib/receipt-file.cjs`**：启动器与 helper 共用同一个 `writeReceiptAtomic`，消除两份实现的漂移。它**从不 unlink 目标文件**：先在同目录写完整临时文件，再以有界重试原地 rename；重试耗尽后**抛错**（调用方据此报告发布失败，而不是宣称收据已写），目标文件保持逐字节不变。测试注入钩子 `DSHD_RECEIPT_FORCE_REPLACE_FAILURE` 可确定性地制造替换失败。
- **观察者等待终态**：测试辅助 `waitForTerminalReceipt` 轮询**解析后的收据**，直到状态属于 `removed`/`retained` **且** `profileRoot`/`ownerPid` 匹配本次运行，或到达有界期限；「缺失」「不可解析」「仍为 pending」在诊断中保持可区分。根目录消失不再被当作发布完成的证明，也**不通过重跑整个验收来掩盖这个顺序问题**。
- **失败夹具使用已知身份的进程**：移除失败夹具不再使用假定的「已死 pid」，改用**已观测退出**的子进程 pid，避免被无关存活进程改道到 `owner-timeout`。

**`pending` 的精确含义**：helper 不区分正常退出与强制终止——存活的监督进程在探针返回 `ESRCH` 后照常推进。因此 `pending` 只表示**清理完成情况未确认**，既不保证 profile 仍存在，也不能单独解释终态收据为何缺失。

**可检验的判据**：注入替换失败后，先前的 `pending` 收据逐字节不变、相邻无主文件不变、目录保留、失败被上报（非零退出）；顺序化的「移除后延迟发布」测试中，观察者必须等到终态才成功，永不发布的终态必须在有界期限内失败并保留最后观察到的状态。
