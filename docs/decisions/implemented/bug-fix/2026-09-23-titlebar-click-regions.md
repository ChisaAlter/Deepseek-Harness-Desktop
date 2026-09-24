# Decision: 标题栏控件从窗口拖拽区扣除

Status: implemented

中文 | [English](2026-09-23-titlebar-click-regions.en.md)

## Problem

`AppFrame` 在窗口顶部 48px 声明拖拽区。Windows 会把与之重叠、却未声明 `no-drag` 的会话头部控件当成拖拽区域：Agent Team、打开目录和更多打开方式在视觉上是按钮，原生鼠标点击却无法到达它们。原先仅为 macOS 声明的交互元素排除规则没有覆盖 Windows。

## Decision

会话头部的层级导航、操作区、工具区和角落入口在所有平台都声明 `-webkit-app-region: no-drag`；Web 基础样式中的原生按钮及自定义交互元素排除规则同样适用于所有平台。覆盖拖拽带的固定浮层自身也声明 `no-drag`。拖拽仅留给控件之间的空白。当前会话标题与 Agent 预设名称保持只读语义。

## Alternatives considered

- **只给已报障的三个按钮逐一加排除规则** — rejected：同一会话头部还会由插件插入导航和操作，逐个补丁无法保护新增入口；头部座位和通用交互元素是更稳定的边界。
- **移除顶部拖拽带** — rejected：窗口会失去现有的空白区域拖动能力，也不符合桌面标题栏的既定交互。

## Consequences

顶部第一行的实际按钮可接受原生点击，空白处仍可拖动窗口。样式回归测试检查会话头部座位、通用交互元素和固定浮层；源码窗口还须检查各按钮中心点是否落在 `no-drag` 区域。
