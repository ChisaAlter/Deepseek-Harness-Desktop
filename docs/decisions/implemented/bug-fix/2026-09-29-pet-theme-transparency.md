# Decision: 主题切换保留桌宠透明背板

Status: implemented

中文 | [English](2026-09-29-pet-theme-transparency.en.md)

## Problem

选择深色后，鲸鱼娘所在整块屏幕被不透明深色覆盖。桌宠创建时虽然指定 `transparent:true` 和 `backgroundColor:'#00000000'`，但未登记到 chrome 的透明窗口集合；`applyAppTheme()` 遍历所有窗口时将背板改为 `#151517`。页面 CSS 仍然透明，GPU 无需崩溃即可复现。

既有记录审计：[窗口 Chrome 自愈](2026-09-25-window-chrome-self-heal.md)处理注入丢失与最大化语义，部分共享透明窗口背景，但不负责桌宠注册；保留其决定。本次不改变既有崩溃、显示器变化及唤醒时的窗口重建策略。

## Decision

桌宠每次创建 BrowserWindow 后立即调用既有 `markWindowTransparent`，包含恢复重建。全局主题仍照常更新普通窗口，宠物原生背板始终透明；不改变全局主题分发、CSS、推理或用户配置。

## Alternatives considered

- 主题更新后重建桌宠：能恢复初始透明值，但每次切换都会重载模型，且没有修正错误的填充操作。
- 强制透明 CSS：能防页面底色污染，但此处被改写的是原生窗口背板，不能解决本次复现。

## Consequences

复用主窗和启动器已有的透明保护，无新配置或监听器。桌宠创建路径依赖 chrome 的透明登记；回归测试通过真实管理器创建窗口，再调用实际 `applyAppTheme()`，覆盖深浅色切换和窗口重建，修复前确实得到不透明 `#151517`。
