# Agent Note：composer dock 两行盒宽同步输入卡、内容居中

Status: implemented

[English](2026-08-29-composer-row-centering.md) | 中文

## 问题

[composer 峰谷状态决策](2026-08-29-composer-peak-valley-status.zh.md) 把 dock 两行（`StatsLine` 与 `PeakValleyRow`）与输入卡边缘对齐：两行跟随 `--dsh-composer-resized-width` / `--dsh-composer-card-max-width` 并把文字钉在卡片左缘。产品位置调整随后提出两点：盒宽要重新与输入卡同步，内容要居中而不是贴左缘。

## 决策

- **盒宽与输入卡同步**：两个 dock 行均取 `max-width: var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))`——宽度拖拽提交期间 seat 恰好发布拖后宽度、重置时移除，因此两盒随窗口缩放与宽度拖拽实时贴合输入卡、零测量代码，左右边缘在任何状态下都与卡片齐平。
- **内容在盒内居中**：统计条 `text-align: center`（block 布局，省略号仍然有效），峰谷 flex 行 `justify-content: center`。纯 CSS；无测量代码。
- **对话消息列纳入同步**：`ChatView` 的消息列解析同一变量，对话内容区同样与输入框边缘齐平，宽表格突破与「回到底部」按钮的右侧留白也由它推导。宽度发布点改为对话根（`[data-conversation-root]`，输入卡与消息列的共同祖先）而非 composer seat——seat 不包含消息区；高度发布仍在 composer seat。

## 已考虑的替代方案

**只用消息列上限、不跟卡片（仅 `--dsh-chat-content-width`）。** 否决：盒子将不再跟随宽度拖拽，而这正是产品要求的同步。

**基于 ResizeObserver 的镜像。** 否决：seat 已经把提交后的宽度作为可继承的自定义属性发布；观察器只会为每次拖拽帧增加一次 JS 往返，并为同一事实引入第二个事实源。

## 后果

两个 dock 行的对齐契约由本 note 持有；[峰谷状态 note](2026-08-29-composer-peak-valley-status.zh.md) 改为链接此处，不再自行钉住边缘对齐的文字排布。seat 的 `--dsh-composer-resized-width` 读取回到 dock 两行（其其他消费方从未中断），并与居中内容组合，取代原先的左对齐文字。没有测试钉住对齐方式，因此改动仅限 CSS；会话累计费用开关的设置文案按产品措辞去掉路线与独立性从句；价格面板保持完整控制：任意模型的三个高峰价输入框都可编辑（取消「使用官方价格」），用户改价的模型重新勾选该开关即回到官方列。
