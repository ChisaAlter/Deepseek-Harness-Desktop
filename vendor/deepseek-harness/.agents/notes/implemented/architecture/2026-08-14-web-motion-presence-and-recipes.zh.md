# Agent Note: Web motion — theme recipes and Presence

Status: implemented

[English](2026-08-14-web-motion-presence-and-recipes.md) | 中文

## Problem

对话框、菜单、设置和同层切换都按 `open` 直接挂上或卸掉，没有共享的进场或退场。之后需要过渡的表面各自发明时长、缓动和卸载时机，所以弹层是硬切，新功能也无法继承同一套行为。动画库会在背景毛玻璃之上再加一套每帧运行时。样式系统已经拥有动效 token，但没有 overlay recipe，也没有退场滞留。

## Decision

**主题 recipe 加 `usePresence` 就是动效系统。** [`motion.css`](../../../../packages/client/ui-theme/src/styles/motion.css) 声明五种属性 recipe：`overlay`（遮罩淡入、面板位移/缩放）、`popover`（卡片淡入并上移 4px）、`fade`（只改透明度，给已经用 `transform` 定位的节点）、`swap`（仅进场的换页淡入）、`flip`（换文案时叠两层做 `rotateX`）。recipe 只动 `opacity` 和 `transform`。时长、缓动、位移和缩放放在 [`base.css`](../../../../packages/client/ui-theme/src/styles/base.css) 的 `--ds-motion-*` / `--ds-transition-*` token 上。`prefers-reduced-motion: reduce` 会把这些时长收成零。

**`usePresence(open)` 是唯一的退场滞留。** 它在 layout effect 里挂载，好让焦点和测量在绘制前看到树；先写 `data-state="closed"`，两个 animation frame 后再写 `"open"`，好让 CSS 过渡能播；关闭时写 `"closed"`，200ms 后卸载（减少动效时立即卸）。调用方在 `mounted` 为真时渲染，并根据逻辑上的 `open`（而不是 `data-state`）设置 `aria-hidden`，因为进场从 `closed` 开始，若按 `data-state` 隐藏，辅助技术会在进场时就看不到这个表面。

**原语吃掉 recipe，功能弹层复用它们。** `Modal`、`Menu`、`HoverCard`、`Tooltip`、`DisclosureRow` 和 `OnboardingSurface` 使用该 hook。设置、`PopupSelect`、斜杠 `MenuView`、`ImageLightbox`、composer 的 `ModelSelect` 菜单、`ContextMeter` 面板，以及侧栏工作区会话列表（`GroupSessionRun`）同样如此。composer 工具栏上的四个弹层——加号 `MenuView`、权限 `Menu`、`ModelSelect`、`ContextMeter`——都走 `popover` recipe，进出同一套时长。`FlipText` 在权限、模型和推理等级触发器文案被新值替换时播放 400ms 的 `flip` recipe（`--ds-motion-duration-flip` / `FLIP_TEXT_MS`）——设置选择器胶囊（`SettingsSelect`，覆盖语言、回车行为、权限预设、关闭行为、自启、重启策略、MCP / Skills 过滤、视觉模型、协议、网关、图源与价格面板行）、转录呈现行、Agent 预设芯片与远程设置芯片同样如此；这段滞留与 Presence 的 200ms 退场相互独立。关闭时会清空的 store 为退场帧保留最后一次打开的快照。Toast 继续用自己的停留加淡出。新的对话框、菜单和切换使用原语，或使用同一 hook 与 recipe；它们不引入动画库，也不动画 `backdrop-filter` 或大面板尺寸。

[Web 样式系统](../process/2026-07-19-web-styling-system.md) 仍然拥有 token 与 CSS Modules 框架。本笔记拥有 overlay recipe、Presence，以及不上动画库这条规则。

## Alternatives considered

**Framer Motion / GSAP / Spring。** 效果上限最高（共享布局、手势跟手），`AnimatePresence` 也已经解决退场滞留。否决原因：在 CSS Modules 旁边再开一条动画运行时，毛玻璃铬架上多一截包体积和每帧工作，而且时长若不加一层封装就会偏离主题 token。

**把 View Transitions API 当底座。** 对同层换内容来说原生且轻。否决它作为底座：给 800×800 的毛玻璃设置面板做快照偏贵，portal 进出也不好控。以后设置页签要做变形，仍可调用 `document.startViewTransition`，不必替换 Presence。

**只靠各组件自己的 keyframes。** Tooltip 和侧栏已经这样做。否决它作为系统：退场仍然需要共享滞留，每个新弹层都会复制一套时长。

## Consequences

弹层在同一套 token 上进出。新表面付出一次 `usePresence` 调用和两个属性，而不是再造一张时长表。减少动效会把已有的 token 过渡和新 recipe 一起收掉。代价是逻辑关闭后 DOM 再留 200ms、store 驱动的菜单要保留最后一帧，以及测试把 `aria-hidden` 当作已关闭。

## Testing

`usePresence` 钉住第二帧进场、200ms 退场滞留，以及减少动效时的跳过。`FlipText` 钉住 400ms 退场滞留、超时卸掉，以及减少动效时的跳过。`motion.css` 钉住五种 recipe、只过渡 opacity/transform，以及被收成零的时长 token（含 `--ds-motion-duration-flip: 0s`）。壳的 `base.css` 钉住 `motion.css` 排在 `base.css` 之后。弹层消费方通过 role / `aria-hidden` 断言逻辑关闭，而不是立刻卸载。这些套件走 `test:gui` 和逐文件 100% 覆盖门禁，不是浏览器 golden 像素。
