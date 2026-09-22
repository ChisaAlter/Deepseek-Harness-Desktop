# Soft Home 发送与 Git 首屏 — 完全修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三张截图上的用户可见症状全部消失：Soft Home 发送后立刻进会话；Git 芯片在本地事实就绪后立刻显示真实分支；不再露出 `git.actionUpToDate`；对话 cwd 就是用户选的目录，不再被默默丢进隐藏 worktree。

**Architecture:** 把「本地 git 身份 / 打开已有工作树 / 离开 Soft Home」从「GitHub、fetch、新建 worktree、Grok ACP spawn」四条慢路径里拆出来。`checkout_status` 与 observer 首刷都只做本地 snapshot，GitHub 与 `git fetch` 在首包发出之后再跑。`gh` 必须有超时，避免后台 PR 探测把 coordinator 卡死。`/new` 发送复用已打开的 workspace 或 `openProject`，禁止默认 `createChisaCodeWorktree`。`createAgent` 仍可慢，但发生在会话页，不再挡首页。

## 一次说完：从点发送到三张图（同一事故）

用户在 Soft Home（`/new`）选了 `C:\Ai\ChisaCode`，芯片已经能显示 `cn-main`（来自更便宜的 `gitRuntime` / 旧 checkout，**不是** header 那条完整 snapshot），模型是 grokbuild 的 `grok-4.6`。输入「测试1」发送后，同一条路径按顺序发生：

```
点发送
  → pendingAction="chat"，Soft Home hero 不走（图 1）
  → ensureWorkspace.await getCheckoutStatus(所选目录)
       默认 getSnapshot(includeGitHub:true)
       本地 git <1s，然后串行 gh（无 timeout）+ 可能被 git fetch 锁
       本机 daemon 实测这条 RPC：30–53s
  → 因为 isGit，默认 createChisaCodeWorktree
       本次日志 6.5s，cwd 换成 ~/.chisacode/worktrees/.../bold-snail
  → submitWorkspaceDraft 才导航
  → 会话页 header 对【新 cwd】再打一次冷 checkout_status（又 30–37s）
       芯片文案：正在检查仓库（图 2）
  → 并行：create_agent ~15s；list_provider_features 14–46s；
       新 worktree 上 12 路 provider availability 各 30s timeout（另案，见下）
  → snapshot 终于回来：干净、跟 origin 同步、但是托管 worktree 且不在 base
       primary=null → 芯片渲染 t("git.actionUpToDate")（key 不存在）
       菜单出现「从 cn-main 更新」+「归档 worktree」（图 3）
```

三张图不是三个无关 bug。是 **一次发送被绑在「完整 GitHub snapshot + 默默建 worktree」上** 的三个表面。

## 修完本计划之后，你仍会看到（不是遗漏，是另一条机制）

这些出现在**同一段 daemon 日志**里，但不是 git 芯片 / Soft Home hero 的根因：

| 仍会看到                     | 日志实锤                                                                                  | 为什么不塞进本计划                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进会话后 composer 再转十几秒 | `create_agent_request` 15821ms                                                            | Grok ACP `initialize` / session spawn。导航已经结束，不挡图 1                                                                                                              |
| 新目录上 provider 探测 30s×N | `Failed to check provider availability` 对 bold-snail 连打 grok-4.5 / claude / grokbuild… | 已有专案 `docs/refactors/provider-probe-storm-2026-08-13.md`（阶段一+2a 已落地）。**新 worktree 仍会重探**；本计划先停掉默默建树，这条会轻一截，但 ACP 冷 spawn 不在本切片 |
| 打开编辑器列表偶发几十秒     | `list_available_editors_request` 70586ms                                                  | 与 Git 芯片无关                                                                                                                                                            |

如果要求「点发送后 composer 也立刻能打字、模型立刻 ready」，那是第二份计划，不要假装本计划会做到。

**Tech Stack:** TypeScript, Vitest, React Query, existing checkout/git services, i18n, packaged Electron gate.

## 完成定义（对照三张图）

