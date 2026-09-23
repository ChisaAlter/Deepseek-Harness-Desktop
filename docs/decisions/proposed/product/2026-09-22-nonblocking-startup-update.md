# Decision: 冷启动的更新检查退出自动启动关键路径

Status: proposed

中文 | [English](2026-09-22-nonblocking-startup-update.en.md)

## Problem

`runColdStartGate`（`src/main/launcher-gate.js`）一进入就 `await checkUpdate()`，直到拿到
GitHub 结果才做本地恢复、导入 hold、上次失败与自动启动判定。`update.js` 给该请求的预算是
`CHECK_TIMEOUT_MS = 10_000`，因此 GitHub API 被代理黑洞、DNS 或防火墙拖到「连接后不响应」
时，`startDesktop()` 之前会稳定插入接近 10 秒的等待。源码启动与安装包启动走同一条闸门，所以
这不是只在特定分发形态下才出现的成本。

首次可见的修复冲动是缩短超时，但超时预算本身就是「hung GitHub 不得拖垮冷启动」的守护。真正的
问题不是预算太长，而是**自动启动没有必要等待一个与本地启动判定无关的网络结果**——检查结果只在
两处影响产品：真的询问用户要不要更新，以及把提示写进启动器。

## Proposal

把闸门拆成「本地启动判定」与「更新检查」两条并行路径。

本地启动判定仍按现行规则决定是否自动进入桌面：导入 hold、恢复的中断导入、上次启动失败、
`config.autoStartDesktop === false` 全部照旧，**不再等待更新网络结果**。更新检查在闸门开始时
启动，结果迟到时按安装形态落到启动器，而不是回退自动启动决定：

- `autoStartDesktop` 为真且没有本地 hold：先 `startDesktop()`。迟到结果不抢焦点、**不**自动打开
  启动器、**不**触发第二次启动；结果保存在进程内。
- `autoStartDesktop` 为假（或本地 hold 已要求停在启动器）：先 `openLauncher()`，迟到结果在同一
  个可见启动器窗口里呈现，并走既有的更新询问 / 下载编排。

迟到结果的消费由 `createParkedUpdateDrainer` 负责，而不是由「谁先读状态」决定：

- 结果停在 `parkedUpdateCheck`，`shell:launcher-status` 用 `peekParkedUpdateCheck()` **非消费**
  读取（原先用 take，隐藏窗口的一次状态刷新就会把结果吃掉）。
- drainer 只在启动器**真正可见**且代际仍当前时消费；并发调用共享同一轮 single-flight，
  不会因为多次 show 事件重复询问。
- `askOnUpdate === false` 时静默消费该结果，不弹框。
- 放弃消费时（窗口在确认框 await 期间被关闭、应用正在退出、代际已被替换）若还没有更新的结果，
  就把结果重新 park 回去，留给下一次真正可见的启动器。
- `presentUpdateAsk` 接收 `shouldContinue()`，在确认对话框 await **之后**复检；失败返回
  `{ abandoned: true }`，不安装、不抢焦点。

`index.js` 侧用 `launcherWindowToken` 标识当前启动器窗口：`openLauncher()` 在 show 之后 drain，
`bindLauncherClose` 挂 `show` 触发 drain、`closed` 清 token；drainer 的 `isCurrentGeneration`
按窗口身份判定，`shouldContinue` 同时检查 quitting、窗口仍可见与代际一致。

更新检查在进程内 single-flight：同一进程内并发调用共享一次网络请求。显式刷新（启动器版本页、
`shell:check-update`）仍然绕过短期缓存去取新结果。第一版不引入磁盘更新缓存。

下载、sha512 校验、未校验安装包的确认，以及启动安装器继续走既有代码，语义不变。迟到结果必须
检查启动/退出代际：更新请求返回时若已退出或已进入安装器流程，不再改写启动器状态。更新下载失败
不得关闭已经工作的桌面。

## Alternatives considered

- **把 `CHECK_TIMEOUT_MS` 调小（例如 3 秒）** — rejected：这是拿正确的守护换表面数字。黑洞网络下
  只是把 10 秒变成 3 秒，仍然在关键路径上；而超时预算变短会让慢网络的用户更频繁地拿到「检查
  失败」，误报增加、收益不确定。

- **给检查结果加磁盘 TTL 缓存，跳过冷启动那一次请求** — deferred：它确实能消掉稳态的第一次
  请求，但引入盘上格式与失效语义（缓存过期、跨版本、用户显式刷新如何绕过），并且在缓存未命中
  或过期时仍然保留「网络决定启动时序」这一根因。非阻塞编排先做，缓存留作后续可选加速。

- **不自动进入桌面，一律先显示启动器等更新结果** — rejected：这是对现有产品行为的反向改变。
  用户开启「打开后自动启动桌面端」就是要跳过启动器；为了更新检查把每个人都按回启动器，等于用
  可见的迟钝替换不可见的迟钝。

- **把更新检查挪到桌面进入之后再发起，与 harness 启动并行** — partially adopted：检查本来就在
  闸门开始时发起、与 `startDesktop()` 并发，差别只在结果如何呈现。刻意不在 harness 起来之后才
  发请求，是因为那会延后提示到用户已经在工作时，打断成本更高。

- **让 renderer 的状态查询直接取走结果** — rejected（已实现并推翻）：`shell:launcher-status`
  会被后台刷新调用，隐藏窗口也会走到，take 语义让结果在任何可见展示之前就消失。状态查询必须
  非消费，由「真正可见」这个动作驱动消费。

## Acceptance criteria

- `checkUpdate` 返回一个未结算的 Promise 时，符合自动启动条件的冷启动仍调用 `startDesktop()`，
  且 `startDesktop` 在检查结算前已被调用。
- 检查迟到结算不产生第二次 `startDesktop()` 调用，也不打开启动器、不夺焦点。
- 注入 0 / 2 / 10 秒网络延迟时，`gate → startDesktop` 的 P95 增量不超过 100 ms（相对于 0 延迟
  对照组），且因果顺序断言通过。
- `autoStartDesktop === false`、导入 hold、上次启动失败三条路径照旧停在启动器，且更新结果仍能
  在启动器里呈现。
- 隐藏启动器的状态刷新**不**消费待呈现结果；再次打开时按 `askOnUpdate` 只询问一次；
  `askOnUpdate === false` 时静默消费不弹框。
- 确认框 await 期间窗口被关闭、应用正在退出、或代际已被替换时放弃消费，并把结果重新 park；
  异步通知失败不产生未处理拒绝。
- 既有更新流程回归不变：接受更新后下载 / 校验失败落回启动器首页；packaged 且安装器已拉起才等待
  退出；源码运行拉起安装器留启动器。
- 进程内 single-flight 命中时只发一次网络请求；`shell:check-update` 显式刷新不被短期结果挡住。
- 以上除纯 gate 单测外，另有一条真实 Electron 打开启动器的验证。

## Risks

- 这是**产品时序变化**：更新提示可能晚于桌面出现。用户开启自动启动时要接受「更新询问只在下次
  进启动器时出现」，而不是在桌面启动前被拦住。
- 迟到结果与用户手动操作竞争（用户先手动打开启动器、先点了「稍后」、先进入安装器流程）必须由
  代际检查裁定，否则会出现重复弹框或改写已完成动作。
- 不引入磁盘缓存意味着每次冷启动仍然发一次网络请求；本决策只保证它不阻塞启动，不保证它不耗电
  或不在离线环境里报错。
- 若把并发检查实现成无界重入，快速连续重启会叠加多个在途请求；single-flight 是必要性而非优化。
