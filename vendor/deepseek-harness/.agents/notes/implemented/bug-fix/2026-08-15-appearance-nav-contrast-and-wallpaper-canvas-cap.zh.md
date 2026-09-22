# Agent Note: 外观导航选中对比与壁纸画布实心度上限

Status: implemented

[English](2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.md) | 中文

## 问题

外观页会把自定义家族、玻璃透明度和可选背景图叠在一起。其中两层会让选中铬架和背景图本身消失。

非 DeepSeek 家族的 `--dsw-specific-sidebar-nav-item-active` 是画布上约 10% 的强调色洗色。设置导航坐在 `--dsw-alias-bg-layer-2` 上，而不是画布上，因此宣纸这类奶油色家族洗出的薄荷绿与对话框几乎无法区分。同一 token 也绘制会话侧栏选中行。

`wallpaperCanvasSolidity` 把玻璃 100% 映射成完全不透明的 `--dsw-alias-bg-base`。毛玻璃和像素化只过滤背景图层，无法让图透过实心画布。因此已选背景图会出现在外观页预览里，却从主界面消失。

第三个缺陷只发生在主题图书馆卡片：`.half` 被编辑器 fieldset 复用，预览半区吃到 `border-radius: 12px`，而 `.halfActive::after` 仍是直角，对不齐卡片的 14px 圆角。

## 决策

`deriveThemeTokens` 把强调色混进画布，直到 `--dsw-specific-sidebar-nav-item-active` 相对 `--dsw-alias-bg-layer-2` 达到 1.25 对比下限，`--dsw-specific-sidebar-nav-item-active-accent` 达到 1.4。设置里的 `.navCell.active` 使用 accent token，因为该行坐在 layer-2 上。会话侧栏选中行共用这档更浓的洗色。

混入背景图时，画布填充不超过 `MAX_WALLPAPER_CANVAS_SOLIDITY`（45%，与玻璃滑杆默认 80 时的画布值相同）。对话列、详情列和工作台列不再重涂 `--dsw-alias-bg-base`；AppFrame 把该填充涂在整框上。侧栏混合取未帽定画布曲线与玻璃的中值，因此玻璃 100% 时轨完全不透明，对话画布仍受上限约束。侧栏列与 SidebarRoot 都在该画布上再涂 `--dsw-specific-sidebar-fill`，中档玻璃时轨仍比对话更厚。100% 混合写入实色，不用 `color-mix`。侧栏列没有右边框；靠填充对比和对话区分，避免一条不透明的 1px 线切开背景图。浮起表层仍跟随玻璃滑杆，包括 100%。手机远程弹窗涂 `--dsw-alias-bg-layer-2`，不用被帽定的画布。外观文案写明玻璃越实心背景图越看不清；已选图且玻璃至少 90% 时再出一句提示。毛玻璃和像素化只过滤背景图位图，不改变铬架实心度。

图书馆预览半区使用独立圆角（`14px 0 0 0` / `0 14px 0 0`）；编辑器 fieldset 使用 `.editorHalf`。`.halfActive::after` 继承 `border-radius`。

字体字段仍是 CSS `font-family` 名称。空表示产品默认栈。文案写明这一点，不增加系统字体选择器。

这修正了[主题家族外观系统](../feature/2026-08-14-theme-family-appearance-system.zh.md)里的混合曲线；家族文档、Host 分节和背景图层不变。

## 考虑过的替代方案

**给设置导航单独做 token。** 否决：现有 accent 洗色就是选中行 token；提高对比下限也会修好奶油色画布上同样坐在 layer-2 的会话侧栏。

**把玻璃默认值调低，而不是帽定画布填充。** 否决：用户的玻璃值是菜单和对话框的真实偏好；缺陷只是画布在有背景图时变得完全不透明。

**让毛玻璃/像素化打穿实心画布。** 否决：这两个滑杆过滤的是背景图层，不是盖住它的铬架填充。

**把字体名输入换成系统字体选择器。** 否决：持久化值是 CSS 家族名，空表示默认栈；选择器会另起一套 Host schema 并不拥有的控件。

## 后果

自定义家族下，设置导航和侧栏选中行相对 layer-2 可辨。玻璃 100% 时对话里背景图仍可见，代价是有图时主画布不能完全实心。侧栏和浮起铬架（包括手机远程弹窗）在玻璃 100% 时完全不透明。字体输入保持自由文本。

## 验证

`derive.client.spec.ts` 用宣纸种子（`#0f766e` / `#f3efe6` / `#1c1915`）断言两个 nav-item 填充相对 layer-2 不低于对比下限。`wallpaper.client.spec.ts` 钉住玻璃 80、100 与 140 时画布实心度为 45%，混合后的 `--dsw-alias-bg-base` 使用该百分比，侧栏填充为中值混合（玻璃 80 时 63%）、玻璃 100 时为实色浮起色，浮起的 layer-1 在玻璃 100 时亦为实色。`appearance-section.client.spec.tsx` 钉住已选图且玻璃 100% 时出现背景图提示、80% 时不出现，以及字体名说明。
