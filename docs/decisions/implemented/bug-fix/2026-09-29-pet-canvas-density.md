# Decision: 鲸鱼娘状态卡按显示器像素密度绘制

Status: implemented

中文 | [English](2026-09-29-pet-canvas-density.en.md)

## Problem

150% Windows 缩放下，桌宠 Canvas 的像素缓冲仍等于 CSS 尺寸，状态卡文字被二次放大而模糊。投喂按钮紧贴统计文字，缺少组间留白。

## Decision

Canvas 缓冲按当前 devicePixelRatio 分配，以绝对 setTransform 保持绘制、清屏、屏幕限界与命中均使用 CSS 像素。resize 与分辨率媒体查询变化均重建缓冲，重新绑定当前密度查询，避免跨屏后残留旧密度。投喂按钮下移 8px，上方 12px 行框之后留 12px 空隙，绘制和命中共用几何常量。

既有[命中与气泡几何决定](2026-09-24-whale-hover-bubble-geometry.md)涉及相邻的 CSS 坐标契约，继续有效；本次不改变身体命中范围。

## Alternatives considered

- 仅加粗字体或关闭图像平滑：改动小，但不能补回画布缺少的物理像素，也会改变现有文字风格。
- 另建 DOM 菜单：浏览器可直接处理文字密度，但需要重做绘制、穿透和命中链路，超出此次局部修复。

## Consequences

菜单和气泡按显示器原生密度绘制，布局与交互坐标不随密度扩大。画布内存随密度平方增长；THA4 推理尺寸不变。定向回归覆盖 100%/125%/150%/200% 切换、屏幕边缘定位、按钮留白和命中区域；实机视觉验收使用当前 150% 显示器。
