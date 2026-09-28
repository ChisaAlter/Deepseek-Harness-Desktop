# Decision: 透明自绘剪影窗禁用 OS 圆角遮罩

Status: implemented

中文 | [English](2026-09-27-transparent-window-os-corner-mask.en.md)

## Problem

剪影半径回调到 20px 后窗角出现明显锯齿。根因不在页面裁切：`windowChrome` 一直默认 `roundedCorners: true`，Windows 11 的 DWM 对透明窗仍套用约 8px 的 OS 圆角遮罩——页面把更大圆弧之外画成透明，DWM 再按自己的弧度硬裁一次，两条不同曲线交界呈阶梯状锯齿（该遮罩对透明窗不做 alpha 混合）。半径 10px 时两条曲线接近、缺陷被掩盖；放大到 20px 后明显。事实上此前外框视觉半径一直被 OS 遮罩吃掉一截——10px 合同实际只显示约 8px，「圆角太小」的观感部分来自此缺陷。

## Decision

凡页面自绘剪影或内容必须抵达窗缘的透明窗一律 `roundedCorners: false`：`windowChrome` 对 `transparent` 覆盖项自动关闭（覆盖 main 与 launcher 两个壳窗，slim 启动器复用同一 `window.js` 路径），不透明窗保留 OS 圆角默认；update-overlay 弹窗与 live2d 全屏宠物层显式关闭。welcome 窗把整窗铺满不透明内容、自身不画剪影，圆角恰由 OS 提供，保持不变。`shell-silhouette-radius.test.js` 新增钉值：chrome / update-overlay / live2d 三处退出 OS 遮罩。

## Alternatives considered

- **把剪影半径降回 ≈8px 迁就 OS 遮罩** — rejected：等于把剪影合同交给 OS 默认值，且遮罩自身的阶梯边缘在 8px 同样存在，只是与页面弧重合时难分辨。
- **页面侧换 squircle / clip-path 强压边缘** — rejected：锯齿发生在 OS 合成层，页面内任何曲线都救不回来。
- **全部窗口一律关闭 OS 圆角** — rejected：welcome 等不画剪影的透明窗会退成直角；有原生框或不透明的窗也不需要。

## Consequences

两个壳窗、弹窗与宠物层的轮廓完全交给页面 alpha 边 AA，OS 不再二次裁切；20px 剪影自此完整显示。不透明窗口维持 `roundedCorners: true` 默认；今后新增「透明 + 自绘剪影」窗口必须沿用同一开关，测试已钉。design-language.md 因本条款越过字数上限，`doc-budgets.manifest.json` 上限上调至 14400（条款是合同事实非冗余散文）。
