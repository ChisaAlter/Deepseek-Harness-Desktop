# Agent Note: 持久化压缩延迟与 SQLite page size

Status: implemented

[English](2026-08-25-persistence-latency-and-page-size.md) | 中文

## 问题

物理持久化优化需要减少保留存储，同时不能把不成比例的工作转移到完整写入、读取或会话 fork。原有的 105 会话语料显示，JSONL level-19 压缩会让完整写入与 fork 耗时增加一倍以上。此前的 SQLite page-size 实验早于共享字典行压缩，所得空间收益可以忽略，因此无法确定当前行分布的最佳 page size。

该决策需要来自更多样会话的证据，包括长事件流与原语料之外的 payload。扩展后的语料包含 501 个真实会话、16,153,332 个逻辑事件与 2,002,145,570 字节序列化事件数据。

## 决策

### 存储编码保持为物理层行为并可独立解码

JSONL 把严格递增的 `sourceEventSeqs` 存为标量值与闭区间的混合数组，其他顺序保持原样。SQLite 把同一数组存为带 tag 的 zigzag-delta 或 `(start, count)` varint，并选择更小的编码。两个读取方都会在暴露事件前还原原始 `number[]`。

SQLite 使用内部整数 `sessions.id`，并只在 `sessions.session_key` 中保留一次公开会话 id，使事件行及其主键不再重复文本标识。每个 `events.data` 值仍可独立解码：写入方尝试用打包的 64 KiB raw-content 字典执行 level-3 Zstandard 压缩，结果不更小时保留 SQLite 文本。字典字节属于 schema 20，测试固定其 SHA-256 摘要；替换字典需要再次提升 schema 版本。

### JSONL 使用 Zstandard 标准级别

JSONL 写入方继续为每个持久 append 批次写入一个带 checksum 的 Zstandard frame，但使用压缩器的标准级别。无损 `sourceEventSeqs` 区间编码继续生效。各 frame 仍可独立解码，以支持后缀读取与撕裂尾部恢复；只移除昂贵的 level-19 搜索。

### 新建 SQLite 数据库使用 64 KiB page

SQLite 提供方在初始化全新 schema-20 数据库前设置 `page_size=65536`。SQLite 在 page 已分配后会忽略该 pragma，因此已有 schema-20 数据库保留其当前 page size。

Page size 属于 schema 20 的固定物理布局，并与其他固定 SQLite pragma 一样通过包内封闭的 SQL 资源应用。

### 扩展基准

每个候选方案都从同一份 501 会话语料独立重建五次，每个 append 批次包含 512 个事件。各轮轮换执行顺序，使每个候选方案在每个运行位置各出现一次。每次重建执行三轮完整读取与后缀读取。下表中的每项指标都去掉最高与最低的一次重建，再平均其余三次。完整读取与后缀读取耗时覆盖对全部会话的一轮扫描，fork 耗时覆盖全部 501 个会话。

| 后端 | 存储大小 | 完整写入 | 完整读取 | 后缀读取 | Fork |
| --- | ---: | ---: | ---: | ---: | ---: |
| JSONL `master` | 172.43 MB | 200.902 s | 8.033 s | 24.479 s | 72.670 s |
| JSONL + 来源区间 | 148.15 MB (-14.1%) | 197.281 s (-1.8%) | 7.799 s (-2.9%) | 24.582 s (+0.4%) | 72.308 s (-0.5%) |
| JSONL + 来源区间 + level 19 | 130.22 MB (-24.5%) | 329.442 s (+64.0%) | 7.764 s (-3.3%) | 24.454 s (-0.1%) | 166.177 s (+128.7%) |
| SQLite `master`（schema 17） | 438.31 MB | 69.632 s | 8.211 s | 0.546 s | 64.290 s |
| SQLite + 全部物理优化 + 64 KiB page | 233.18 MB (-46.8%) | 87.656 s (+25.9%) | 9.155 s (+11.5%) | 0.575 s (+5.3%) | 79.417 s (+23.5%) |

相对使用来源区间的标准级别 frame，level 19 可再减少 12.1% 的 JSONL 字节，但会让完整写入增加 67.0%、fork 增加 129.8%；完整读取与后缀读取分别变化 -0.4% 与 -0.5%。因此，更深入的搜索只改善保留体积，无法通过延迟敏感操作的收益抵消反复付出的编码成本。

其余条件相同的 SQLite 重建可单独观察 page-size 影响：4 KiB page 使用 256.97 MB，64 KiB page 使用 233.18 MB（-9.26%）。`events` 表的 page 内未使用字节从 30.25 MB 降至 6.95 MB，索引则从 5.92 MB 变为 6.03 MB。在该成对运行中，完整写入、完整读取与后缀读取分别变化 -0.5%、-0.4% 与 -3.8%，fork 变化 -14.8%。因此，空间收益来自更高的大记录 page 利用率，而不是索引缩小或数据省略，并且没有测得延迟退化。

## 考虑过的替代方案

**保留 JSONL level 19。** 不予采用。在扩展语料上，它相对默认级别 frame 可再减少 12.1%，却让完整写入增加 67.0%、fork 增加 129.8%，而完整读取与后缀读取的差异都不足 1%。默认级别 frame 配合来源区间后，相对 master 仍能缩小 14.1%，且没有实质性延迟退化。

**把整份 JSONL 日志压成单个 frame。** 不予采用。该方案可改善跨批次压缩，但后缀读取必须从头解压，也会失去按批次恢复撕裂尾部的能力。

**新建 SQLite 数据库继续使用 4 KiB page。** 不予采用。当前压缩行分布会在 4 KiB B-tree page 之间留下更多不可用空间，使保留字节增加 9.26%。已有数据库保留其 page size，避免改写历史数据。

**从 `events` 移除 ROWID。** 不予采用。复合主键会成为表 B-tree 键并在内部 page 中重复；105 会话对比所得数据库大于使用普通 ROWID 的表。

**对事件内容去重。** 不予采用。消息复述与工具参数只能在依赖重建假设时删除，而 compaction、重试和修剪可能让这些假设失效。物理压缩保留每个事件，不增加重建语义。

**使用逐会话 SQLite 文件或 DuckDB。** 不用于热存储。逐会话文件会失去跨会话查询，DuckDB 的 OLAP 写入模型则更适合冷批量分析，而不是持久 append 批次与低延迟后缀读取。

## 后果

JSONL 保留低成本来源优化，同时避开 level-19 的写入与 fork 代价。SQLite 以实测各项操作约 5–26% 的额外耗时换取 46.8% 的保留体积缩减；其完整写入仍明显快于 JSONL，后缀读取也仍快得多。在这份扩展语料上，完整读取与 fork 略慢于默认级别 JSONL。

新建 SQLite 数据库使用 64 KiB WAL frame 与 cache page。小型数据库可能为稀疏的 schema 与元数据 page 预留更多字节，而实测的多会话工作负载显著改善了 `events` page 利用率。Schema 20 会拒绝其他所有 schema 版本，而不是迁移它们。

## 相关资料

- [sqlite-physical-chunk-row-compression](2026-08-18-sqlite-physical-chunk-row-compression.zh.md) — 定义打包行模型；其此前的 page-size 结论适用于共享字典之前的布局。
- [zstandard-jsonl-session-logs](2026-07-19-zstandard-jsonl-session-logs.zh.md) — 定义带 checksum 的按批次 frame 容器，以及本笔记恢复的标准压缩级别策略。
