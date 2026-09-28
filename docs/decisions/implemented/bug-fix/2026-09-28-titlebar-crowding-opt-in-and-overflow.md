# Decision: 会话日志默认收起 + 次级 Agent 操作溢出按钮

Status: implemented

中文 | [English](2026-09-28-titlebar-crowding-opt-in-and-overflow.en.md)

## Problem

实机窗口里会话标题行经常余量不足：`Session 日志` 胶囊、`Git` 胶囊与终端/右栏开关组成的尾簇本就吃掉约 500px，再叠加窗口控件避让后，「N 个子智能体」「智能体团队」「标准模式」这些 `conversation.session.header.actions` 徽章在 `cozy`/`compact` 密度及 520px 容器断点下被整体 `display:none`——挤没之后没有任何入口能把它们找回来。同时 Session 日志按钮对大多数会话是低频次级动作，却常驻占用尾簇最宽的一段。

## Decision

两处分头处理：

1. **Session 日志胶囊改为界面设置 opt-in**。`session-log-download` 设置段的 `titlebarAction` 默认从 `true` 翻为 `false`；`ChromeVisibility` 增加初始默认参数（本插件传 `false`），并在 `initial === false` 时把判定收紧为 `value[field] === true` 才显示，保证加载中/远端记忆快照也不会闪出按钮。`shell.titlebar.trailing` 的槽位注册、`/export` 命令、下载对话框逻辑完全不变；「设置 → 界面 → 会话日志导出」开关可重新打开按钮，release QA 在 `interface.sessionLogSwitch` 步里验证这条开启路径并把开关还原。
2. **被收起的 header actions 提供溢出入口**。`ConversationSessionHeader` 在 utilities 前挂一个 28px 箭头按钮：仅在 `data-titlebar-density` 为 `cozy`/`compact`（即 inline actions 带被 CSS 收起的同一判定）时渲染；悬停/聚焦临时弹出 `role="group"` 面板展示 `conversation.session.header.actions` 槽内容，点击 pin 住，Esc、外部 pointerdown 或再次点击收起；密度回到 `full` 时整个座席卸载、状态清零。面板用 portal 挂在按钮容器内（与 jobs 菜单同级思路，避开 `headerActions` 的 `overflow:hidden`），采用 `--dsw-specific-menu` + `--dsw-elevation-panel` 菜单表面。

## Alternatives considered

- **把徽章直接搬进 utilities 槽**：utilities 在窄态仍显示，搬过去等于不收起，违背了「先保标题」的既有决定；且 actions 槽的条目（含未来插件）应保持一致去向。
- **只对子代理徽章做溢出**：徽章列表是插件化槽位，宿主不知道哪些条目在场；对整条 actions 带做统一溢出座席，任何注册方自动受益。
- **Session 日志按钮挪进溢出面板**：它属于尾簇而非会话 header actions，且打开后会改变尾簇实测宽度、回灌密度选择——保留开关式 opt-in 无此反馈环。
- **用 `role="menu"` 包装弹出面板**：actions 内容是自带菜单/对话框的徽章控件而非 menuitem，`role="group"` 是正确语义。

## Consequences

默认标题栏少了一个 ~120px 的胶囊，拥挤窗口中子代理/团队/模式徽章不再无故消失——被收起时箭头按钮悬浮即看、点击常驻。存量用户从未写过 `titlebarAction` 字段的也会落到新默认（隐藏）；已显式开启的用户不受影响。新增 `skeleton.client.spec.tsx` 两条覆盖悬停预览、点击 pin、Esc 关闭与密度往返；`chrome-visibility`/`client-apply`/`host`/`route`/`archive` 测试随默认值更新，`desktop-chrome.e2e.ts` 经 `sessionLogTitlebarAction` scaffold 选项验证 opt-in 后的集群布局。
