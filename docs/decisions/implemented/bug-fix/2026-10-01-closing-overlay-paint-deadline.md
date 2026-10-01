# Decision: 关闭遮罩绘制等待不得阻断正常退出

Status: implemented

中文 | [English](2026-10-01-closing-overlay-paint-deadline.en.md)

## Problem

原始 CI 候选 `36804159162` 的安装版完成任务保护并返回退出确认后，控制 peer 文件已移除，但主窗及 Harness Node 仍长时间存活。精确安装 EXE / CDP owner 绑定下，主窗 boot 页面已有关闭遮罩、document.hidden 为 true；500ms 与 700ms 两次只读探针均没有收到第一帧或第二帧。`finalizeQuit` 在正常 Harness 关停前等待 `showClosingOverlay`，而遮罩脚本返回的双 requestAnimationFrame Promise 没有期限。

该问题补充 [退出本地连接误报修复](2026-09-29-quit-transport-false-positive.md)：检查和排空已完成，卡点属于关闭反馈绘制，不取代原任务保护决定。启动监听器注册迟到的假设经代码核对撤回；监听器在 whenReady Promise 之外同步注册。

## Decision

- 保留遮罩主题、文案及正常双帧绘制路径。在主进程对整个 CSS 插入 / 脚本执行 / 帧等待设置 500ms 期限；完成、出错或超时后清理 timer 并继续正常关停。
- 期限覆盖 renderer 定时器也被节流或 IPC 不响应的情况。迟到 Promise 的完成 / 拒绝有处理，不产生未处理拒绝；不以提高全局后台帧率解决退出问题。
- 保留 inspect、接纳锁、drain、资源 cleanup 和 `harness.shutdown()`。该期限只限制视觉反馈，不授权跳过未完成工作或强制退出。

## Alternatives considered

- 无限等待双帧可确保反馈已经画出，但隐藏或挂起页面永远不回调，阻断更重要的正常关停。
- 只给 renderer 加 setTimeout 容易实现，却同样受后台节流影响，且覆盖不了未完成的 CSS / IPC。
- 直接 app.exit 或杀进程能结束窗口，但跳过原正常资源和 Harness 关停，没有必要扩大副作用。

## Consequences

迟缓的 renderer 可能尚未绘出关闭反馈，进程就开始正常关停；已有视觉样式不变。回归需覆盖不回调的帧、CSS / 脚本 Promise、正常完成清 timer 和 renderer 拒绝，并在真实隐藏 Electron 页面复现与确认等待有界。新 CI Setup 仍须实际验收退出；旧候选的长时间存活不能记为 Pass。