| 截图                                            | 今天                                                                                                       | 修完必须变成                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 图 1 Soft Home 转圈                             | `/new` 发送先 `getCheckoutStatus`（带 GitHub/fetch，60s×重试）再可能建 worktree，整段停在 hero             | 点发送后数秒内离开 hero，进入带「测试1」乐观消息的会话。转圈若还在，只允许出现在会话页 composer，且不挡导航                          |
| 图 2 「正在检查仓库」数分钟                     | 顶栏等完整 snapshot；与 observer 的 `includeGitHub: true` 首刷共飞，再加 Query 默认重试                    | 本地 git 就绪即显示分支。禁止再转满 60s×3。GitHub/PR 可以后到                                                                        |
| 图 3 `git.actionUpToDate` + 菜单全废 + 像错分支 | 缺 i18n；idle 不显示分支；`/new` 默认建 worktree（`isChisaCodeOwnedWorktree` + 「从 cn-main 更新」+ 归档） | 芯片显示 `cn-main`（或「已是最新」）。cwd 是用户选的目录。干净主分支菜单可以没有主操作，但主按钮是分支名，不是 key，也不再像整组坏掉 |

**本次「完全」包含：** 图 1–3 全部用户可见症状。  
**本次「完全」不包含：** 把 Grok ACP initialize / MCP 冷启动修到秒级（另案 `provider-probe-storm`）。会话页 composer 仍可能转几十秒等 `agent_created`，但用户已经不在图 1。

## Global Constraints

- Protocol 保持向后兼容。不新增必填字段。复用服务端已有 `includeGitHub`。
- 不重启 6767 daemon。
- 只跑改动 Vitest：`npx vitest run <file> --bail=1`。禁止全量。
- 改完：`npm run typecheck`，`npm run lint -- <paths>`，`npm run format:files -- <paths>`。
- 桌面验收只用打包 Electron / win-unpacked。Web preview 不算桌面。
- 术语跟 `docs/glossary.md`：芯片显示 Branch，不发明 Repo 标签。

---

## 为什么「正在检查仓库」会到几十秒 / 数分钟

芯片文案是假的。它不是在「检测这是不是 git、当前分支是什么」。`isStatusLoading && !isGit` 时显示 `git.checkingRepository`，而这条 loading 要等完整 `checkout_status_response`。服务端 `getSnapshot()` 默认 `includeGitHub: true`，先跑完本地 git，再串行等 `gh`（`auth status` / `pr view` / `pr list` / GraphQL）。`gh` **没有 timeout**。同时 observer 第一次挂上仓库会立刻 `git fetch origin --prune`（timeout 120s），Windows 上会锁 `.git`，后面的 `status`/`rev-parse` 跟着堵，单条 git 默认 timeout 30s。

### 本机实测（2026-08-13，`C:\Ai\ChisaCode`，空闲）

| 步骤                                                                                                        | 耗时                           | 结论                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| `rev-parse` / `status` / `rev-list` / `diff --shortstat` / `worktree list`（snapshot 用到的本地命令，逐条） | 每条 38–71ms，合计 **< 600ms** | **本地 git 身份检测不是慢因**                |
| `gh auth status`                                                                                            | 1.2s                           | 已登录，本身不慢                             |
| `gh pr view`（`cn-main` 无 PR）                                                                             | **5.0s**                       | 必打 GitHub API；无 PR 也要等失败            |
| `gh pr list --head cn-main`                                                                                 | **3.1s**                       | view 失败后的 fallback                       |
| `gh repo view`                                                                                              | **3.7s**                       | fork 判断路径还会再打                        |
| `git fetch origin --prune`（空闲热缓存）                                                                    | 1.5s                           | 空闲快；冷启动 / 网络差可顶到 120s，并锁仓库 |

空闲时「本地 git + 一条 GitHub 路径」大约 8–12s，已经远超「读一下分支」。芯片却把这段整包叫成「检查仓库」。

### 用户当时的 daemon 实锤（`$CHISACODE_HOME/daemon.log` `ws_slow_request`）

同一台机器、打包桌面连 `localhost:6767`，`checkout_status_request` **反复**落到 30–53s，不是偶发：

| 时刻（log `durationMs`） | RPC                                 | 耗时               |
| ------------------------ | ----------------------------------- | ------------------ |
| 冷启动                   | `checkout_status_request`           | **53276ms**        |
| 另一次冷启动             | `checkout_status_request`           | **39209ms**        |
| 再一次                   | `checkout_status_request`           | **37422ms**        |
| 发送后（worktree 已建）  | `checkout_status_request`           | **37215ms**        |
| 再一次                   | `checkout_status_request`           | **29900ms**        |
| 同一次发送               | `create_chisacode_worktree_request` | 6460ms             |
| 同窗                     | `list_provider_features_request`    | 30–46s（并行争用） |

