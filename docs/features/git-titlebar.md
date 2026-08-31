# Feature: Git titlebar

| Field | Value |
| --- | --- |
| **id** | `git-titlebar` |
| **status** | `active` |
| **last verified** | 2026-08-31 — `gitPush` 成功或 skip 后补齐 `refs/remotes/<primary>/HEAD`（先 `set-head --auto`，否则刚推的分支），非 main 首发仓 `isDefaultRef` 为真，胶囊走 Commit & push。此前 2026-08-25 — 审查批次 3：首载登记竞态根因修复（主进程 watch `workspace.json` → 推 `shell:git-workspaces-changed` → 标题栏即刻重读状态；含武装间隙补发）；win32 `taskkill` 非零退出回退 `child.kill()`；登记兄弟仓 `gitBranchList` 全链路自动化（TC-WS-006/TC-GIT-001 关键断言的 rehearsal）；禁用行 hint Tooltip 与 `shell:git-branch-list` 抛错接线补测。实机 Electron（Linux/xvfb + CDP）验证：未登记兄弟仓 → 写入登记 → renderer 收到信号 → gitStatus/gitBranchList 即刻授权；`smoke:source` 通过。合并树 `ea659884`（consolidation #39 落地后）：desktop `npm test` 997/0/3 绿（git 链单测在内）+ `qa:source` titlebar/branchMenu/gitMenu/commit 步骤 PASS。实机 Windows 仍未覆盖（验证手册见 [合并收口计划 Phase 5](../superpowers/plans/2026-08-25-post-consolidation-closeout.md)） |

## User paths

1. 标题栏看当前分支 → 打开「选择分支」→ 搜索 / 切换 / 创建并检出。
2. Commit / Push / Pull / 变更请求（有远程且配置允许时）。
3. 已打开的工作区是 Git 仓库时，分支列表来自该仓库，不因启动目录不是其父目录而变空。

## Invariants

- 会话 cwd 只要是桌面 `dsh-home` 已登记的工作区目录（或启动工作区及其子目录），Git IPC 就对该路径生效。
- 登记路径可以是启动工作区的**兄弟目录**（例如 `Documents\Deepseek-Harness-Desktop` 启动、`C:\Ai\ChisaTerminal` 为当前项目）。
- `workspace.json` 里的盘符根（`C:\`、`/`）不得进入 Git/FS/PTY 白名单。
- 高危祖先也不得成为登记信任根：用户主目录、`%APPDATA%` / `Application Support` / `~/.config` / `~/.ssh`、desktop `userData` 与 `dsh-home` 根（等于这些目录、或包含它们的目录一律拒绝）。普通项目目录（含 Documents 下兄弟仓）不受影响。
- 非仓库降级（初始化 Git），不把授权失败画成「没有匹配的分支」；分支列表 IPC 失败在菜单内画「分支列表加载失败。」加详情行，不落空态。
- 分支菜单选无本地同名的远端行（`origin/feature-x`）时 `checkout --track` 建本地跟踪分支，不允许 detached HEAD。
- `shell:git-*` handler 异常必须 resolve 为该通道的失败载荷（状态/diff 类 → `null`，其余 → `{ok:false,message}`），不得让 renderer 的 invoke reject；授权检查仍在兜底之外照常 reject。进度 toast 不允许永久 loading。`shell:open-workspace-path` 同样走该兜底。
- renderer 侧 `refresh()`/`settleStatus()` 的后台 status/fetch/PR 刷新 promise 拒绝时按 `null`/`ok:false` 降级、保留上一份快照，绝不产生 unhandled rejection，也不把已成功的动作重画成失败。
- `safeRefName` 注入白名单**不放宽**；git 合法但白名单外的分支名由 `gitBranchList` 标 `switchable:false`，picker 列出但禁用该行并给 hint（`branch.unsupportedName`），切换/创建被拒绝时的文案说明是名字含不可安全传递的字符。
- Windows 上 git 子进程超时/输出超量必须 `taskkill /PID /T /F` 杀整棵进程树（hooks/ssh 不残留），POSIX 保持 `child.kill()`；taskkill 缺失、spawn 失败或**非零退出**（如拒绝访问）时回退 `child.kill()`，git 直接子进程不得存活持锁；实机 Windows 验证仍缺。
- 首载不留空窗：harness 异步写 `workspace.json` 完成后，主进程 watcher（`git-workspace-watch.js`，watch `storages/` 目录、防抖、目录缺失重试；武装成功时若注册文件已存在则补发一次信号，覆盖「目录创建 + 首次登记都落在重试间隙」的漏窗）推送 `shell:git-workspaces-changed`，标题栏订阅后立即重读状态，不依赖窗口重新聚焦兜底。
- 已知权衡（信任粒度）：通过过滤的登记根对 Git/FS/PTY 全量生效，不做逐操作确认；边界是「登记只来自用户主动打开的工作区」加上盘符根与高危祖先过滤。
- `gitPush`（含 skip）在 `refs/remotes/<primary>/HEAD` 缺失或悬空时补上：先 `git remote set-head <primary> --auto`，失败则指向刚推的分支。这样首发非 `main`/`master` 的仓 `isDefaultRef` 为真，Commit & push 而不是误走 Commit, push & PR。不把 push 失败画成 set-head 失败。
- 官方 `dsh web` 标题栏 Git 视觉；不另做皮肤。

## Allowed touch

- `src/main/git.js`、`git-*.js` 与其单测
- `src/main/workspace-authority.js`（Git cwd 授权）
- Preload / `ipc.js` 的 `shell:git-*`
- 本卡与 handbook `modules/git-titlebar.md`

## Do not touch

- vendor `ui-git` 文案/菜单默认不动（列表失败已在菜单内画错误行；2026-08-25 审查批次按任务指示做过一次最小 vendor 修复，后续改动仍需明示超出范围）
- 官方 `~/.dsh`
- Appearance 图源、底栏终端契约（除非一并 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/git.test.js`（含登记兄弟仓 `gitBranchList` 全链路 rehearsal）；`workspace-authority.test.js`；`git-workspace-watch.test.js`；`ipc.test.js` 的 git guard/watcher 接线；`qa:packaged` 可 rehearsal 兄弟仓 `gitBranchList`（**不能**当发版 Pass） |
| Manual / QA | 每次发布前生产表 `TC-WS-006`、`TC-GIT-001`…`007`；已装 CI 包 + 真实 `dsh-home` |

## Sources

- Handbook：[../handbook/modules/git-titlebar.md](../handbook/modules/git-titlebar.md)
- Spec：[../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md](../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md)
