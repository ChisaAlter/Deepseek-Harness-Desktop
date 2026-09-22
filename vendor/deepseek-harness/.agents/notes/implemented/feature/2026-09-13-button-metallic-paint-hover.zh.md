# Agent Note: Button metallic-paint hover sheen

Status: implemented

[English](2026-09-13-button-metallic-paint-hover.md) | 中文

## Problem

产品要给所有按钮在悬停时叠加金属漆光泽，效果移植自 ayase motion 目录的 `metallic-paint` 条目（React Bits `MetallicPaint`，该站 demo 用的是 CSS 渐变扫光而非上游 WebGL shader）。光泽必须叠加在各变体原有 hover 填充之上而非替换，并且不改各组件样式就能覆盖所有按钮。

## Decision

新增全局样式表 `packages/client/ui-theme/src/styles/metallic-paint.css`，由 `installThemeStyles` 挂载：给悬停按钮自身的 `background-image` 画一层半透明 `linear-gradient`（115deg、`background-size: 320%`），以 4.5s ease-in-out 循环扫 `background-position`。色带只经 `color-mix` 取 label alias token：亮带取 `--dsw-alias-label-primary-foreground`（主按钮文字色，与任意填充天然对比，保住白色字形如输入框发送箭头），暗带取 `--dsw-alias-label-primary`，过渡带取 `--dsw-alias-label-secondary`——样式表不含颜色字面量、不含主题分支，同时扫光随主题明暗自动反转、随自定义主题染色。`prefers-reduced-motion` 停动画、保留静态光泽。

图像画在按钮自身背景上，因此随控件 `border-radius`（含全局 corner-shape）自然裁切，且各变体 hover 的 `background-color` 仍在下层可见——级联按 longhand 分别裁决，`html[data-dsh-metallic-paint] button:not(:disabled):not([aria-disabled='true']):hover` 的优先级高于单类名模块 hover 规则。覆盖范围止于主 Web UI document 内原生 `button`：`role='button'` 行、`<select>`/`<input>`、boot 页、启动器、壁纸图库窗与 mobile/web 均不在内。

界面设置「按钮悬停光泽」开关把 `metallicPaintEnabled` 持久化进 `ui-theme` 设置命名空间（自 [2026-09-18-button-sheen-default-off](2026-09-18-button-sheen-default-off.zh.md) 起默认 `false`——扫光为主动开启项）；`applyAppearanceDocumentExtras` 把该标志镜像为 document root 上两条规则共同依赖的 `data-dsh-metallic-paint` 属性——关闭后规则不再命中，按钮只剩各变体自身 hover 填充。无论开关状态，样式表保持挂载——开关翻转的是属性，不是样式表。

## Alternatives considered

**`::after` 叠加层动 `transform`。** 否决：覆盖控件需要给每个按钮加 `position: relative` 与圆角裁切（`overflow` 或 `border-radius: inherit`）；重锚定绝对定位后代、与既有 `::after` 样式冲突，对一个点缀效果来说风险不可控。

**移植 WebGL shader。** 否决：逐按钮 canvas/shader 对一个 hover 点缀过重，且参考站该组件的 demo 本身就是 CSS 渐变版。

**扩展到 `role='button'` 与表单控件。** 暂缓：DisclosureRow / ToolRow 是整宽行且自带运行态扫光，扩大选择器属于产品决策，由功能卡保留。

## Consequences

所有原生按钮零组件改动获得扫光。已接受的残余边界：若某按钮自身 `background-image` 或 `animation` 不可或缺，悬停时会被覆盖——当前样式表中按钮元素上两者皆无。`background-position` 是绘制属性而非 transform，代价仅是悬停期间的小面积重绘，已在 motion.md 指示器家族登记。减弱动效用户保留静态光泽。

## Testing

`client-styles.client.spec.ts` 断言该表经 `installThemeStyles` 按依赖顺序挂载；appearance-apply、runtime、settings-store 与 Appearance 区 specs 锚定属性翻转与持久化标志。视觉验收为手动：明暗两主题下悬停 primary / ghost / outline / 图标按钮。
