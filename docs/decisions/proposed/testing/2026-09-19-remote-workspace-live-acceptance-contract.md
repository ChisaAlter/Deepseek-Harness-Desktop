# Decision: 远程工作区实时验收脚本的「非运行」契约

Status: proposed

中文 | [English](2026-09-19-remote-workspace-live-acceptance-contract.en.md)

## Problem

`scripts/verify-remote-workspace-live.cjs` 是 `remote-workspace` 的 opt-in 实机验收门禁，但它当前把三类**非运行**状态当作验收通过：readiness 探测只判对象真值、不检查 `ok` 与 cookie；探测返回的 cookie 被丢弃后重新调用一次性 launch token 兑换；缺少 SSH 配置时打印 SKIP 并以 0 退出。

这让「没跑」「半跑」「探测失败」都可能落在绿色结论里，削弱了人工验收与自动报告之间的信任边界。同一脚本还带着与产品路由不一致的调用序列：`/home`、`/current`、`/machines`、`/mirror` 与 `/fs` 都只接受 POST，runner 却默认发 GET 并只看状态码；它创建的是 `dirName`，却把另一个 `mirrorName` 交给要求目标目录已存在的 `/mirror`；teardown 又在远端 fixture 清理**之前**清空当前机器，导致后续 `/fs` 删除必然失败。只注入失败的夹具无法暴露这些缺陷。

同一轮 guard 代码还暴露了一个运行时相关的假通过：`deadlineSignal()` 曾调用 `timer.unref?.()`。当 deadline 计时器是事件循环里**唯一被引用的 handle** 时，Node 22 会在 deadline 触发前抽干事件循环，`node:test` 随之取消仍在 pending 的用例，并级联成 18 个 cancelled 用例；同一份代码在 Node 26 上不复现，因为它保活 harness 的方式不同。于是「deadline 还能不能收敛」当时取决于运行时版本而非契约本身——这正是该回归必须做成确定性、与运行时无关的原因。

## Proposal

把该脚本的验收契约收紧为三个可观察规则：

1. readiness 只在 `ok === true` 且 cookie 非空时进入验收；否则走 failure path。
2. 每次运行最多兑换一次一次性 launch token；后续请求复用 readiness 返回的同一 cookie。
3. 新增 `--require-live`：缺必需 SSH 配置时以非零退出；不带该 flag 仍保留软跳过，但输出明确写出 `NOT RUN (not PASS)`。
4. 验收 runner 必须 import-safe，并在自有 fixture 根内完成写/镜像/删除；请求、响应体与整体运行都有 bounded deadline；spawn 失败、child 提前退出、清理失败与原始失败分别报告。端口不得固定占用，临时 HOME 必须在 owned child 停止并 await 后再删。
5. runner 按产品真实契约调用路由：方法由显式 route→method 表决定（mutating 路由一律 POST，不为迁就脚本改产品路由）；mirror 目标就是本次运行自己 `mkdir` 出来的目录，并附带「镜像不存在目录必须被拒」的负例；teardown 顺序固定为 远端 fixture 清理 → deselect/delete 机器 → 停止 child → 删除本地 HOME，deselect 之后不得再对远端做写操作。
6. 三类 mutating cleanup（远端 fixture 删除、machine deselect、machine delete）必须校验**预期成功响应体**，不能只看 `status === 200`。HTTP 200 搭配 `ok:false`、缺失 JSON 或畸形 JSON 一律记为 cleanup failure；只有在语义校验通过后才允许记录 `remote-fixture-cleanup` / `machine-deselect` / `machine-delete` ledger 或打印 “removed”。把 200 单独当作成功会让清理失败被记进成功账本。
7. 测试 fixture 的期望 route→method 表必须**独立于 runner 导出的 `API_METHODS`**，并对未知路由直接拒绝：若 oracle 与实现共享同一张表，一处表项写错会同时改变实现与判据，测试无法发现。另需一个独立负例钉住该不变量（GET `/dsh-remote/home` 必须被拒）。
8. 成功路径本身必须有夹具覆盖：断言 `result.ok === true`、每个请求都用了路由文档声明的方法、fixture 目录已删除、teardown 顺序与 HOME 已移除；`stopChild` 失败时保留 HOME 并报告其位置，而不是在可能仍存活的 child 下删目录。原始失败与 cleanup 失败必须分别报告。
9. guard 的 deadline 计时器必须保持**被引用**：`deadlineSignal()` 不再调用 `timer.unref?.()`，源码就地写明该 handle 为何不能 unref；计时器仍由 `withDeadline()` 的 `finally` 清除，因此不会活过它守护的操作。
10. 新增确定性回归（`deadlineSignal keeps the event loop alive with no other referenced handle`）：在**没有其他被引用 handle** 的子进程里只创建 `deadlineSignal(undefined, 25)` 并挂一个 abort 监听器，由监听器打印 JSON 完成标记；父进程断言 exit code 0、标记非空、`name === 'TimeoutError'` 且 `elapsed >= 20`，并额外用父侧 watchdog 在 child 始终不结算时判失败。

同时把配置解析与 readiness 断言抽到依赖-free 的 guard seam，以便用 `node:test` 覆盖单次兑换、`ok:false`、配置矩阵与两种跳过语义；runner 本身的子进程 exit code、端口、stall、early-exit 与 cleanup 行为由 runner-level test 覆盖。真实 SSH 仍保持 opt-in。

