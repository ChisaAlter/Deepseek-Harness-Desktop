# Decision: 统一鲸鱼品牌资源

Status: implemented

中文 | [English](2026-09-18-whale-brand-assets.en.md)

## Problem

用户指定了新的透明头像和旋转加载动画。应用图标原由宠物立绘生成器拥有，单独替换产物会在下次生成时恢复旧图。现有决策目录中没有同主题的资源归属记录。

## Decision

`assets/whale-head.png` 是窗口、任务栏、托盘与安装器的品牌源图；`icon.svg` 在白色圆角方形底板上包装源图（圆角半径为边长 22%，头像四边各内缩 4%），既有命令生成 PNG、ICO；安装器直接读取生成的 PNG 再输出 BMP，避免重复构图。宠物生成器只维护宠物回退图片。启动中区原样加载 `assets/whale-spin.svg`，保留 112px 容器与外部图片方式，减少动态效果时切换静态头像。

## Alternatives considered

只替换生成的 icon.png/ICO 最省改动，但下次生成会回退。覆盖 pet-head.png 能复用旧路径，却会把应用品牌与宠物回退立绘继续耦合，因此使用独立源图并保留现有消费入口。

## Consequences

源图与加载 SVG 按原字节保存，可比较 hash；图标底板为白色，圆角外透明，头像保持完整比例。品牌更换需重跑 icon 和 installer:assets，安装版可执行文件内嵌图标仍需重新打包才更新。验证覆盖生成尺寸、动画两帧、减少动态效果和既有安装器契约；本次不发布安装包。
