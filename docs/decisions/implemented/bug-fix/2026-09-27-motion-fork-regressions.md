# Decision: 恢复合并丢失的桌面动效

Status: implemented

中文 | [English](2026-09-27-motion-fork-regressions.en.md)

## Problem

`dsh-v0.1.7-alpha.2` 与 `dsh-v0.1.7-rc.2` 两次上游合并把桌面 fork 的动效调用点解析成了上游版本，而没有任何门禁发现：

- 模型/推理触发器从 `FlipText` 退回普通 `<span>`，选择后文案直接闪切。
- `Menu`、`MenuView`、`Tooltip`、`HoverCard`、`DisclosureRow` 丢掉 `data-dsh-motion` / `usePresence` recipe 标记，弹层不再淡入淡出、展开体直接跳变。
- 转录呈现设置行（`PreferenceRow`）同样丢失 `FlipText`。
- `Tooltip.module.css` 保留 `tooltip-in` keyframes，但 `.bubble` 从未引用，成为死代码。

原因是这些调用点位于上游拥有的文件里，`src/shared/harness-desktop-forks.js` 的 fork 标记只覆盖了桌面自有包与部分文件，动效调用点不在其中；合并时“取上游”不报错。视觉表现与 `docs/motion.md` 的 `flip` / `popover` / `fade` 对照表全部不符。

## Decision

按 `docs/motion.md` 恢复丢失的 recipe，并把每个调用点登记为 fork 断言，防止下一次同步再次静默覆盖：

- `ModelSelect` 的模型名与推理档、`PreferenceRow` 的选项文案改用 `FlipText`（400ms `flip`）。
- `Menu`、`MenuView`、`HoverCard`（compact 变体）恢复 `usePresence` + `data-dsh-motion="popover"`；`MenuView` 退场期间保留最后一次打开的分组快照，避免 200ms 内渲染空面板。
- `DisclosureRow` 恢复 `usePresence` + `data-dsh-motion="fade"`。
- `Tooltip.module.css` 的 `.bubble` 应用已有的 `tooltip-in`，时长走 `--ds-motion-duration-swap`。

`HoverCard` 的 `preview` 变体保留上游自己的 100ms 淡出——`close()` 只为 `variant === "preview"` 进入该 closing 相位；`inline` 与 compact 变体走共享 recipe，不叠加第二套淡出。`Menu` 的锚点追踪仍严格跟随逻辑 `open`，退场期间只冻结位置，避免关闭后继续测量。

## Alternatives considered

- **只修用户报障的模型触发器** — rejected：同一轮合并同时吞掉了菜单、展开体与 Tooltip 的 recipe；只修一处会在下一次同步后重现其余缺口。
- **在 `motion.css` 里为上游选择器补动画** — rejected：上游已不再输出 `data-dsh-motion`，样式层无从命中；必须恢复组件标记，且那正是 `motion.md` 的原话。
- **把 `MenuView` 退场快照留在 store** — rejected：store 关闭时清空分组是有意的状态语义；快照属于渲染层，用 `useRef` 保留即可。

## Consequences

代价：`Menu`/`HoverCard` 多一层 presence 状态；`MenuView` 多一份最后一次打开的快照；fork 断言增加 7 条，未来上游合法重构若要移除这些调用点必须先改 `docs/motion.md`。收益：模型与推理档切换重新翻转，菜单/浮层/展开体恢复 100–200ms recipe，Tooltip 的 keyframes 不再死代码，并且下一次 `sync:harness` 会因断言失败而不是静默退化。
