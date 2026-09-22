# Agent Note: 标题栏拥挤时的密度与会话栏避让

Status: implemented

[English](2026-08-17-titlebar-crowding-density.md) | 中文

> 范围：中间栏被挤窄时，AppFrame 标题栏尾簇与会话栏页头的关系。[桌面 surfaces 与标题栏](../architecture/2026-08-14-desktop-surfaces-and-titlebar.zh.md) 拥有栏几何和窗口控件避让；本笔记拥有标签收起和会话栏页头预留。

## Problem

Session log、Git 和分栏开关作为 `#dshd-shell-titlebar-trailing` 画在共享标题栏行上，在会话栏与详情栏上 `justify-self: end`。会话栏页头（标题、`header.actions` 的 preset 标签）占用同一行，右侧只有 28px padding。窗口宽于 1024px 时，侧栏和 surfaces 仍会把中间栏挤窄，`data-compact-header` 不生效，尾簇就会盖住「标准模式」。若在这一宽度藏掉整簇，用来收回宽度的 surfaces 开关也会一起消失。

## Decision

AppFrame 测量 `#dshd-shell-titlebar-trailing`，在尾簇可见（非手机、非 compact-header）时发布 `--dshd-titlebar-conversation-reserve` 为 `max(0, trailingWidth - detailsWidth)`。会话栏页头的 `padding-right` 为 `max(28px, reserve + 8px)`，标题走省略而不是互叠。

标签密度由求解后的会话栏宽度决定，而不是尾簇当前宽度，因此收起标签不会让密度振荡。会话栏 ≥ 720px 为 `full`。低于 720px 为 `cozy`：Session log 只留图标（保留 aria-label），`header.actions` 隐藏。低于 560px 为 `compact`：分支触发器和 Initialize Git 也去掉文字。Commit 与分栏开关在按钮仍绘制时保持文字。详情栏打开或尾簇隐藏时密度为 `full`。AppFrame 写入 `data-titlebar-density` 以及尾簇 owner 的 `density` 字段。拥挤密度从不移除 Git 或分栏开关；这些按钮只在对应的界面设置开关关闭时离开尾簇。

## Alternatives considered

**中间栏变窄时隐藏整段尾簇。** 拒绝，因为分栏开关是用户关掉 surfaces、收回宽度的出口；手机 / `data-compact-header` 的整簇隐藏仍是 <1024px 的路径。

**把 Session log 和 Git 收进「⋯」溢出菜单。** 本轮拒绝：官方标题栏没有 kebab，而且开关仍必须留在菜单外。收成图标复用现有胶囊。

**标题栏换到第二行。** 拒绝，因为共享标题栏行与 surfaces 标签栏同高。

**用避让后的页头剩余宽度做容器查询密度。** 拒绝，因为剩余宽度依赖尾簇宽度，而尾簇宽度又依赖密度。

## Consequences

拥挤密度从不从被挤窄的桌面会话栏移除 Git 或分栏开关。这些按钮只在对应的界面设置开关关闭时离开尾簇。先收的仍是 preset 标签和 Session log 文字。在 `data-compact-header` 仍于 1024px 以下隐藏整簇时，`compact` 档很少出现（该宽度下侧栏最大也让中间栏 ≥ 604px）；保留这一档是为了以后改 compact-header 时不会重新互叠。

## Testing

`titlebar-density.ts` 钉住两个函数。AppFrame 钉住避让、详情栏打开时的 full 密度、surfaces 把中间栏钉在 640px 时的 cozy，以及 compact-header 时 reserve 为 0。Session log 在 cozy 去掉可见标签。BranchMenu 在 compact 去掉分支名。会话栏页头 CSS 钉住 padding 公式、header-actions 隐藏、控件 no-drag，以及仍占第 1 行的 blank caption。AppFrame 尾簇 CSS 钉住 8px 间距、max-content 的 `no-drag` 空洞、`--dshd-wco-controls` inset、唯一的 caption drag 带，以及手机菜单的 `no-drag`。`apps/web/tests/desktop-chrome.e2e.ts` 拒绝 Session log / Git / 分栏开关水平互叠，并在 surfaces 打开时打开 branch menu。桌面 `src/main/harness-chrome-inject.test.js` 钉住只拥有窗口控件的注入。源码与打包 Electron smoke 在打开 surfaces 后，按真实坐标点击这些尾簇控件。

## Related

[桌面 surfaces 栏、标题栏尾簇与窗口控件避让](../architecture/2026-08-14-desktop-surfaces-and-titlebar.zh.md)。[<1024px 隐藏尾簇](../feature/2026-08-14-phone-overlay-shell.zh.md) 由手机覆盖层外壳笔记拥有。[界面设置的 chrome 可见性](../feature/2026-08-19-interface-settings-chrome-visibility.zh.md) 拥有从尾簇省略 Git 和分栏开关的开关。
