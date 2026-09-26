# Decision: 启动页日志分区双页制——场景纯净、诊断与动作收进详情页

Status: implemented

中文 | [English](2026-09-26-boot-log-details-page.en.md)

## Problem

启动页把等宽日志常驻铺在画布底部：正常运行时它是低价值的常驻噪声，稀释了品牌与状态；而故障时最需要被读到的诊断行与恢复动作又和日志挤在同一段视口里。原型 `docs/superpowers/prototypes/boot-redesign-b2-logzone.html` 比较了四种「日志分区」处理，双页制（L1）信息最完整且与恢复语义相容。

## Decision

保留仪器画布视觉（扫描线、角轨、状态戳）与全部既有恢复语义，仅改日志/诊断的呈现结构：场景页只留 mark/brand/status/hint，底缘中央把手「详细 · 日志 NN」实时记行数；详情页（`page-details`）是同一块画布上的整页覆盖，承载栏头、failure/recovery 文案、瞬时动作四件与日志栏内滚动，「回到场景」按钮或 Escape 返回。

详情页在动作面浮出时自动翻开（`state==='error'` 或恢复 `scheduled`/`restarting`，即 `canAct`），保证重试/取消/跳板仍是零次额外点击可达；用户手动关闭后同一轮不再自动弹（`detailsDismissed`），动作面清除后复位。把手行数取 `snapshot.logs.length`（快照重播只回显可视切片，不能让计数失真），live 日志经 `appendLog` 递增。角轨 z-index 提到详情页之上，仪器边框跨页一致。

## Alternatives considered

- L2 底缘 ticker / L3 左舷回声带 / L4 载波带（同原型页内变体）：都保留日志常驻场景，噪声问题不解决；ticker 在异常时信息量不足。
- 把诊断迁到启动器 Recovery Board：违背「boot 页保留瞬时动作 + 跳板」的既有职责划分，也把启动中日志移出发生现场。
- 场景页保留小字状态副本与详情页副本同步：双份 DOM 需要维护两套 id 更新链路，收益小。

## Consequences

正常运行时场景页完全安静；异常或恢复排程时详情页自动呈上故障与全部动作。`boot.html`/`boot.css`/`boot.js` 结构更新，`boot-recovery.test.js` 以静态断言钉死详情页结构与自动翻开逻辑。设计语言「桌面启动页」段与 feature 卡同步更新；headless Edge 实拍验证 error 自动翻开、手动返回后不再重弹。
