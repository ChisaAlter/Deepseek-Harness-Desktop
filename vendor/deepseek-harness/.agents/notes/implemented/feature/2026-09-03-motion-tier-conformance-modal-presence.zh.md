# Agent Note: 动效档位合规——Modal Presence 与 token 化过渡

Status: implemented

[English](2026-09-03-motion-tier-conformance-modal-presence.md) | 中文

## 问题

[动效系统 note](../architecture/2026-08-14-web-motion-presence-and-recipes.md) 交付了五个 recipe 和 `usePresence`，但已发布的 Web UI 在三个方向上偏离了它。其一，`Modal` 在 `!open` 时直接卸载且不带 `data-dsh-motion`，于是所有建在它之上的对话框——`RiskConfirmation`、Git 各弹窗、工作区重命名/删除、目录选择，以及 MCP、Skills、Models、Agent 预设设置弹窗——虽然都列在 overlay 使用对照里，实际却毫无进出场动效，关闭即卸载，也没有 200ms 退场保持。其二，约 120 处功能 CSS transition 写死时长（反复出现的表外 120ms 档，外加 80 / 140 / 180 / 220 / 420ms 与 `.12s` / `.16s` 变体）和写死的 `ease` / `ease-out` 曲线；字面量时长不随减弱动效的 token 归零而归零，减弱动效下它们照播不误。五个已发布的无限指示器（`TodoPanel`、`StateDot`、斜杠菜单 `MenuView` 骨架、更新进度条、无框架 boot 页 spinner）完全没有减弱动效停止，多个表面还在动画布局属性（`height`、`width`、`top`、`left`、`max-width`、`padding`、`margin`、`box-shadow`）且无任何记录在案的合同。其三，一整层已发布的产品动效——骨架扫光、composer 光束、忙碌 spinner、状态点追逐——以及有意设计的编排（侧栏轨道收合相位、Hero 小鱼）游离在任何合同之外，而「Web UI 内不要再加无限旋转」的既有措辞与已发布现实直接矛盾。

## 决策

**`Modal` 加入 recipe 体系。** `Modal` 调用 `usePresence`，根节点携带 `data-dsh-motion="overlay"` 与 `data-state`，遮罩与对话框携带 `data-dsh-motion-part="mask"` / `"panel"`，`aria-hidden` 绑定逻辑 `open`。关闭后退场树保持 200ms；overlay 使用对照里的每个对话框都从原语继承进出场 recipe，而不是各调用方自行再包一层。

**Transition 的时长与缓动只吃五档。** 功能 CSS 只允许写 `--ds-transition-duration-fast`（100ms）、`--ds-motion-duration-popover`（160ms）、`--ds-transition-duration`（200ms）、`--ds-transition-duration-slow`（300ms）与 `--ds-motion-duration-flip`（400ms），共享曲线为 `--ds-ease-in-out`。累积的 80 / 120 / 140 / 180 / 220ms 字面量与 `ease` / `ease-out` 曲线已归并到最近档位；卡片级 hover 用 popover 档，微件 hover/按压反馈用 fast 档，布局轨道用默认档。

**布局属性动画以「布局轨道」的名义入册。** `TurnNavigator`（轨道 `height` / `top` / mark 宽度，自带 swift 曲线）、`WorkspaceBrowser`（行收合的 `max-width` / `margin` / `padding` / `width` 加 `visibility` transition-delay）、`UpdateAction`（进度 `width`）与轨迹时间线播放头（`left`）继续在 `--ds-transition-duration` 上动画布局属性，遵循 `AppFrame` grid 轨道的先例；拖拽中与减弱动效必须停。

**无限忙碌指示器记录为家族，而不是禁令。** 骨架扫光、composer 光束（含 420ms 光束层淡入）、忙碌 spinner 与状态点追逐是产品语言，循环周期是设计值，不进 token 表。每个使用处必须自带 `prefers-reduced-motion` 停止——五个漏网的现已补齐，手机 Web 的 flow 家族与光束层 transition 同样覆盖。新的忙碌指示器加入家族，不另造旋转。侧栏轨道收合编排（150ms 收合相位加 200ms `wide-in`）、Agent 预设席位一次性入场、Hero 小鱼 1.6s 悬停循环、用量统计面板图表入场在同一合同中记录为文档化数值；桌面产品规格（桌面仓库的 `docs/motion.md`）记录家族清单、档位规则与修正后的 Hero 小鱼数值。

## 备选方案

**在主题表里把 120ms 加为第六档。** 否决：120ms 从来不是设计决策，是累积产物；六个近似档位只会招来第七个，档位清单的意义就是新表面从五个值里选一个，而不是再造一档。

**把布局轨道改写为纯 transform 动效。** 对回合轨与工作区行收合予以否决：它们追踪滚动与内容驱动的尺寸，transform 改写要重构测量与命中测试，却带不来用户可见收益。把它们记录为带 token 时长与强制停止的布局轨道，是跟随 `AppFrame` 先例，而不是假装动效不存在。

**为兑现旧的「不要再加无限旋转」措辞而清除无限指示器。** 否决：扫光、光束与 spinner 是用户在每个加载行上都能看到的产品语言；删掉它们会拆掉 UI 依赖的运行态指示。合同现在以家族制接纳它们，并强制附带减弱动效停止。

**让 `Modal` 保持无动效，要求调用方各自包 `usePresence`。** 否决：overlay 对照的每一行都要重复包同一个 hook 和同一组属性；原语在其他所有地方都是 recipe 边界（`Menu`、`HoverCard`、`Tooltip`），共用对话框正是 recipe 应在之处。

## 后果

对话框在共享的 overlay 时序上进出场，关闭保持 200ms，因此关闭时清空状态的 store 必须在退场帧内保留最后一次打开的快照——动效系统 note 对菜单 store 已有此规则。减弱动效现在真正停得住此前写死时长的过渡与此前漏网的指示器，因为 token 化的时长随媒体查询一起归零。时长从连续统收敛为五档，微交互上的可感差异最多 40ms。代价是退场期间多保持一帧的对话框 DOM，以及一条纪律：未来任何不匹配五档的时长都先改主题表，依设计语言办理。

## 测试

overlay 消费方通过 role / `aria-hidden` 断言逻辑关闭，退场中的根节点该值保持为真，因此既有对话框规格在 200ms 保持期内原样通过；ui-primitives 全套（含 `atoms.client.spec.tsx` 中的 `Modal` 覆盖）完整通过。档位归并仅涉及 CSS，由 client 逐文件 100% 覆盖率门把守；减弱动效停止是 CSS 媒体规则，除既有的 `motion-styles` 对 token 归零的钉扎外无额外行为测试面。
