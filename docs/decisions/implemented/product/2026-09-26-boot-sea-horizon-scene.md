# Decision: 启动页改海平线画布——深空/深海分界 + 底缘 ticker + 日志抽屉

Status: implemented

中文 | [English](2026-09-26-boot-sea-horizon-scene.en.md)

> Supersedes [2026-09-25-boot-page-responsive-instrument-canvas](../../archived/product/2026-09-25-boot-page-responsive-instrument-canvas.md)

## Problem

用户明确要求重新设计启动页（「之前要求重新设计启动页，一点都没动」），仪器画布（扫描线/角轨/状态戳）需要整体退场。经过三轮方向原型（sonar / 深海极简 / 舷窗）与日志分区变体评审，定稿为 `docs/superpowers/prototypes/boot-redesign-b2-horizon.html`：62% 高度一条干净的交接线，线上深色是深空（星云三团 + 银河斜带 + 双层星场）、浅色是高空云气；线下是深海（整体调暗 + 表层透光软衰减 + 悬浮微粒 + 海底暗角），无光束无涟漪无辉光装饰。

## Decision

启动页整体改为海平线画布，替代仪器画布与双页详情结构：

- 场景：`.scene` 承载 `--boot-scene` 双色渐变 + `.stars`（星云/星尘/亮星）+ `.horizon` 1px 干净水线 + `.underwater` 调暗罩层（表层透光）+ `.abyss` 暗角；鲸鱼标、角轨、扫描线、角标 meta 全部移除。
- 字标：「Whale Isle」改衬线展示字栈（Didot/Bodoni 系），窄亮带 6s 周期扫掠（`background-clip: text`），中文副标不闪。
- 状态：启动态只呈现「启动中」+ 三点呼吸省略号；就绪/异常态省略号收起，恢复倒计时与诊断文案仍在。
- 日志：底缘单行 ticker（脉冲点 + 最新行 + `L NN` 计数 +「全部日志」入口），点击/Enter/Space 从底部升起毛玻璃抽屉承载带行号的完整日志（上限 400 行），ESC / 点遮罩 / × 关闭；重要行经 `isImportantBootLog` 标红。
- 动作面回到中央：error / 恢复排程 / 重启中时四件瞬时动作直接出现在场景中央，无需先翻页，故抽屉不再自动弹开，全部手动。
- `prefers-reduced-motion` 冻结扫光、星闪、微粒、省略号与抽屉动效；`data-harness-covered` 遮盖与最大化去圆角契约不变。

## Alternatives considered

- 保留仪器画布只换皮：不满足「重新设计」的明确要求，且双页详情结构已在真实使用中显得重。
- 双页详情制（L1，前一篇决定的结构）：整页覆盖对一块瞬时启动画布过重；ticker + 抽屉更安静，且动作面回到中央后无需自动翻页兜底。
- 鲸鱼半潜 / 涟漪 / 折射光束装饰：原型评审中被逐一否掉（半圆罩像泡澡、涟漪横穿视线、光束质感差），最终只留干净水线与水体调暗。

## Consequences

`boot.html` 结构重写（meta/scan/rail/mark/details 移除，scene 层 + ticker + drawer 进入），`boot.css` 整篇重写，`boot-tokens.css` 换海平线色表（星场整层也进 token，boot.css 保持零颜色字面量零明暗分支），`boot.js` 去掉状态戳与详情页逻辑、改单行 ticker + 抽屉开合。鲸鱼资产在启动页退役（`whale-spin.svg`/`whale-head.png` 仍供其他面使用）。契约测试改钉新结构：ticker/抽屉/水线断言替代 log-dock/角轨断言。本记录取代 [2026-09-25 仪器画布](../../archived/product/2026-09-25-boot-page-responsive-instrument-canvas.md) 与 [2026-09-26 日志双页制](../../archived/product/2026-09-26-boot-log-details-page.md)；恢复语义、IPC 边界、`--boot-*` 作用域约束不变。
