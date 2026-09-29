# Decision: 启动页窗控对齐主界面

Status: implemented

中文 | [English](2026-09-29-boot-window-controls.en.md)

## Problem

启动页直接继承共享窗控的 30px / 999px 圆角，主界面与启动器已使用 32px / 8px 方钮，进入工作区时形状与位置跳变。真实 Electron 探针在明暗两态复现。

## Decision

启动页以限定 `data-boot-theme` 的选择器对齐主界面的尺寸、圆角、零间距与 12px 8px 4px 内边距，确保优先于后加载的共享样式。保留共享图标、交互色、no-drag 和动作绑定。[海平线场景](../product/2026-09-26-boot-sea-horizon-scene.md) 不变，画布例外不包含窗控形状。

## Alternatives considered

修改共享默认并移除启动器覆盖可消除重复，但扩展到本次请求之外的页面。本次局部恢复主界面既有视觉，不改其他入口。

## Consequences

启动页增加少量几何覆盖；静态回归钉住选择器优先级与尺寸，Electron 明暗探针检查最终样式及三个按钮的命中区域。安装包构建按用户要求暂停。
