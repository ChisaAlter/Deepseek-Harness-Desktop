# Agent Note: 标题栏 Git 进度卡片

Status: implemented

[English](2026-08-16-git-action-progress-toast.md) | 中文

## 问题

堆叠 Git 操作（Commit, push & PR、Push、Pull）会跑带 leftover hook 的 `git commit` / `git push`，可能持续数十秒。标题栏没有实时状态，结束后才弹出阻塞弹窗并倒出整段 hook 日志。

## 决策

`GitProgressToast` 是 `ui-git` 包内的进度卡片，只用 `--dsw-alias-*` token。官方 `Toast` 原子是顶部居中、3 秒淡出，撑不过一段 hook，因此 Git 进度不走它。

`GitActionsControl` 在点击堆叠操作、Pull 或 Initialize Git 的同一拍打开卡片，不等任何 IPC 返回。堆叠 Commit/Push/PR 用上次已知 status 拼阶段文案并立刻出卡，再重读状态（push/create_pr 走 `gitFetchForStatus`，仅 commit 走本地 `gitStatus`）。堆叠动作占用 `busy` 时 `BranchMenu` 为 `disabled`，切换或新建不能改写正在进行的 commit、push 或 PR。桌面 `gitCommit` / `gitPush` / `gitPull` 把清洗后的 stdout/stderr 行通过 `shell:git-progress` 按 `actionId` 推过来，并跟踪 `GIT_TRACE2_EVENT`，在 `child_start` 上改标题。`child_exit` 先读 Git 生产字段 `exit_code`（再回落到 `exitCode` / `code`），失败 leftover hook 才能改成 `hook exited N`。`hook_finished` 清掉最后一行并回到当前阶段标题。这三条命令按 `COMMIT_TIMEOUT_MS` 等待 10 分钟；`gitPull` 是 `git pull --ff-only`。git 子进程继承去掉 Electron `npm_config_electron_*`、也不带 `GIT_CEILING_DIRECTORIES` 的环境。成功标题只描述实际跑过的动作。Push/PR 的成功 CTA 等动作后的 fetch 与 PR 查找落定再算，因此默认分支上切功能分支继续可以给出 Create PR，推到已有 PR 的引用可以给出 View PR。仅提交的成功卡片用本地 porcelain，不被 fetch 或 `gh` 挡住。失败留到关闭。复制写入整段 dump。显示详情保留短标题，并在下方展开其余 dump；dump 与标题相同时不出现该控件。`gitFailureMessage` 返回去掉 CRLF 警告的完整 dump（含 `hint:` 行），而不是只取一行标记。初始化、分支切换/新建、以及打开文件失败都落在同一张卡片上。

默认分支确认只在动作包含提交时提供 Checkout feature branch & continue。仅推送或仅建 PR 时拒绝切功能分支；`resolveDefaultBranchActionDialogCopy` 仍带 T3 的功能引用后缀。功能分支提交先发 `Preparing feature ref...`，空消息时再发 `Generating commit message...`，然后 `Committing...`；`includeBranch` 向模型要 `branch`，没有则回落到净化后的 subject。

空的提交与 PR 文案在配置了桌面 API key 时走 DeepSeek chat，请求失败则整单失败；没有 key 时用 staged name-status / 范围启发式。客户端不把 commit subject 当作 PR 标题；`gitCreateChangeRequest` 先发 `Preparing PR...`，再按范围生成，并拒绝脏工作区。PR 模板从已提交的 base 树读取（`ls-tree` + `cat-file blob`）；模板目录有多份 `.md` 时不用模板。`create_pr` 在推送前就因脏工作区失败。PR 文案生成与 `gh pr create --base` 共用一次 `resolvePrBaseBranch`：`gh-merge-base`，再同仓且与本地名不同的 upstream，再 `gh repo view` 的 `defaultBranchRef`（`gh` 30 秒超时），再 git 主远程 `HEAD` / 本地 `main|master`，最后 `main`。暂存与范围 patch 按 49k/59k 截断并追加 `[truncated]`。`gitStatus` 只读本地 porcelain，但没有上游的引用把 `aheadCount` 报成相对 `branch.<name>.gh-merge-base` 或默认分支的提交数；默认引用上 `aheadOfDefaultCount` 为 0。那次 `rev-list` 失败时 status 设 `aheadUnreliable` 而不是静默的 0：标题栏保持 Push 可用（`aheadCount > 0 || aheadUnreliable`），以便 `gitPush` 能跑且不跳过，Create PR 仍只看 `aheadCount`。`git status --porcelain=v2 --branch` 在已列出的上游 gone 时省略 `# branch.ab`，视为没有可用上游，ahead 按默认/基线计数，push 可以用 `-u` 重新发布。标题栏对跟踪远程（否则主远程）跑 `git fetch --quiet --no-tags`，冷却键为 git-common-dir + 远程名（5 秒超时，成功 15 秒内复用，失败从 30 秒起指数退避、上限 15 分钟）并单独加载 `gh pr view`。窗口 focus/visibility 刷新等待 250ms，堆叠动作 `busy` 时跳过，以免冲掉动作后的 PR 结算。自定义提交说明保持原文（不对用户文案做模型侧 sanitize）。堆叠动作在 dirty/push 门控前会重读状态。GitHub 的 PR create/list 传 `--head`（fork → `owner:branch`）。`isCrossRepository` 要求非 origin 远程能解析出 `owner/repo`；解析不了的 URL 不当成 fork。同一条解析规则决定 `resolvePrBaseBranch`：解析不了的非 origin 仍把跟踪分支用作 `--base`。Create PR/MR 对每个 provider 都留在菜单里，也出现在推送成功 toast 上；`gitCreateChangeRequest` 在非 GitHub 上仍失败。非默认引用上推送成功后，`resolveCompletionCta` 给出 `Create ${shortLabel}`，不按 GitHub 过滤。Create PR 的菜单禁用理由只看 `aheadCount`。提交对话框绑定当前 `status.workingTree.files`。`VcsStatus.workingTree` 为必有字段。没有 `gitChangedFiles` IPC。PR 查找（`lookupOpenPullRequest` / `gitReadPullRequest`）使用 porcelain v2 的 `gitStatus.refName`，不 spawn `git status -sb`。Publish 默认 private，除非 IPC `visibility` 明确为 `public`。只有 status 是带仓库、且没有 origin 时才给出 Publish，status 为 null 时不给。菜单与主按钮的 View PR 共用缺失 URL 的 toast。主按钮禁用提示包一层 wrapper，悬停仍可读。禁用的 chevron 菜单行同样用 `getMenuActionDisabledReason` 包一层。chevron 菜单带 detached HEAD 与落后上游页脚；没有 origin 时菜单里仍有 Publish repository，脏工作区也能打开发布对话框。进度卡片先显示 `Waiting for Git...`，直到第一条 git 事件带上开始时间。