## Alternatives considered

- **继续用对象真值判断 readiness** — rejected：`{ ok: false, cookie: '' }` 是失败而非成功，truthiness 会把探测失败静默放行。
- **readiness 后再 redeem 一次 token** — rejected：launch token 是一次性的，第二次兑换既可能失败，也违背了「一次运行一次兑换」的语义。
- **缺配置时统一非零退出** — rejected：会破坏现有「opt-in local run」工作流；用显式 `--require-live` 区分软跳过与强制门禁更精确。
- **把真实 SSH 端到端纳入默认测试** — rejected：live 脚本依赖外部机器与凭据，必须保持 opt-in；本次只固定非运行语义与可单测 seam。
- **保留 `timer.unref?.()`，用固定 Node 版本绕开** — rejected：Node 22 会在 deadline 触发前抽干事件循环并取消 pending 用例，Node 26 又因 harness 的保活方式不同而假通过；把正确性寄托在运行时版本上等于没有契约。
- **只在父进程中用 watchdog 断言，不起真实子进程** — rejected：父进程自身持有事件循环 handle，无法复现「deadline 是唯一被引用 handle」这一前提，只有子进程能把这个前提放进测试。

## Acceptance criteria

1. `node --test scripts/remote-workspace-live-guard.test.mjs scripts/verify-remote-workspace-live.test.mjs` 在 Node 22.22.2 与 Node 26.7.0 上**都是 29/29 全绿**（9 guard + 20 runner，较上一版 +1 条 deadline 回归），覆盖配置 present/absent 矩阵、`--require-live`、`ok:false`/空 cookie、单次 token 兑换、runner exit code、端口占用、stalled request/body、child 提前失败、run 级 abort 贯穿启动阶段（真实链路，探针内部超时显著长于取消触发）、并发 fixture 隔离、cleanup 失败、三类 cleanup 的 HTTP 200 + `ok:false` / 缺失 JSON / 畸形 JSON 负例、**完整成功路径**（方法断言 + teardown 顺序）、独立 fixture 路由表对 GET `/dsh-remote/home` 的拒绝、`assertInsideRoot` 拒绝 traversal 与非法绝对形式、无其他引用 handle 时 deadline 仍触发并保住事件循环，以及 `stopChild` 失败时保留 HOME。
2. 缺少 SSH 配置时不带 `--require-live` 退出 0，并打印含 `NOT RUN (not PASS)` 的说明；带 `--require-live` 时退出 2。
3. readiness 失败、后端异常、child 提前退出与正常完成四条路径都仍执行 child stop 和临时 HOME 删除（除非确认 child 未停止）；远端清理只在 run-owned fixture 内进行，且发生在 deselect 之前；原始失败与 cleanup 失败分开报告。
4. feature card 的 Gates 行明确该脚本为 opt-in；真实 SSH 往返未在本轮执行时不得记作 PASS。
5. 测试夹具必须自行隔离：每个用例独享 `mkdtemp` HOME 并及时清理，不得复用固定路径写入真实用户目录；每轮运行结束后工作区外的临时目录不得新增残留。
6. deadline 回归必须在**无其他被引用 handle** 的真实子进程里执行，并对该缺陷敏感：还原 `timer.unref?.()` 后该用例以 `child produced no completion marker; the deadline never kept the loop alive` 失败（已做变异验证）。该结论只钉住 guard 库自身的 deadline 契约，不声称证明了产品的进程生命周期行为。

## Risks

- 软跳过仍会退出 0；依赖方若不传 `--require-live`，只能从 `NOT RUN (not PASS)` 文案区分，不能仅看退出码。
- 本轮不运行真实 SSH，因此新增 guard/CLI 语义已验证，但远端驱动链路的实机健康仍未重新确认。
- readiness 返回 cookie 的契约若未来改变为空字符串或改名，guard 会按失败处理，需要同步更新该 seam 与测试。
- 夹具对 cleanup 已改为语义判定，但**非 cleanup 的断言**（例如 `fixture.mkdir`、`write`、`mirror`）仍按状态码加 `ok === true` 判定；若插件改为其他成功表达方式，这些调用点需要同步收紧。
- 语义 cleanup 校验只在 live 运行时才会真正打到产品响应；本轮未跑真实 SSH，因此该分支的实机行为仍属 pending validation。
- runner 的 `API_METHODS` 与 fixture 的 `PRODUCT_ROUTE_METHODS` 现在是两份各自维护的表，产品路由变更时必须同时更新，否则会出现实现与判据分叉（已被独立负例部分兜底）。
- 符号链接逃逸无法在没有远端往返的前提下检测；当前契约只保证调用方自己的 fixture 路径不出根。
- deadline 回归证明的是 guard 库自身的契约——`deadlineSignal` 在没有其他被引用 handle 时仍保活事件循环；它不证明产品进程（Electron 主进程、runner 子进程等）的生命周期行为，那些仍需要各自的检查。
- 计时器改为被引用后，未来若有调用方创建了 deadline 却忘记 `clear()`（或绕过 `withDeadline()`），该 handle 会拖住退出；目前所有内部使用都经过 `withDeadline()` 的 `finally`。
