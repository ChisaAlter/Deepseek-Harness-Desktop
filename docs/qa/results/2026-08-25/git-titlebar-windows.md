# Phase 5 · Windows git-titlebar 实机验证报告 — ☐ NOT RUN

> 模板。步骤与 Pass 标准以收口计划
> [Phase 5](../../../superpowers/plans/2026-08-25-post-consolidation-closeout.md)
> 与卡片 [git-titlebar](../../../features/git-titlebar.md) 为准。
> **执行前不得填任何 Pass/Fail。**

## 环境

| 项 | 值 |
| --- | --- |
| 执行日期 | ☐ |
| 执行人 / 代理 | ☐ |
| Windows 版本（`winver`） | ☐ |
| CI run / SHA | ☐ |
| Setup 文件名 + SHA256 | ☐ |
| git 版本（实机 `git --version`） | ☐ |

## 步骤结果

| # | 步骤 | Pass 标准（摘要） | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 静默安装 + 打开真实 git 仓库工作区 | 标题栏显示分支；菜单可搜索/切换/创建 | ☐ | ☐ |
| 2 | 兄弟仓首载竞态（TC-WS-006/TC-GIT-001 实机位） | 登记写入后**不聚焦窗口**标题栏即显分支（`shell:git-workspaces-changed` 推送生效） | ☐ | ☐ |
| 3 | 进程树查杀（hook 挂 `powershell -c sleep 600`） | 超时后 `tasklist` 无 `git.exe`/`powershell.exe` 残留、无 `.git/index.lock`；再次 commit 正常 | ☐ | ☐ |
| 3b | taskkill 拒绝访问变体（受限 ACL） | git 直接子进程仍被 `child.kill()` 收掉；UI 报错不永久 loading | ☐ | ☐ |
| 4 | 白名单外分支名（含 `^` 等） | picker 列出该行但禁用 + hint | ☐ | ☐ |
| 5 | 生产表 TC-GIT-001…007、TC-WS-006 | 逐条按汇总表标准 | ☐ | ☐ |

## 附件索引

- ☐ `tasklist` 前后对照输出
- ☐ 标题栏截图（步骤 2 不聚焦即授权）
- ☐ hook 脚本与 commit 输出

## 回填

- ☐ 汇总表 TC-WS-006 / TC-GIT-001…007 行
- ☐ `git-titlebar` 卡 `last verified`（移除「实机 Windows 仍未覆盖」）