29.9s 贴着单条 git 的 **30s timeout**（fetch 锁仓库时，`status` 会空等到被杀掉）。53s 贴着客户端 `getStatus` 的 **60s timeout**。没有 per-span 日志能把那 53s 切成「哪一条 `gh`」，但本地 git 已证伪（<1s），剩下只能是：**GitHub/`gh` 无超时 + fetch 锁 + 和 provider probe 抢进程**。

### 为什么用户体感是「数分钟」而不是 30s

1. **Soft Home 先等一次完整 snapshot（30–53s）** 才 `createChisaCodeWorktree`（这次 6.5s），期间 hero 不走。
2. **导航后 cwd 换成隐藏 worktree**（日志里的 `...\worktrees\2uy72tsn\bold-snail`），header 对**新目录**再打一次冷 `checkout_status`（又 30–37s）。芯片继续转。
3. 客户端 `CheckoutSubscriptionClient.getStatus` timeout **60s**。`useCheckoutStatusQuery` **没关 retry**，TanStack 默认 3 次。一次挂死 → 最多约 **4×60s**。53s 那次几乎超时；再慢一点就是重试放大。
4. coordinator：observer 首刷已经 `includeGitHub: true` 在飞，后来就算要本地首包，也只能 join 同一条 promise，继续等 GitHub。

所以「检测 git 很久」是文案错误。真正的等待是：**把分支芯片绑在 GitHub PR 探测 + 后台 fetch 上，再在 /new 上连等两次。**

## 根因（复查后锁定）

1. **「新对话」= `/new`。** `resolveLeftSidebarNewConversationRoute` / 冷启动 Soft Home 都落这里。
2. **图 1 与图 2 是同一条 RPC，而且等的不是 git。** `ensureWorkspace` 先 `await getCheckoutStatus`；`handleCheckoutStatusRequest` 调 `getSnapshot()`，`normalizeRequest` 默认 `includeGitHub: true`。本机本地 git <1s；生产这条 RPC 30–53s，慢在 `gh`（无 timeout）和 `git fetch` 锁。
3. **observer 首刷会绑架首包。** `scheduleInitialWorkspaceRefresh` 用 `includeGitHub: true`。coordinator 在 in-flight 时直接返回那条 promise。即使后来请求 `includeGitHub: false`，仍会等 GitHub 那一飞。
4. **Query 默认 retry 3。** 60s 超时 × 最多 4 次 ≈ 数分钟。测试里关了 retry，生产 query 没关。
5. **`/new` 对 git 目录默认 `createChisaCodeWorktree`。** 图 3 菜单同时有「从 cn-main 更新」和「归档 worktree」，只在 `isOnBaseBranch === false` 且 `isChisaCodeOwnedWorktree === true` 时出现。用户选的是 `C:\Ai\ChisaCode`（本机 `cn-main`），对话却进了 `~\.chisacode\worktrees\...\bold-snail`。
6. **`git.actionUpToDate` 中英都未定义。** 干净同步时 primary 为 null，芯片显示 raw key。
7. **离开 Soft Home 的时机错了。** `/new` 的 `pendingAction` 绑在整个 `ensureWorkspace` 上。workspace 草稿页在 `SUBMIT` 后会藏 hero；`/new` 在导航前不会。

## File map

