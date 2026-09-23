# Decision: Git 标题栏一次刷新只读一次工作树上下文

Status: proposed

中文 | [English](2026-09-22-git-refresh-read-context.en.md)

## Problem

标题栏的 `refresh()` 在同一次用户可见动作里连发三条 IPC：`shell:git-status`、
`shell:git-fetch-status`、`shell:git-read-pr`。三条各自独立地走
`src/main/git.js::gitStatus()`，每条都重新探测仓库、跑 `status --porcelain=v2 --branch`、查
remote / 默认分支 / provider、再跑 `readWorkingTreeNumstat()`。典型
`main + origin + upstream` 仓库的一套约 8 个串行 git 子进程，三条约 24 个，还没计入真正的
`git fetch` 与 `gh pr list`。窗口 focus 也会触发刷新，只有 250 ms debounce 挡在最前面。

这些子进程是异步的，没有 `execSync` 卡住主线程；代价在进程风暴、working tree 被反复读取，
以及端到端延迟随仓库规模放大。用户看到的症状是标题栏状态胶囊延迟更新，而不是界面冻结——因此
「改成并发」不是答案，减少**重复**才是。

## Proposal

在主进程引入一个短生命周期的 `GitReadContext`，让一次刷新内的多条 IPC 复用同一份读取结果。

实现落在 `src/main/git-read-context.js`，复用**不是**通用 `runGit()` 的隐式行为：`runGit()`
永远走未缓存的真实子进程，缓存只通过调用方显式传入的 `run` seam 生效。
`readGitStatus(root, run)`、`readWorkingTreeNumstat(root, run)`、`resolveCurrentUpstream(cwd, run)`、
`fetchForStatus(cwd, readRun)`、`lookupOpenPullRequest(cwd, refName, readRun)`、
`readPullRequest`、`resolveBranchHeadContext(cwd, refName, readRun)` 各自接收该 seam。

上下文键是 **owner + worktree root**，不是「当前工作区」这一全局单例：`armReadContext(owner, root)`
开启一次刷新窗口，`acquireReadContext` / `touchReadContext` 在该窗口内命中，`invalidateReadContext`
按 root 撤销。TTL 是 idle 2 秒**滑动**窗口，外加 `armedAt` 起的绝对 30 秒上限——`touchReadContext`
在每次工作开始时续 idle 窗口，但**不能**突破绝对上限，因此一次慢 fetch 可以继续复用同一份读取
结果，而过期的窗口一定失效。

缓存只覆盖只读白名单。`isReadOnlyInvocation()` 按完整命令形式判定：`remote` 仅裸列举、`-v`、
`get-url`、`show` 可缓存；`symbolic-ref` 仅单操作数读取可缓存。`config` 与其它设置型子命令一律
视为写。`git` 的写路径（init / commit / push / pull / stage / unstage / discard / switch / create /
publish / `remote add` / `gh repo create`）在**写之前**先 `invalidateReadContext`，返回后（含失败与
部分成功）再清一次并 revoke，因此失败的写不会留下可命中的写前读数。

`gh` 调用始终走普通 `run()`，**绝不**把 `context.run` 传给 `gh`：PR 查询是外部进程，不属于 Git
读取上下文。

`gitStatus(cwd, owner)` / `gitFetchForStatus(cwd, owner)` / `gitReadPullRequest(cwd, owner)` 的
owner 由 IPC 传 `event.sender.id`，所以两个窗口不会互相命中对方的窗口。`statusForRoot()` 内部
走快路径，避免每次读都重新枚举全部授权根；每次 IPC 仍先做一次授权与路径保护。
渲染端 IPC 入参与返回结构保持兼容：这是主进程内部的协调器替换，不是通道形状变更。

## Alternatives considered

- **让渲染端把 status 结果回传主进程当缓存** — rejected：那等于让 renderer 提交的「已验证
  快照」成为主进程读取的唯一依据，越权与陈旧两条风险同时上升。上下文必须由主进程自己建立。

- **把三条 IPC 合并成一条 `shell:git-*` 聚合调用** — deferred：会同时改动 vendor `ui-git`
  的调用面，超出 `git-titlebar` 卡的 Allowed touch（该卡明确写了 vendor 改动需明示扩围）。
  先做不改通道形状的内部协调，收益已经覆盖主要成本。

- **在渲染端把三条请求串行化以「避免并发」** — rejected：串行化只是让进程风暴晚一点发生，
  延迟更差；问题在重复读取，不在并发本身。

- **把 numstat 从状态读取里彻底去掉，改成按需拉取** — rejected：`workingTree` 的文件级
  插删行数是现有标题栏契约的一部分，去掉会让胶囊与 diff 概览退化。复用同一份 numstat，
  而不是取消它。

- **让 `runGit()` 自己查「当前工作区」的全局缓存** — rejected（已实现并推翻）：这会让缓存
  命中依赖调用顺序而不是调用方意图，重叠刷新、写操作或超过窗口的 fetch 都会让不同刷新读到
  对方的中间状态。缓存改为显式 `run` 参数。

- **给 status 加长 TTL 缓存（秒级）** — rejected：外部 Git 修改（用户在自己终端里
  commit / checkout）会让长 TTL 显示陈旧分支与错误的工作树。上下文生命周期是**一次刷新**，
  不是一段时间；2 秒 idle + 30 秒绝对上限只是让「一次刷新」能跨越慢 fetch。

- **写操作成功后失效即可** — rejected（已实现并推翻）：失败与部分成功的写同样改变了磁盘
  状态（例如 `remote add` 已写入配置但后续步骤失败）。失效必须发生在写命令启动**之前**，
  并在 settle 后清第二次，才能做到 fail-closed。

## Acceptance criteria

- 固定夹具 `main + origin + 有效 upstream` 下，一次 refresh 的完整 porcelain 调用 ≤ 1、
  numstat 调用 ≤ 1；无真实 fetch 时该 worktree 的本地 git 子进程总数目标 ≤ 6。
- 相对同夹具基线，子进程数减少至少 50%（上一轮「约 24 个」只是路径估算，先记录实际基线）。
- 连续 focus burst 不产生无界并发查询；同一 worktree 的并发读合并且只跑一份状态。
- 写操作后第一次读能看到新状态（不得返回写前缓存），写失败与部分成功同样不得留下可命中读数。
- 不同 owner 打开的两个窗口不共享读取上下文；同一 owner 的不同 worktree root 也不共享。
- fetch 超过 idle 窗口但未超过绝对上限时，该次刷新的后续读仍命中同一上下文。
- `symbolic-ref` 设置型调用与 `remote add/set-head` 不被当成可缓存读；`gh` 不接收 `context.run`。
- 既有的授权、`.git` 包含判定、`--porcelain=v2` 解析、unborn / detached HEAD、无 origin、
  多 remote、缺 upstream 的既有用例全部保持通过。

## Risks

- 陈旧上下文是最主要的风险面：跨 worktree 污染、跨 owner 污染、未登记路径复用、写操作后仍
  读旧值。用「owner + worktree root 隔离、写前失效、绝对上限」三条硬规则约束，而不是靠 TTL。
- fetch 失败必须保留本地状态；不能因为远端刷新失败把 working tree 读数一起抹掉。
- 同名不同 fork 的分支不能靠 branch 名单独作为 PR 缓存键，需带上 remote 身份（现有
  `gitReadPullRequest` 已拼接 `headRemoteUrlKey`，本次不能弱化）。
- `activeContexts` 是模块级 Map，靠 idle + 绝对上限双重到期回收；若将来把上限调大或加入
  长驻条目，必须在长会话里重新评估陈旧条目与内存。
