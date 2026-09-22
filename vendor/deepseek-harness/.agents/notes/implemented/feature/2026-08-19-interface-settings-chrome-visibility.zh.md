# Agent Note: 界面设置的 chrome 可见性

Status: implemented

[English](2026-08-19-interface-settings-chrome-visibility.md) | 中文

## 问题

标题栏的 Session log、Git、分栏开关，以及 composer 发送/思考时的边光，没有产品开关。靠卸载 owner 来藏按钮，会一并丢掉 `/export`、Git 的 toast 与对话框，以及 `Ctrl+\`` / `Ctrl+\\`。把缺失的 Host section 当成 false，会在加载中和远程 `memory` 作用域把控件全部藏掉。

## 决策

设置注册「界面设置」分区（`settings.section` id `interface`，order 6，中文「界面设置」/ 英文 `Interface`），只 `renderSlot` `settings.interface.item`。`ui-settings-general` 拥有这个空壳。每个功能包拥有自己的 Host boolean 和 Switch 行。chrome 字段默认 `true`；`composerResize` 默认 `false`：

| 字段 | Host namespace | 行 id / order |
|---|---|---|
| `titlebarAction` | `session-log-export` | `session-log-export` / 10 |
| `titlebarGit` | `ui-git` | `titlebar-git` / 20 |
| `terminalToggle` | `ui-titlebar` | `terminal-toggle` / 30 |
| `surfacesToggle` | `ui-titlebar` | `surfaces-toggle` / 40 |
| `composerBeam` | `ui-conversation`（`ConversationSettingsSchema`） | `composer-beam` / 50 |
| `composerResize` | `ui-conversation`（`ConversationSettingsSchema`） | `composer-resize` / 60 |
| `statsLine` | `ui-conversation`（`ConversationSettingsSchema`） | `stats-line` / 70 |
| `viewTabs` | `ui-conversation`（`ConversationSettingsSchema`） | `view-tabs` / 80 |

可见性是 `snapshot.value?.[field] !== false`。加载中、unavailable、`value === undefined`、以及远程 `memory` 都保留本地的显示默认。`composerResize` 是例外：它是显式开启（`=== true`），因为现网 composer 只按草稿自动增高、没有拖动手柄，缺失 Host 字段不得在首屏打开拖动。Switch 写入先本地发布，再 `host.set`。远程 `writable: false` 禁用 Switch，chrome 仍显示。

藏按钮不卸功能。Session log 只藏标题栏胶囊；Dialog 仍挂着响应 `/export`。Git 只藏初始化 / 切分支 / 提交簇；Toast、Commit、Publish 和确认 Modal 仍挂着。PanelToggles 从不 `return null`：隐藏的按钮省略，空簇不绘制，keydown 监听仍在。InputBar 仅在 `beamLive && composerBeam` 时加 `.cardBeam` / `data-beam`。关掉 `composerResize` 会去掉 InputBar 和 ApprovalPanel 的上/左/右拖动手柄并清除内联滚动区高度与卡片宽度，包括 `[data-composer-seat]` 上的 `--dsh-composer-resized-*`；textarea、镜像层和 14 行自动增高仍在。关掉 `statsLine` 时 StatsLine 用 `visibility: hidden` 藏掉数字并保留 composer dock 行高；dock 注册以及 `sessionStats` / `tokenUsage` 投影仍在。没有数字的空会话仍不渲染该行。关掉 `viewTabs` 时不画顶栏 tablist；`views.list()` 仍含对话与轨迹，当前视图（包括轨迹）不变。关掉面板开关不会强制关闭已打开的抽屉或列。

绑定 settings 的 fiber 必须 inject `connection`、`remote`、`settingsScope`。思考边光和拖动调整的 store 在 `ComposerBarInjected.hooks.composerBeam` 与 `composerResize`，与 `notices` 并列，不在 `busyEnter`。ApprovalPanel 通过 `ApprovalComposerInjected.hooks.composerResize` 读取同一个拖动 store。统计条 store 在 `StatsLineInjected.hooks.statsLine`。页签 store 在 `ConversationSessionHeaderInjected.hooks.viewTabs`。

## 考虑过的替代方案

**把 git / session-log / beam / 面板字段注册进 `ui-settings-general`。** 拒绝：该包 Host 只注册 `ui-onboarding`；功能行留在功能包。

**封闭的 `InterfaceSection` 自绘五开关。** 拒绝：通用页已经用 `settings.general.item`；界面页跟同一套 list slot。

**新开 `ui-interface` Host 命名空间。** 拒绝：`composerBeam` 属于现有 conversation section；每个 chrome owner 已有 namespace。

**在整个 Git / Session-log / PanelToggles 组件上 `if (!value?.git) return null`。** 拒绝：缺失 section 会在首屏和远程 Web 把 chrome 藏光，卸载 Git 或 Session log 会丢掉 `/export` 与忙碌中 Git 仍需要的界面。

## 后果

界面设置是标题栏 chrome、composer 边光、输入框拖动调整、会话统计条和「对话 / 轨迹」页签的堆叠页。拥挤密度仍按会话栏宽度计算；Git 和分栏开关只在对应界面开关关闭时离开尾簇。侧栏、composer 其它按钮、Surfaces 工具条、窗口控件、设置齿轮不在本页。

## 测试

各 Host spec 钉住 chrome schema 默认 `true` 并拒绝非 boolean；`composerResize` 默认 `false`，同样拒绝非 boolean。ChromeVisibility（边光、统计条、页签走 `ComposerSubmissionPolicy`）钉住 loading / memory / 缺字段仍显示、Switch 先本地写入再 `host.set`、仅显式 `false` 才隐藏。`ComposerSubmissionPolicy` 钉住 `composerResize` 在 loading / memory / 缺字段保持关闭，仅显式 `true` 才打开。GitActionsControl 在初始化 toast 与提交对话框仍挂着时藏掉标题栏簇。HeaderAction 藏掉胶囊后 `request()` 仍打开 Dialog。两个面板开关都关时 PanelToggles 仍响应 `Ctrl+\`` / `Ctrl+\\`，且不绘制 `[data-panel-layout-controls]`。InputBar `running` 且 `composerBeam: false` 没有 `data-beam`。InputBar 和 ApprovalPanel 默认没有 `[data-composer-resize-handle]`；`composerResize: true` 才显示上/左/右手柄，从上边拖动设定当前占用滚动区高度，从侧边拖动设定卡片宽度。ApprovalPanel 在 `[data-composer-seat]` 上采纳并发布该尺寸。`statsLine: false` 时 StatsLine 保留 dock 行并用 `data-stats-line="hidden"` 藏掉数字。`viewTabs: false` 时 ConversationSessionHeader 不绘制 `tablist`，当前视图（包括轨迹）仍渲染。apply spec 钉住 `ui-settings-general` 三个分区、以及各功能包自己的 `settings.interface.item` 行。设置导航快照含「界面设置」/ `Interface`。

## 相关

[标题栏拥挤密度](../bug-fix/2026-08-17-titlebar-crowding-density.zh.md)。[Host settings 支撑的 Web 偏好](../bug-fix/2026-08-06-host-backed-web-preferences.zh.md)。[审批接管跟随输入框拖动调整](../bug-fix/2026-08-20-approval-panel-composer-resize.zh.md)。
