# Agent Note: Composer 思考炫光设置

Status: implemented

[English](2026-09-07-composer-beam-settings.md) | 中文

## 问题

界面设置只能启停运行态 composer beam，用户不能调节动效与视觉重量；与此同时，现有 beam 几何已经被圆角覆盖、指针命中和 composer stack 间距门禁严格钉住。

## 决策

保留现有 `Switch`，在右侧增加设置图标并打开共享 `Modal`。弹窗编辑一份草稿：顺/逆时针、单圈周期、整体强度、bloom 强度和整体色相。局部预览与 `InputBar` 使用同一套 beam class 和 CSS 变量；保存把完整值写入 `ui-conversation.composerBeamStyle`，取消丢弃草稿，恢复默认回到功能加入前的渲染。

自定义刻意限制在 CSS 变量：2px stroke、1.5px bloom 光源、4px 裁切壳、8px blur、22px 圆弧、mask 与 conic 强度窗口保持固定。本功能不引入外部参考实现里的聚焦、输入、完成或失败状态灯。

## 范围更新（2026-09-08）

[设置扩展 Note](2026-09-08-composer-beam-settings-expansion.md) 取代本 Note 当时对任意色标和夜间调暗的暂缓决定。这些能力现在作为有边界、经过校验的视觉设置提供；对聚焦、输入、完成和失败状态灯的否决仍然有效。

## 备选方案

**移植参考实现的完整氛围灯状态机。** 否决，因为聚焦、输入、完成、失败、夜间模式和任意色标会在现有思考炫光之外增加新的产品状态与第二套视觉色板。

**用独立 CSS 做一个简化预览。** 否决，因为它会与真实 composer 漂移。弹窗与 `InputBar` 改为渲染同一个 `ComposerBeam` 组件和变量映射。

## 后果

旧设置文档继续有效，因为 style 字段可缺省，采用时回到与历史完全一致的默认值。设置行和所有已挂载 composer 共用同一个 `ComposerSubmissionPolicy` snapshot source，因此保存后无需重载即可生效。减弱动效仍隐藏完整 beam 与预览。

## 测试

组件测试覆盖打开、草稿编辑、恢复默认、取消、保存、Host 不可写与无障碍标签。Policy 与 Host 测试覆盖默认采用、归一化、先发布后持久化、schema 校验和 slot 装配。focused suite 130/130 通过，完整 GUI suite 5361 通过、1 项跳过，official profile build 通过，Electron Chromium 默认值与配置极值四角像素门禁通过。
