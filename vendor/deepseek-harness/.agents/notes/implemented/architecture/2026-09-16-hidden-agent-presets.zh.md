# Agent Note: Hidden agent presets

Status: implemented

[English](2026-09-16-hidden-agent-presets.md) | 中文

## Problem

插件可以在用户根目录下自播种 agent preset，让它创建的会话挂载专用组合——dshbot 为群聊房间播种 `dshbot-room`，桌面鲸鱼娘助理为她的常驻会话播种 `whale-girl`。发现层把每个播种的 preset 都报上名单，于是两者都出现在 preset 选择器里，与随包的 `standard`/`ptc`/`minimal`/`cordis` 并列，尽管它们的存在是为了组装所属插件创建的会话，而不是供人挑选。`dshbot-room` 的描述早已写着「在机器人页签建群，不是这个选择器」——用警告文案顶替元数据里根本没有的字段。

## Decision

`preset.yml` 携带可选的 `hidden: true` 标记，在 `metadata.ts` 里解析到 `PresetMetadata`，再经发现层传到 `AgentPreset`。只有字面量 `true` 生效：写错的值会让 preset 保持可见，而不是让它从名单上悄悄消失。

隐藏落在面向客户端的投影 `remoteExportList` 上：它在 preset 能组装时略去 hidden preset。宿主侧 `list()`、`resolve()` 与挂载路径从不看这个标记——hidden 是呈现，从来不是能力——因此插件按 id 创建的会话，以及 IM 通道的 per-bot preset 目录这类宿主消费方，全部照旧工作。

无法加载的 hidden preset 仍携带 `broken` 原因列出：名单同时也是删除其目录的表面，残留的播种目录会一直占着它的 id。`compositionInventory()` 同理保持完整——它报告哪个 preset 挂载哪些插件，在那里丢掉 hidden preset 会谎报诊断表面赖以存在的挂载图。

复制一个 hidden preset 得到的是可见副本：`copyComposition` 只用 `name`/`description` 重写 `preset.yml`，因此内部组合的副本会出现在它被创建出来供人选择的名单上。

## Alternatives considered

- **在每个选择器内部过滤。** 客户端的 `presetOptions()` 可以跳过 hidden 行，但标记得上线让每个表面各自重新实现同一排除规则，且设置分区的名单仍会拿内部 preset 去复制。远程投影是所有浏览器侧名单读取汇经的唯一位置。
- **播种到私有根目录。** 插件专用根目录让内部 preset 完全不进用户根目录，但发现根目录是部署配置，不是 per-plugin 通道；没有任何东西列举的根目录留不下能报告或删除残留目录的表面。用户根目录加可见性标记保住了一套播种机制。
- **按 id 约定隐藏。** 名字前缀或描述标记不用改 schema，但把命名和呈现混在一起，也表达不了「健康时隐藏、损坏时列出」。

## Consequences

`AgentPreset` 新增 `hidden` 字段；线上的 `AgentPresetRow` 不变，因为被过滤的行从不序列化。健康的 hidden preset 对选择器和管理分区都不可见——删除它的目录是文件系统操作，这是诚实的，因为播种它的插件下次启动总会把它补回来。插件停止播种、或播种副本损坏时，会留下一条用户仍能看到并移除的 `broken` 行。一处外观上的边角：运行在 hidden preset 上的会话，其头部标签按裸 id 显示组合名，因为携带显示名的名单行已经不在了——id 在那里是诚实的标签。

相关：[per-session agent presets](2026-08-03-per-session-agent-presets.zh.md) 拥有本说明扩展的 preset 模型；[copy-only preset authoring](../simplification/2026-08-08-copy-only-preset-authoring.zh.md) 拥有丢弃该标记的复制路径。
