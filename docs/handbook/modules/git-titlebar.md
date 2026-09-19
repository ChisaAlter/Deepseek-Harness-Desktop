# 模块：Git 标题栏

## 职责与非目标

**职责：** 标题栏 Git 状态、分支、暂存/提交、推拉、变更请求等。  
**非目标：** 不替代完整 IDE Git UI；不伪造无仓库能力。

## 用户路径

- 看状态与分支菜单 → 切换/创建分支 → stage/commit → push/pull → 开变更请求（若配置允许）。  
- Diff surface 与工作区一致。

## 架构要点

- `git.js` 门面 + `git-exec.js`、`git-diff.js`、`git-remotes.js`、`git-pullrequest.js` 等。  
- 进度事件 `shell:git-progress`。
- 登记刷新事件 `shell:git-workspaces-changed`：`git-workspace-watch.js` 在主进程 watch `dsh-home/storages/`（目录级、防抖、缺失重试；武装成功且注册文件已存在时补发一次，覆盖重试间隙的单次写入），`workspace.json` 变更后推给 harness 窗口；ui-git 订阅（注入 `onWorkspacesChanged`）并即刻 `refresh`，消除首载「登记未落盘 → 状态不可用直到重新聚焦」的空窗。

## 实现入口

- `src/main/git.js` 及同前缀模块
- Preload：`gitStatus`、`gitCommit`、`gitPush` 等

## 不变量

- 行为对齐桌面已定 T3/标题栏契约；非仓库时降级而非假成功。
- `shell:git-*` handler 抛错经 `git-ipc-guard.js` 兜底为该通道失败载荷（状态/diff → `null`，其余 → `{ok:false,message}`），renderer invoke 不 reject；进度 toast 不卡 loading。`shell:open-workspace-path` 也在兜底内。
- renderer 侧 `refresh()`/`settleStatus()` 后台 status/fetch/PR 刷新拒绝时按 `null`/`ok:false` 降级、保留上一份快照，不产生 unhandled rejection。
- 切换到无本地同名的远端行走 `checkout --track --ignore-other-worktrees`，建本地跟踪分支而非 detached HEAD。
- 分支列表 IPC 失败在菜单内区分错误与空列表（vendor ui-git `branch.listFailed`）。
- `safeRefName` 白名单不放宽：白名单外的名字 `gitBranchList` 标 `switchable:false`，picker 禁用该行并提示；拒绝文案说明字符不可安全传递。
- Windows 超时/输出超量用 `taskkill /PID /T /F` 杀 git 子进程树（`git-exec.js killProcessTree`），POSIX 用默认 `child.kill()`；taskkill 缺失/spawn 失败/非零退出一律回退 `child.kill()`。
- Android 工作区胶囊走同一套 git IPC：已登录 `POST /__remote__/shell/git*`，不把 PTY / `writeFile` 暴露给手机。
- PR 目标遵循 gh 的仓库选择，并在查询、创建和创建后查询中显式固定；跨 Fork 的来源与实际目标比较，创建使用 `owner:branch`。自动描述使用目标远程的已拉取基线，缺失时提示先拉取，不回退到 Fork 的基线。
- Git cwd 授权读桌面 `dsh-home` 的工作区登记，允许启动目录的兄弟项目；拒绝把盘符根（`C:\`、`/`）写入白名单。

## 门槛

- QA：`TC-GIT-001` … `TC-GIT-007`

## 延伸阅读

- Feature：[../../features/git-titlebar.md](../../features/git-titlebar.md)
- [../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md](../../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md)