| File                                                                  | 职责                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/app/src/i18n/index.ts`                                      | `git.actionUpToDate` zh/en                                 |
| `packages/app/src/git/idle-chip-label.ts`                             | idle 文案纯函数                                            |
| `packages/app/src/git/workspace-actions.tsx`                          | 芯片用分支名                                               |
| `packages/app/src/git/use-status-query.ts`                            | checkout query `retry: false`                              |
| `packages/server/src/server/workspace-git-service.ts`                 | 首刷本地；fetch 在首包之后                                 |
| `packages/server/src/server/session-handlers/checkout-git-handler.ts` | peek 或本地 snapshot                                       |
| `packages/app/src/screens/new-workspace-ensure.ts`                    | `/new` 打开策略纯函数                                      |
| `packages/app/src/screens/new-workspace-screen.tsx`                   | 发送走 open，不建树                                        |
| `packages/app/src/git/policy.ts`                                      | 仅当测试暴露缺口时改；现有 base 分支已不含 merge-from-base |
| 各 collocated `*.test.ts`                                             | 行为锁                                                     |
| `packages/app/e2e/desktop-soft-home-git-first-paint.script.ts`        | 打包桌面门禁                                               |
| `docs/refactors/comprehensive-improvement-roadmap.md`                 | 登记本项                                                   |

---

### Task 1: 芯片文案 — 消灭 `git.actionUpToDate`

**Files:**

- Create: `packages/app/src/git/idle-chip-label.ts`
- Create: `packages/app/src/git/idle-chip-label.test.ts`
- Modify: `packages/app/src/i18n/index.ts`（zh `git` 约 1218，en 约 3208）
- Modify: `packages/app/src/git/workspace-actions.tsx`
- Modify: `packages/app/src/git/use-actions.ts`（把 `branchLabel` 从 `useGitActions` 暴露给 `WorkspaceGitActions`；若已暴露则只接线）

**Interfaces:**

- Consumes: `branchLabel: string`, `t("git.actionUpToDate")`
- Produces: `resolveIdleGitChipLabel({ branchLabel, fallback }) => string`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { resolveIdleGitChipLabel } from "./idle-chip-label";

describe("resolveIdleGitChipLabel", () => {
  it("prefers the current branch over the idle fallback", () => {
    expect(
      resolveIdleGitChipLabel({ branchLabel: "cn-main", fallback: "git.actionUpToDate" }),
    ).toBe("cn-main");
  });

  it("uses the translated fallback when no branch is known", () => {
    expect(resolveIdleGitChipLabel({ branchLabel: "  ", fallback: "已是最新" })).toBe("已是最新");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/app/src/git/idle-chip-label.test.ts --bail=1
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数 + i18n + 接线**

```ts
export function resolveIdleGitChipLabel(input: { branchLabel: string; fallback: string }): string {
  const branch = input.branchLabel.trim();
  return branch.length > 0 ? branch : input.fallback;
}
```

i18n zh：`actionUpToDate: "已是最新"`  
i18n en：`actionUpToDate: "Up to date"`  
两处都紧挨 `checkingRepository`。

`WorkspaceGitActions`：

```ts
const { gitActions, isGit, isStatusLoading, statusError, branchLabel } = useGitActions({...});
// isGit 分支：
idleLabel={resolveIdleGitChipLabel({
  branchLabel,
  fallback: t("git.actionUpToDate"),
})}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/app/src/git/idle-chip-label.test.ts --bail=1
```

Expected: PASS

---

### Task 2: checkout 首包与 observer 都本地优先

否则 Task 3 即使不再主动 `getCheckoutStatus`，进会话后顶栏仍会撞上 GitHub 首刷。

**Files:**

- Modify: `packages/server/src/server/workspace-git-service.ts`（`scheduleInitialWorkspaceRefresh`；fetch 时机）
- Modify: `packages/server/src/server/session-handlers/checkout-git-handler.ts`（`handleCheckoutStatusRequest`）
- Modify: `packages/app/src/git/use-status-query.ts`
- Test: `packages/server/src/server/workspace-git-service.test.ts` / `workspace-git-service.primitive.test.ts`（已有 initial / getSnapshot / fetch 用例，改期望而不是另起一套）
- Test: `packages/app/src/git/use-status-query.test.tsx`

**Interfaces:**

- Consumes: `peekSnapshot`, `getSnapshot(cwd, { includeGitHub: false, reason })`
- Produces: 首包本地 `WorkspaceGitRuntimeSnapshot`；GitHub 与 fetch 在 `latestSnapshot` 已有之后再跑，经 `checkout_status_update` 推送

- [ ] **Step 1: 写 / 改失败测试**

锁定这三条：

1. `scheduleInitialWorkspaceRefresh` / 首次 `registerWorkspace` 触发的 refresh，`includeGitHub === false`。
2. `handleCheckoutStatusRequest` 有 peek 时不 `getSnapshot`；无 peek 时 `getSnapshot(..., { includeGitHub: false })`。
3. `runGitFetch` 在第一次本地 snapshot notify 之前不被调用（或调用次数为 0，直到 snapshot 存在）。

现有 `workspace-git-service.test.ts` 里「getSnapshot populates github pull request state」改为：默认 / checkout-status 路径不要求 github；显式 `{ includeGitHub: true }` 或后续 queued refresh 才填 PR。

- [ ] **Step 2: 跑相关测试确认该红的红**

```bash
npx vitest run packages/server/src/server/workspace-git-service.test.ts --bail=1
```

- [ ] **Step 3: 实现**

`scheduleInitialWorkspaceRefresh`：

```ts
void this.refreshWorkspaceTarget(target, {
  force: false,
  includeGitHub: false,
  reason: "initial",
  notify: true,
});
```

本地 snapshot notify 成功后再 queue：

```ts
void this.refreshWorkspaceTarget(target, {
  force: false,
  includeGitHub: true,
  reason: "initial-github",
  notify: true,
});
```

`handleCheckoutStatusRequest`：

```ts
const peeked = this.context.workspaceGitService.peekSnapshot(resolvedCwd);
const snapshot =
  peeked ??
  (await this.context.workspaceGitService.getSnapshot(resolvedCwd, {
    includeGitHub: false,
    reason: "checkout-status",
  }));
