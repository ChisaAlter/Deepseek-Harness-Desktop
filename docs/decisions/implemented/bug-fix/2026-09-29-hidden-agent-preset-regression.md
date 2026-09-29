# Decision: 隐藏预置在显式注册契约下保持不可选

Status: implemented

中文 | [English](2026-09-29-hidden-agent-preset-regression.en.md)

## Problem

「鲸鱼娘助理」本应是仅由插件与 IM 按 id 使用的内部预置，却在模式选择器重新出现。旧修复把 `hidden: true` 写在 `.agent-presets/whale-girl/preset.yml`，当时的 Harness 会扫描目录并在 roster 输出前过滤该标记；0.1.7 把预置改成插件显式 `agentPresets.register()` 后，迁移代码只搬了 `id/name/description/order/plugins`，`hidden` 既不在 `PresetDefinition` 类型里，也不经过 `list()`/`remoteExportList()`，于是文件里的标记仍在、实际选择器却无条件收录该预置。现有测试只验证注册与会话创建，没有断言内部预置绝不进入 roster，因此该回归静默通过。

## Decision

- 在 vendored `agent-preset-registry` 的公开预置契约中恢复 `hidden?: boolean`：`PresetDefinition`、`AgentPreset`、`list()` 与 `resolve()` 都保留该事实。
- `remoteExportList()` 过滤健康隐藏预置；损坏的隐藏预置仍保留在名单中，使其诊断与删除路径可见。按 id 的 `resolve()`、`mount()`、会话创建与 IM 绑定完全不受影响。
- `whalePresetDefinition` 显式声明 `hidden: true`，同时保留 `presets/whale-girl/preset.yml` 的标记作为兼容与可读事实。
- 回归分三层：registry 测试断言健康隐藏项不在 roster 且仍可按 id 解析/挂载、损坏隐藏项仍可见；桌面鲸鱼娘测试断言她的定义与源文件都声明隐藏；`harness-desktop-forks` 存活断言锁住 registry 的字段、过滤和测试，防止下一次 `sync:harness` 把能力合并掉。

## Alternatives considered

- **在 `ui-agent-preset` 客户端按 id 黑名单过滤 `whale-girl`** — rejected：这是产品层补丁，下一次上游重写选择器或新增客户端时复现；隐藏是注册表对内部预置的通用语义，应只在宿主名单边界收口。
- **保留 `preset.yml` 的 `hidden`，在插件加载时自行读文件过滤** — rejected：显式注册已不扫描该文件，再让插件重复实现元数据读取会把同一事实分散到两处，且 IM/其他 roster 消费者仍可能漏过滤。
- **删除 `preset.yml` 或把预置移出 registry** — rejected：按 id 挂载、IM 默认绑定与 whitelisted session 仍依赖该注册；隐藏而非移除才是正确边界。
- **只加一条桌面字符串断言，不加 registry 行为测试** — rejected：字符串断言无法证明 roster 真的过滤，也无法覆盖隐藏预置损坏时仍需可见的边界。

## Consequences

- 模式选择器与设置名单不再展示健康的 `whale-girl`，而她的常驻会话、桌宠入口、IM 绑定和 `agentPreset:'whale-girl'` 创建照常工作。
- 隐藏预置无法加载时仍出现在名单中并带 `broken` 诊断，避免用户无法从 UI 定位坏目录。
- vendored registry 多维护一个公开字段与两层过滤测试；代价换来所有插件自有预置共用同一隐藏语义。
- `harness-desktop-forks` 会在上游合并把 `hidden` 字段、过滤逻辑或回归测试删掉时直接失败，复发不再依赖用户报障。
