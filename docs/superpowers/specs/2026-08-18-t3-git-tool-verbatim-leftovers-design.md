# Git 工具：把不是必须自写的改回 T3

标题栏 Git 工具已经按 T3 迁过 porcelain v2、`workingTree`、`prepareCommitContext`、`GitActionsControl.logic.ts` 状态机。本设计只处理**还留着的、没有正当理由的自写**。不新开产品能力。

视觉语言仍是官方 `dsh web`：`ui-primitives` 与 `--dsw-alias-*`。T3 的 lucide / shadcn / Tailwind / `@pierre` 不能贴过来。见 [design-language.md](../../design-language.md)。

T3 对照源：

- `C:\Ai\t3code\apps\web\src\components\GitActionsControl.tsx`
- `C:\Ai\t3code\apps\web\src\components\GitActionsControl.logic.ts`
- `C:\Ai\t3code\apps\server\src\git\GitManager.ts`
- `C:\Ai\t3code\packages\contracts\src\git.ts`

## 必须自写（本轮不改掉）

1. **皮肤。** Harness 对话框、菜单、进度卡。T3 JSX 不落地。
2. **传输。** Electron `runGit` + IPC，不是 T3 Effect RPC。换壳，不换 git argv / 解析器。
3. **Windows 叠加。** NTFS 保留名、`add -A` 失败后对非保留 porcelain 路径重试、gone upstream（porcelain v2 省略 `# branch.ab`）、`aheadUnreliable`（`rev-list` 失败不当成 ahead）。T3 没有这些。
4. **i18n。** 产品文案中文；标题栏主按钮标签两边都保持 T3 英文。默认分支确认继续用 `resolveDefaultBranchActionDialogCopy` 的 T3 英文句子（与主按钮同一套英文）。不在本轮把确认框改成另一套缩短文案。

## 不是必须自写（本轮改回 T3）

1. **提交对话框文件列表是打开时的快照。** T3 绑定活的 `gitStatusForActions.workingTree.files`。打开之后 status 刷新，列表要跟着变。不要 `useState` 再拷一份。
2. **`VcsStatus.workingTree` 写成可选。** T3 contracts 里它是必有字段。桌面 `gitStatus` 已经总是返回它。类型改成必有；测试 helper 补上空树。
3. **Create PR 禁用理由多读了 `aheadOfDefaultCount`。** T3 `getMenuActionDisabledReason` 只看 `aheadCount > 0`（`if (!isAhead)`）。无 upstream 时 ahead 已经写进 `aheadCount`。用户可见字符串继续用 `branch`，不要贴 T3 漏出来的 `refName` 类型名。
4. **Toast CTA 用 `supportsGitHubChangeRequests` 挡住 Create MR。** T3 `GitManager` 在非默认分支 push 成功后总是给 `Create ${shortLabel}`。菜单已经对每个 provider 展示 Create PR/MR。CTA 同样不按 GitHub 过滤。非 GitHub 上点下去仍由 `gitCreateChangeRequest` fail-closed。`supportsGitHubChangeRequests` 若再无生产调用则删掉。
5. **死代码 `shortStatusPath`。** `-sb` 时代的路径解析，无调用者。
6. **`gitReadPullRequest` / `lookupOpenPullRequest` 再跑一遍 `git status -sb`。** 标题栏 status 已经是 porcelain v2。PR 查找用已有 `gitStatus.refName`（或调用方传入的 ref），不要第二套 short-status 头解析。
7. **`gitChangedFiles` IPC。** T3 没有这个 API。提交对话框不该再注入它。Diff 面板走 `gitStatusEntries` / `gitDiff`。删掉 titlebar 注入、preload、IPC、`git.js` 实现，以及只为它服务的 `parseNumstat` / `countUntrackedInsertions`。提交后残留文件用 `gitStatus().workingTree.files` 断言。

## 本轮不做（下一刀，不是皮肤逼出来的重写）

- GitLab `glab` / Bitbucket / Azure 真正创建变更请求。
- T3 式 Publish 向导（Provider → 路径 → 可见性 → ssh/https → remote 名）。现在仍是 `gh repo create` 或粘贴 URL。
- 分支工具：T3 `switchRef` / `createRef` / 分页。桌面仍是 `checkout --ignore-other-worktrees` 与 `checkout -b`。
- 线程 ↔ 分支、worktree。
- 右侧栏 Files / Diff / Browser / Terminal。

## 验收

- 提交对话框文件列表等于当前 `status.workingTree.files`，打开后 focus 刷新会换行。
- `VcsStatus.workingTree` 在 `git-logic.ts` 为必有。
- `getMenuActionDisabledReason` 对 Create PR 只在 `aheadCount === 0` 时说没有本地提交。
- `resolveCompletionCta` 在非默认分支 push 成功后给出 `Create ${shortLabel}`，不看 provider kind。
- `src/main/git.js` 与 `src/main/git-pullrequest.js` 不再生成 `git status -sb`。
- 仓库里没有 `gitChangedFiles` / `shell:git-changed-files`。
- 皮肤、IPC 壳、Windows 叠加、fail-closed 的 `gh` 创建路径保持原样。