```

`getSnapshot` 已有「非 force 且 `latestSnapshot` 存在则立刻返回」。peek 与这条合在一起，顶栏不应再等 GitHub。

Fetch：`WorkspaceGitCheckoutObservationAuthority.attachWorkspace` 延后到该 cwd 的 `latestSnapshot` 非空之后。不要在冷观察的第一微任务里和本地 snapshot 抢 `CHISACODE_GIT_CONCURRENCY`。

`useCheckoutStatusQuery` 的 `useQuery` 加 `retry: false`。不要改全局 `query-client.ts`。

`runGhCommand` / `execCommand("gh", …)` **必须带 timeout**（建议 8s，与空闲实测 5s `pr view` 同量级、远低于 30–53s 事故）。超时视为 GitHub 不可用：`githubFeaturesEnabled: false`，不得把整个 snapshot 打成失败。现有 `GitHubCliMissingError` / `GitHubAuthenticationError` 已经是这条降级；超时走同一出口。没有 timeout 的后台 `includeGitHub: true` 仍能把 coordinator 卡死，Task 2 不算完。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/server/src/server/workspace-git-service.test.ts --bail=1
npx vitest run packages/app/src/git/use-status-query.test.tsx --bail=1
```

Expected: PASS。若 handler 有更窄测试文件，一并跑。

---

### Task 3: `/new` 发送打开所选目录，禁止默认建 worktree

这是图 3「目录没有这条分支 / 归档 worktree」的根。

**Files:**

- Create: `packages/app/src/screens/new-workspace-ensure.ts`
- Create: `packages/app/src/screens/new-workspace-ensure.test.ts`
- Modify: `packages/app/src/screens/new-workspace-screen.tsx`（`ensureWorkspace` / `runCreateChatAgent`）

**Interfaces:**

- Consumes: session 里已有 workspace（按规范化 cwd）；Soft Home `checkoutStatusQuery.data`（只作诊断，不再挡发送）
- Produces:

```ts
export type NewWorkspaceSendOpenPlan =
  | { mode: "reuse-open"; workspaceId: string }
  | { mode: "open-existing" };

export function planNewWorkspaceSendOpen(input: {
  cwd: string;
  openWorkspaces: ReadonlyArray<{ id: string; workspaceDirectory: string | null }>;
}): NewWorkspaceSendOpenPlan;
```

发送路径 **不得** 返回 create-worktree。`createAndMergeWorkspace` 留在文件里给将来显式入口，`ensureWorkspace` 不再调用它。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { planNewWorkspaceSendOpen } from "./new-workspace-ensure";

describe("planNewWorkspaceSendOpen", () => {
  it("reuses an already-open workspace for the same directory", () => {
    expect(
      planNewWorkspaceSendOpen({
        cwd: "C:\\Ai\\ChisaCode",
        openWorkspaces: [{ id: "ws-1", workspaceDirectory: "C:/Ai/ChisaCode" }],
      }),
    ).toEqual({ mode: "reuse-open", workspaceId: "ws-1" });
  });

  it("opens the selected directory instead of creating a worktree", () => {
    expect(
      planNewWorkspaceSendOpen({
        cwd: "C:\\Ai\\ChisaCode",
        openWorkspaces: [],
      }),
    ).toEqual({ mode: "open-existing" });
  });
});
```

cwd 比较必须用与 checkout 相同的规范化（`normalizeCheckoutCwd` 或 workspace id 规范化），Windows 大小写与斜杠要视为同一目录。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/app/src/screens/new-workspace-ensure.test.ts --bail=1
```

