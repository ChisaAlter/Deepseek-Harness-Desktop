# Decision: 用量统计以宿主继承前缀判定计数边界

Status: implemented

中文 | [English](2026-09-29-usage-inherited-boundary.en.md)

## Problem

真实桌面会话显示 14,284 token，但统计页读到 4 个会话、0 个失败后仍为空。插件忽略投影初始化的 inheritedEventCount，等待 session/end-seed 才开始计数；恢复会话时该标记可以出现在已有回复之后。回退扫描预取最后一个标记，同样漏计。会话日志中的用量完好。

恢复非零统计后，连续刷新还复现了重复累计：deltaScan 把完整会话投影当增量合入上次聚合，缓存探针未命中或水位变化就会重复添加同一会话，总量从 52,146 翻为 104,292。

记录审计：[0.1.7 插件契约漂移](2026-09-25-vendored-plugins-017-contract-drift.md)与本次部分重叠，但其决定是清单与设置 API 适配；[修复解码器](../product/2026-09-25-usage-heatmap-graph-repair-codec.md)处理坏日志准入；[运行时链接](../../proposed/architecture/2026-09-22-usage-panel-runtime-link.md)处理挂载，后两者与计数边界无关。proposed、implemented、rejected 未找到持有本边界修复的桌面记录，保留原决定。

## Decision

投影 init(header, inheritedEventCount) 用宿主给出的零基继承前缀初始化计数边界。显式边界存在时，后续 end-seed 不得移动它；缺少元数据的旧调用者保留标记规则。回退扫描从 readSession 快照读取同一边界。投影状态升级为版本 3，使旧零值 checkpoint 与聚合缓存失效并从原日志重算。

每次刷新从空聚合开始，读取当前会话完整投影，每个会话只合并一次；删除旧的 aggregate delta 分支。保留每会话 checkpoint 复用、扫描分批让步和 overview 缓存。新增或删除会话由本轮扫描自然反映。

## Alternatives considered

- 只清缓存：可以触发重扫，但旧 reducer 会再次算出零，拒绝。
- 把所有事件都计入：恢复普通会话，却会重复计入 fork 继承的父会话用量，拒绝。
- 重写日志或移动 end-seed：原日志健康，宿主已有明确元数据；修改日志既多余又有破坏风险，拒绝。
- 为旧增量路径增加逐会话减法账本：可减少扫描，但要同步回滚日桶、模型桶、费用与排行等所有派生字段。本次采用已有完整扫描路径，避免引入另一套聚合状态。

## Consequences

恢复已有用量且保留 fork 去重；仅派生缓存在首次读取时重算，不写回会话日志。刷新需要遍历当前会话，换取正确替换、删除与稳定的重复刷新；每会话投影仍复用 checkpoint。新增回归覆盖晚到标记、无标记的已用量区间、精确 fork 前缀、回退扫描，以及实际 overview RPC 的重复刷新、新用量与删除。插件 typecheck、191 项测试和 build 通过；重启桌面连续三次刷新稳定为 52,146 token、2 个有用量会话，包含原会话的 14,284 token。
