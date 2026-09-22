# Decision: 让文档页读取 scratch 会话文件

Status: implemented

中文 | [English](2026-09-23-scratch-cwd-document-tab-read.en.md)

## Problem

无工作目录会话的 cwd 由 Host 固定为 `$DSH_HOME/no-workspace`（scratch）。用户在该会话里让模型生成 HTML 后，对话里的文件卡片提供「打开」；点击后右侧文档页经 `shell:read-file` / `shell:list-dir` 读取，却得到 `Path is outside the workspace.`，页面渲染该错误而不是文件内容。同一文件经由 Browser 面板的 `previewWorkspaceFile` 或悬浮预览 `previewOpenFileWindow` 可以打开，说明缺口只在这两条文档页 IPC 的授权面。

根因：两条 IPC 走 `workspace-fs` 的惰性生产 authority，而它调用 `loadWorkspaceAuthority()`（不带 `allowScratchCwd`）；`preview.js` 用的是 `loadWorkspaceAuthority({ allowScratchCwd: true })`。上游修复 `5c789fcba53` 只补了 preview 侧的授权，文档页这一侧没有同批更新。

| 通道 | scratch cwd 下的结果 |
| --- | --- |
| `previewWorkspaceFile`（Browser 面板） | 成功；相对 CSS / 图片与 MIME 正确 |
| `previewOpenFileWindow`（悬浮预览） | 成功 |
| `shell:read-file` / `shell:list-dir`（文档页） | 失败：`{ ok: false, message: "Path is outside the workspace." }` |

## Decision

`workspace-fs` 的惰性生产 authority 与 preview 对齐：`loadWorkspaceAuthority({ allowScratchCwd: true })`。scratch 根仍由 `workspace-authority.js` 的 `scratchWorkspacePath()`（`$DSH_HOME/no-workspace`）给出，只是把它加入同一份 allowlist；`resolveInside` 的穿越、绝对路径、符号链接逃逸与 `.git` 规则不变，因此 scratch 会话不会因此获得对任意路径的访问，父目录与卷根仍被拒绝。

## Alternatives considered

- **让文档页改走 preview authority（把 `shell:read-file` / `shell:list-dir` 接到 `createWorkspaceFileReader(preview authority)`）** — rejected：preview authority 与 `createWorkspacePreviewController` / 悬浮窗的生命周期绑定，复用意味着把通用文件 IPC 绑到 preview 控制器的创建与关闭时序上；同时 `listDir` 需要目录枚举能力，而 preview 侧只有有界只读文件适配器。改动面更大，且会让文档页的可用性取决于 preview 栈是否已初始化。
- **给 `workspace-fs` 单独再造一份 scratch authority** — rejected：`workspace-authority.js` 已经是唯一的信任根实现，`loadWorkspaceAuthority({ allowScratchCwd: true })` 就是既有 seam；再造一份会分叉 `resolveInside` / `.git` / realpath 规则。
- **不授权 scratch，改为要求用户先选工作目录** — rejected：无工作目录会话本来就支持生成文件并提供「打开」，产品路径要求它能打开；把入口留在原地再展示越界错误才是最差状态。
- **授权 `$DSH_HOME` 或用户主目录** — rejected：那会越过 scratch 根，把 token 存储、导入数据、SSH 配置等高危目录暴露给渲染器发起的读取，是明确的权限扩大。

## Consequences

无工作目录会话的文件卡片在右栏文档页可以正常读取 scratch 内的文本 / HTML（以及列目录），与 Browser 面板和悬浮预览行为一致。授权的边界仍是 Host 固定的 scratch 根：`..`、绝对外部路径、符号链接逃逸继续被 `resolveInside` 拒绝，`.git` 段继续不可读不可写；URL 编码穿越由 token server 在解码后拒绝，本决定不触碰那一层。回归覆盖在 `src/main/workspace-fs.test.js`：同一生产 authority 下 scratch 内文件可读可列，父目录与 scratch 外绝对路径仍返回越界失败。