- [ ] **Step 3: 实现 `ensureWorkspace`**

伪代码：

```ts
const plan = planNewWorkspaceSendOpen({ cwd: input.cwd, openWorkspaces });
if (plan.mode === "reuse-open") {
  const existing = openWorkspaces.find((w) => w.id === plan.workspaceId);
  if (existing) return existing;
}
return openAndMergeWorkspace({ client, cwd: input.cwd, mergeWorkspaces, serverId });
```

删除发送路径上的：

```ts
await connectedClient.getCheckoutStatus(input.cwd)
createAndMergeWorkspace(...)
```

`openProject` 对已登记目录应是幂等的；reuse-open 是为了连这次 RPC 都不挡 Soft Home。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/app/src/screens/new-workspace-ensure.test.ts --bail=1
```

Expected: PASS

---

### Task 4: Soft Home 导航不再绑在慢 create 上

Task 3 让 `ensureWorkspace` 变快之后，`pendingAction` 仍会罩住整个 `runCreateChatAgent`（ensure + 写 pending + 导航）。导航必须发生在 `createAgent` 之前——现有 `submitWorkspaceDraft` 已经如此。本任务只锁「ensure 之后立刻导航，create 在目标页 auto-submit」。

**Files:**

- Modify: 仅当 `runCreateChatAgent` / `handleSubmitNewWorkspace` 仍在导航前做多余 await 时改 `new-workspace-screen.tsx`
- Test: `packages/app/src/composer/draft/workspace-tab-core.ts` 已有 auto-submit watchdog；补一条「有 model 时不等模型 loading」若缺失

**Interfaces:**

- Consumes: `submitWorkspaceDraft`（已存在）
- Produces: `/new` 发送：`ensureWorkspace`（快）→ `submitWorkspaceDraft`（同步导航）→ 返回。`createAgent` 只在 workspace 草稿的 auto-submit 里发生。

- [ ] **Step 1: 读 `runCreateChatAgent`，确认导航后没有再 await create**

今天它只 `ensureWorkspace` + `submitWorkspaceDraft`。Task 3 之后若仍先 `getCheckoutStatus` 或 `createChisaCodeWorktree`，本任务视为未完成。

- [ ] **Step 2: 若 `pendingAction` 在导航后因未清而把用户留在 `/new`**

导航成功后必须 `setPendingAction(null)` 或直接 unmount `/new`。用现有 router 行为：`navigateToPreparedWorkspaceTab` 离开 `/new` 即够。加回归：ensure resolve 后 `submitWorkspaceDraft` 被调用一次，且测试里没有 `createAgent`。

把「ensure 之后调用 submit、不调用 createAgent」写成 `new-workspace-ensure.test.ts` 的编排函数测试，或给 `runCreateChatAgent` 抽依赖注入（只在必须测时抽，禁止为了测而把 screen 变成神类）。

- [ ] **Step 3: workspace 草稿页**

`isSoftHomeEmpty = !(isSubmitting && draftAgent)` 已在 `SUBMIT` 后藏 hero。不要改这条公式。auto-submit 在有 model 时不得再等 provider snapshot（`shouldWaitForDraftModelReadiness` 已是 false）。补测若还没有：

```ts
expect(
  shouldWaitForDraftModelReadiness({
    autoSubmitConfig: { provider: "grokbuild", model: "grok-4.6" },
    isModelLoading: true,
  }),
).toBe(false);
```

```bash
npx vitest run packages/app/src/composer/draft/workspace-tab-core.test.ts --bail=1
```

---

### Task 5: Git 菜单「不像坏掉」（主分支 / 误 worktree 消失后）

Task 3 之后，选 `C:\Ai\ChisaCode` 的对话不应再带「归档 worktree」。干净 `cn-main` 上 `buildGitActions` 已是 `primary: null` + secondary `pull/push/pull-and-push`（点了 toast「已是最新」）。主按钮改为分支名后，这可接受。

- [ ] **Step 1: 在 `policy.test.ts` 锁住主分支菜单形状**

已有 `isOnBaseBranch: true` → secondary 只有 pull/push/pull-and-push、不含 merge-from-base。补一条：`isChisaCodeOwnedWorktree: false` 时不含 `archive-worktree`（若已有则保持）。

- [ ] **Step 2: 不改菜单信息架构，不加 HTML 原型**

这不是新布局。若 Task 3 后实机仍出现「归档 worktree」，说明 cwd 仍是托管 worktree——回到 Task 3，不要在菜单上遮。

```bash
npx vitest run packages/app/src/git/policy.test.ts --bail=1
```

---

### Task 6: 门禁与证据

- [ ] `npm run typecheck`
- [ ] `npm run lint --` 全部改动文件
- [ ] `npm run format:files --` 全部改动文件
- [ ] 聚焦 vitest（只这些）：

```bash
npx vitest run packages/app/src/git/idle-chip-label.test.ts --bail=1
npx vitest run packages/app/src/git/use-status-query.test.tsx --bail=1
npx vitest run packages/app/src/git/policy.test.ts --bail=1
npx vitest run packages/app/src/screens/new-workspace-ensure.test.ts --bail=1
npx vitest run packages/app/src/composer/draft/workspace-tab-core.test.ts --bail=1
npx vitest run packages/server/src/server/workspace-git-service.test.ts --bail=1
```

- [ ] 登记 `docs/refactors/comprehensive-improvement-roadmap.md`：问题、切片、门禁、状态。
- [ ] 打包桌面实机脚本 `packages/app/e2e/desktop-soft-home-git-first-paint.script.ts`（或扩现有 desktop gate），断言：
  1. 新对话 → 目录 `C:\Ai\ChisaCode` → 发送后离开 Soft Home hero（`soft-home-hero` 消失）上限 **8s**（不含 Grok 全文）。
  2. 顶栏 Git 芯片文本在 **8s** 内变成 `cn-main` 或「已是最新」，**禁止** 子串 `git.actionUpToDate`。
  3. `git worktree list` 不因这次发送新增 `~/.chisacode/worktrees/...`。
  4. 会话 header 路径对应 `C:\Ai\ChisaCode`，不是 worktree slug。
- [ ] 重建顺序：`expo export`（`CHISACODE_WEB_PLATFORM=electron`）→ `packages/desktop` `tsc` → `electron-builder --win --x64 --dir`。刷新桌面 `ChisaCode.lnk` 后再跑脚本。
- [ ] 证据写进 `.omo/evidence/desktop-soft-home-git-first-paint-<timestamp>.md`。

---

## 明确不做

- 不把 Grok ACP `initialize` / MCP 等待从 `createSession` 里拆走（另案 `provider-probe-storm`）。
- 不修 `list_available_editors` 70s。
- 不删除后台 `git fetch`；只是挪到首包之后。
- 不在本计划加「新建 worktree」按钮。`createChisaCodeWorktree` 代码保留，发送不用。
- 不做 Git 芯片视觉重做，不先做 HTML 原型。
- 不改协议必填字段，不加新 RPC。
- 不给 checkout_status 加 per-span 日志（有用，但不是图 1–3 的完成门槛）。

## 对抗审查（已打进任务，不要再降级）

| 降级                                                       | 为什么算没做完                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| 只补 i18n                                                  | 图 1/2 的数分钟还在                                        |
| 只改 handler 的 `includeGitHub: false`，不改 observer 首刷 | coordinator 仍返回 in-flight 的 GitHub 那一飞，图 2 还在   |
| 关掉 retry 但不给失败芯片                                  | 一次超时变死芯片；必须走已有 `git.refreshFailed`           |
| `/new` 仍 `createChisaCodeWorktree`                        | 图 3 的归档 / 「从 cn-main 更新」 / 「目录没有这分支」还在 |
| 用「菜单里灰掉归档」掩盖错 cwd                             | 治标。必须停在用户选的目录                                 |
| 声称桌面已修但只跑了 web                                   | 违反桌面门禁                                               |
| 把 Grok 冷启动塞进本计划当完成门槛                         | 范围膨胀；会话页转圈可接受                                 |

## 切片顺序

1 → 2 → 3 → 4 → 5 → 6

1 可与 2 并行。3 依赖「不再需要 checkout 来决定建不建树」。4 依赖 3。6 最后。
