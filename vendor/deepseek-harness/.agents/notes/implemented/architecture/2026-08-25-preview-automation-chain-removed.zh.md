# Agent Note：preview-automation IPC 链已删除

Status: implemented

[English](2026-08-25-preview-automation-chain-removed.md) | 中文

## 问题

桌面壳暴露了八个 `shell:preview-automation-*` 通道（status、snapshot、click、type、press、scroll、evaluate、wait-for），可对预览 guest 执行任意 `executeJavaScript` 与 CDP `Input.*` 注入。产线零消费者：`ui-preview` 把回调绑进 `PreviewShellInjected`，但没有任何组件或插件调用。harness renderer 内的任何代码——包括市场安装的插件——都能通过 `window.shell` 触达已登录预览会话上的 JS 求值原语。

## 决定

整链删除：main 进程 controller 方法与 IPC handler、preload 绑定、`ui-preview` 类型与注入回调。测试钉住缺席（无 `shell:preview-automation-*` handler、任何 preload role 无 `previewAutomation*` 键、controller 无 `automation*` 方法）。`ensureDebugger` 因 `setColorScheme` 的 CDP 仿真调用而保留。重新引入浏览器自动化须新开 feature 卡并带显式权限模型（审批流、仅 loopback guest、禁裸 evaluate）。

## 备选方案

**用配置开关保留该链** ——否决：休眠的高权限面仍随包发布、仍需审计、且易被静默重启。零消费者时正确基线是缺席。

## 后果

- harness renderer 无法再在预览 guest 中求值 JS 或合成输入；剩余预览面为导航、截图、pick、PiP 与录制。
- `PreviewShellInjected` 不再携带 automation 成员；此变更前构建的桌面 preload 暴露的 `previewAutomation*` 为无人调用的死函数。