`prepareCommitContext` 跑 `git add -A`（或所选路径的 `--literal-pathspecs add -A --`），随后的 `git commit` 不再 `add`。`diff --cached --name-status` 为空时再按非 NTFS porcelain 路径补 add，仅在列举成功且过滤后没有可暂存路径时 skip；真正的 `git add` 失败（index lock、权限，或 add 失败且列举也失败）报错，仅含 Windows 保留名的工作区仍 skip。自定义提交说明用首行作 subject、其余行作 body（不只认空行分隔）。功能分支提交在没有可暂存变更时失败关闭。commit+push 之后缺少 `gh` 会让整单失败。Publish repository 打开对话框，执行 `gh repo create --yes` 或添加粘贴的远程 URL。提交后立刻关掉对话框、只留进度卡；失败时再打开同一对话框以便改字段重试。粘贴的 origin 在有提交时把 `url` 留在 `gitPush` 结果上，成功卡片才能 Open repository。堆叠的 `commit_push` / `commit_push_pr` 总会调用 `gitCommit`；干净工作区返回 skipped。没有本地增量且远程分支已存在时，`gitPush` 跳过，但 `aheadUnreliable` 为 true 时不跳过。

## 曾考虑的替代方案

**复用官方 Toast 原子。** 否决：超时与位置撑不住数十秒的 hook，再做一层皮肤也无法推 hook 行。

**失败只走阻塞错误弹窗。** 否决：用户痛的是静默等待，不是日志本身。用最后一行 hook（或第一行短 dump）做 toast 错误。

**引入第三方 toast 管理器或 Tailwind 卡片。** 否决：违反 dsw token 规则和 client 导出/slot 规则。卡片留在 `ui-git` 内部。

## 后果

点击 Commit, push & PR 会立刻看到 `Generating commit message...` 和 `Running for 0s`，随后是 leftover hook 标题。hook 失败把同一张卡片改成 Action failed，而不撑满页面。`git-actions.client.spec.tsx` 钉住立刻出现的 toast、hook 行更新、失败走 toast 不走弹窗、发布对话框提交后关掉只留进度卡且失败再打开、PR 按范围生成且失败即失败、初始化/打开文件 toast 错误、提交对话框文件来自当前 `workingTree`、以及仅在包含提交时继续功能分支。`git-logic.client.spec.ts` 钉住 Create PR 禁用理由只看 `aheadCount`，以及推送后不按 GitHub 过滤的 `Create ${shortLabel}`。`src/main/git.test.js` 钉住解析不了的非 origin `--base`、未跟踪 `gitDiscard` 走 `git clean`、PR 查找走 `gitStatus.refName` 且不 spawn `git status -sb`、以及残留文件走 `gitStatus().workingTree`。`apply.client.spec.ts` 钉住 inject 上没有 `gitChangedFiles`。worktree/线程绑定仍不在范围内；切换/新建见[分支选择器笔记](2026-08-16-titlebar-branch-picker.zh.md)。

## 相关

[标题栏分支选择器](2026-08-16-titlebar-branch-picker.zh.md) 拥有切换/新建与提交核对对话框。
