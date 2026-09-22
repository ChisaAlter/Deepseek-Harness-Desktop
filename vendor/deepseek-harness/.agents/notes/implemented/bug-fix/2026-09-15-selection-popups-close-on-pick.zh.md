# Agent Note: 选择弹窗点选即关，退出期间回放冻结帧

Status: implemented

[English](2026-09-15-selection-popups-close-on-pick.md) | 中文

## Problem

`ModelSelect` 的卡片在点选 settle 期间保持打开。`ModelDirectory.select` 同步发布 `selecting`，所有行随即 `disabled`——列表在打开状态下整片变暗——被点击的按钮失焦，卡片的 `onBlur` 把它关进 200ms presence 退出；settle 回来的投影又在淡出中途重新发布 `current`，右缘对齐的定位还按已换文案的触发器重量了一次。一次点选在退出动画里回放出 变暗 → 恢复 → 勾选跳行 → 瞬移，看起来就是闪一下。`PopupSelectView` 是较轻的同款：`onSelect` 在飞期间往列表上方插一行 applying 状态，常见的快速 settle 让这行一闪而过。其余所有 `Menu` 消费者早已点选即关、后台 settle；Composer 这两个选择器是唯一的异类。

## Decision

`choose`/`chooseEffort` 立即关卡（`close(true)`，焦点还给触发器），注入的 `select` promise 在后台 settle；resolve `false` 与抛出的 rejection 都走 `settleSelection(false)`，经共享的瞬时 Toast 通告——`index.ts` 本就把 `select` 暴露为 `Promise<boolean>`。`mounted && !open` 期间卡片渲染冻结的 `openFrame`——在最后一次打开渲染时捕获的 state、last action、生效 effort 与 effort 选项——即[动效系统笔记](../architecture/2026-08-14-web-motion-presence-and-recipes.zh.md)已为 store 驱动菜单规定的 last-open 快照规则。定位保留最后一次测量值：`open` 变 false 后 layout effect 提前返回，触发器换文案无法再移动正在关闭的卡片。触发器保持 live，它的 `FlipText` 换文案就是 settle 反馈。`PopupSelectView` 把 applying 行门限在 `APPLYING_NOTICE_MS`（160ms）之后：在拍内 settle 的从不插行，慢 settle 仍保有反馈，且一旦显示就随冻结的退出帧保持到底。

## Alternatives considered

**保持卡片打开、只冻结退出帧。** 卡片会在整个往返期间打开且变暗——比所有兄弟菜单都差的示能——而且 disabled 行触发 blur 关卡的竞态在每次点选时依然存在。

**对选择器发起的 select 抑制 `selecting` 发布。** 那是把视图关注点塞进目录的共享状态机，还丢掉了其他消费者读取的 busy 信号。

**彻底删掉 applying 行。** 真正慢的 select 会失去唯一的卡内反馈；延迟让它只在有必要时出现。

**把 settle 发布缓冲到 presence 卸载。** 那让 store 时序耦合视图动画；冻结帧才是 presence 的既有范式。

## Consequences

Composer 选择器与其余所有 `Menu` 消费者同一份契约：点选即关、后台 settle、失败走 toast。卡内 Retry 条从此专属目录加载失败——被拒绝的点选不再有卡内示能，`ModelSelect` 头注释已写明。冻结帧同时吸收无关的退出中途发布（迟到的目录加载不会重绘正在离开的卡片）；卡片已在关闭，没有读者。`select` 的 `.then(settleSelection, …)` 顺带补上了 settle 抛错时原先的未处理 rejection 路径。规格钉住两侧：model 套件断言关闭中的卡片回放未被禁用的点选前行、勾选不跳；commands 套件断言拍内 settle 从不挂载 applying 行、慢 settle 仍会显示。
