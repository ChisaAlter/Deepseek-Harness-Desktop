# Agent Note: 外观指针特效（像素拖尾 / 流体飞溅）

Status: implemented

[English](2026-09-13-cursor-pointer-effects.md) | 中文

## Problem

外观新增一个由指针驱动的装饰层，移植自 ayase motion 目录——`pixel-trail`（ReactBits `PixelTrail`）与 `splash-cursor`（ReactBits `SplashCursor`）——收在一个开关后二选一，并像背景特效、输入特效一样提供预设方案与自定义颜色 / 速度 / 大小。该层必须画在整个 UI 之上且不拦截输入，在无 Canvas 2D / WebGL 时静默不挂载、不留 DOM 残留，并且在 `prefers-reduced-motion` 下从不运行。

## Decision

`packages/client/ui-theme` 端到端持有该特性。`cursor-fx.ts` 在每次 `applyAppearanceDocumentExtras` 发布时挂载单例全屏层 `#dsh-cursor-fx`（`position: fixed`、`pointer-events: none`、`z-index 9999`）：切换特效或开关重建 canvas，颜色 / 速度 / 大小则走引擎的 `update` 热通道。`pixel-trail` 是 2D canvas 网格：指针轨迹插值盖章、格子淡出——在不引入 three.js 依赖的前提下对原 three.js 实现的等价移植。`cursor-fluid.ts` 是独立的 WebGL Navier-Stokes 染料模拟；无可用 GL context 时 mount 返回 `null`，`applyCursorFxLayer` 因而不留 DOM 残留。两个引擎都在最后一次输入 4 秒后闲置停帧，并在 `document.hidden` 时暂停。持久化是 Host `ui-theme` 的六个字段（`cursorEffectEnabled`、`cursorEffect`、`cursorEffectColors`、`cursorEffectSpeed`、`cursorEffectSize`、`cursorEffectPreset`），只经 `ThemeRuntime.setCursorFx` 写入；行内 Switch 只翻 enabled 位，所选方案在关闭期间完整保留。`CursorEffectRow` 是外观分区的收束行（标题 + 说明 + 齿轮 + Switch）；齿轮打开 `Modal`：特效类型卡片、跑真实引擎的画布实时预览、一次写齐整包的预设方案卡片、常显自定义控件，以及重置 / 取消 / 保存。弹窗按打开次数整体 remount，草稿只在打开时从存储值初始化（编辑期间的主题发布不会把方案重置回去）；预览 canvas 按 `draft.effect` 加 key——绑定过 `2d` 的 canvas 永远拿不到 WebGL context，反之亦然，切换类型必须换新元素。保存写回整份草稿并置 `cursorEffectEnabled: true`，即保存即应用。

## Alternatives considered

**通过 three.js / react-three-fiber 移植 `PixelTrail`。** 否决：为一个指针装饰把 3D 技术栈引入 ui-theme 不成比例；2D canvas 网格以轻得多的实现复刻了参考效果。

**用单个特效下拉框替代类型卡片。** 否决：沿用预设方案同款卡片网格——两个选项同时可见，每个色板还能按当前草稿配色示意效果。

**设置弹窗打开时暂停或跳帧模拟。** 暂缓：共享引擎本就在无输入 4 秒后闲置停帧，弹窗预览本身就是同一个引擎的挂载实例，成本模型保持一致。

## Consequences

指针输入永远到不了这一层（`pointer-events: none`），window 级 `pointermove` / `pointerdown` 监听随层一并卸除。空配色经 `var()` 链解析 `--dsw-alias-brand-primary`，`default` 方案随明暗主题自适应；预设数据之外不存在颜色字面量或主题分支。`cursor-fluid.ts` 带一条覆盖率豁免：jsdom 没有 WebGL context，jsdom 通道只证明失败关闭的挂载路径，模拟的视觉表现靠人工验收。减弱动效用户永远不会挂载该层。

## Testing

`cursor-fx.client.spec.ts`（jsdom）覆盖钳制、配色清洗、accent 的 `var()` 解析、层生命周期、拖尾插值、格子过期与上限、引擎 update / dispose 幂等，以及无残留失败路径；`cursor-fx-offdom.client.spec.ts` 覆盖无 document 的分支。`appearance-section.client.spec.tsx` 覆盖行开关、弹窗保存 / 重置 / 取消、保存即启用、自定义标记、预览描画、编辑中发布不打断草稿、重开按存储值恢复并换新画布，以及经 accent 链解析的颜色回退。`theme.client.spec.ts`、`settings-store.client.spec.ts`、`appearance-apply.client.spec.ts`、`boot-theme.client.spec.ts` 覆盖持久化接线。视觉验收为人工：打开开关后在界面上滑动指针，分别验收两种特效、各预设与自定义值。
