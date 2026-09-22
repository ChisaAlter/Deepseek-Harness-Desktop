# Agent Note: 标题栏分支选择器

Status: implemented

[English](2026-08-16-titlebar-branch-picker.md) | 中文

## 问题

标题栏 Git 簇已能提交、推送、开变更请求，但切换或新建分支仍要绕道终端。产品需要一个分支选择器（搜索、内联新建、远程去重），并落在本设计系统里：`ui-primitives` Menu、`--dsw-alias-*` token，不再引入第二套状态栈。

## 决策

选择器分三层。纯逻辑 — `deriveLocalBranchNameFromRemoteRef`、`dedupeRemoteBranchesWithLocalMatches`、`shouldIncludeBranchPickerItem` — 落在 `ui-git/src/client/branches.ts`，用普通 TypeScript。触发器显示当前引用，点开与提交/推送箭头同一套 `Menu` 原子（portal、固定 218px 卡片、14/22 行，不用 `compact`）。Menu 过滤框钉在卡片顶部，随输入过滤，不自动聚焦。已有本地分支的 `origin/*` 行隐藏；当前行选中且禁用。新建是页脚行，用已输入的查询；查询为空时点击它会聚焦过滤框。切换或新建失败时，走 Git 进度 toast（`Failed to switch ref.` / `Failed to create and switch ref.`）。

后端新增三条桌面 IPC——`shell:git-branch-list`（`for-each-ref` + `symbolic-ref` 取 origin/HEAD 默认分支）、`shell:git-switch-branch`（`git checkout --ignore-other-worktrees`，另一工作树已占用该分支时仍切换本目录）、`shell:git-create-branch`（`git checkout -b`）——与其余 git 操作一样全部经 `workspace-authority` 根授权。引用名先过 `^[A-Za-z0-9][A-Za-z0-9._/-]*$` 校验并拒绝 `..`、`.lock`、尾斜杠，才进 argv，模型传入的引用无法夹带选项或路径穿越。

worktree 多环境与线程↔分支绑定不在范围内：本 harness 没有按会话的 worktree 路径、env mode 或切换时停会话的元数据。只做选择器一半而不做生命周期等于撒谎。它们留作后续 harness 原生设计的候选。

## 曾考虑的替代方案

**引入 Tailwind / shadcn / lucide / zustand 分支菜单。** 否决：那些栈违反强制的 dsw 设计语言、slot catalog 与 lint 门禁。

**只用终端做分支操作。** 否决：标题栏已拥有 Git 闭环（提交/推送/PR）；最高频的引用操作绕道终端会打断这个闭环。

**连 worktree/env-mode 一起交付。** 暂缓：需要授权根内的按会话分支元数据与 worktree 生命周期管理。

## 后果

标题栏 Git 簇现在是完整的引用闭环：切换、新建、提交、推送、变更请求。提交对话框会核对当前分支、`status.workingTree` 里带 numstat `+/-` 的文件，并提供 Commit 或 Commit on new branch（`feature/update`）。`git.test.js` 钉住 list/switch/create 往返与不安全引用拒绝；`branch-menu.client.spec.tsx` 钉住纯函数以及 Menu 过滤 / 新建页脚 / toast 错误交互。选择器只在会话 cwd 是仓库时渲染；非 git 目录保持隐藏，初始化 Git 流程不受影响。

## 相关

[桌面 surfaces 集成加固](../architecture/2026-08-15-desktop-surfaces-integration-hardening.zh.md) 拥有本选择器路由经过的 workspace-authority 根。
