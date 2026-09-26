# Decision: 用量热力图改贡献图、会话修复解码器内置

Status: implemented

中文 | [English](2026-09-25-usage-heatmap-graph-repair-codec.en.md)

## Problem

用量统计的月历热力图被用户判定为整体不可用：24px 大格月历在 520px 设置页内视觉笨重，月份下拉 + 起止日期输入框控件占比超过图形本体，且热力等级按当月四分位重算——同一天在不同月份颜色不一致，无法横向比较。

「修复会话」按钮在桌面运行时必失败：`runtimeCodec()` 动态 `import('@deepseek-ai/dsh-session')` 取 `decodeStorageRecord`，而该导出在 vendored pin（dsh-v0.1.7-rc.2）中已被移除（解码移入 persistence format catalog）；插件自身 `^0.1.0-rc.6` 依赖规范可解析到新版号段，混合树还会让 rc.6 的 session 包撞上只导出 `ToolCallId` 的新 `dsh-llm`，在模块链接期抛 `CallId` 错误。无论哪种解析落点，修复都在解码第一行前失败。这是 §6.5 记录的 pin 漂移同类问题——npm rc.6 的 API 面对桌面运行时不可信。

实机复验还发现第二类"读取失败"与字节损坏无关：本机唯一失败会话 `session-whale-12d39638-…` 的工件是 v3 格式（`session.v3.jsonl.zstd`，94 个 zstd 帧全部完好、seq 连续）。当前构建只能通过迁移链读 v3，而迁移在 `format v3 contains unknown event type` 处硬性拒绝：该日志含 `session/presentation`（鲸鱼插件写入）与 `user-questions/asked`——两个类型在现行事件词表中是正式成员，但不在冻结的 `RELEASED_V3_EVENT_TYPES` 内，且落盘时未带 `ignorable: true`。仅做解码+重编号的修复会原样保留 v3 头，工件修完依旧被拒——"修复成功"是假象。

## Decision

- 热力图改为 GitHub 贡献图（contribution graph）布局：182 天窗口按周一开头的周列平铺为 ~26 列 × 7 行，月份标签置于列首（首个拥挤标签让位，react-activity-calendar 同款规则），周一/三/五行标签在左；12px 圆角格 + 3px 间距，整窗宽约 430px 适配设置页。
- 热力等级改用整个 182 天窗口的四分位一次算出，跨月可比。
- 交互收敛为贡献图惯例：悬停/聚焦出 tooltip（含费用行），单击选单日，Shift+单击扩展范围，「清除选择」复位；范围仍只重算本卡汇总。键盘走 roving tabindex + 方向键/Home/End。
- 修复解码器内置为 `src/host/storage-rows.ts`：忠实移植 rc.6 `decodeStorageRecord`（三种 `*-chunks` 打包行展开为 `assistant/chunk`，其余值原样透传），不再动态导入 `@deepseek-ai/dsh-session`。新增防护：未识别的 `-chunks` 行标签抛错中止——那是更新的打包代际，重编号会破坏而非修复。
- 修复不再依赖宿主包解析结果，standalone npm 环境同样可用（找不到工件仍优雅报错）。
- `rebuildSessionLog` 按头部 `version` 分路：v3 工件走"准入重写"——逐行 JSON，凡 `seq`+`type` 事件信封中类型不在 `RELEASED_V3_EVENT_TYPES`（随包冻结词表的内置副本）且未标 `ignorable` 的，补 `ignorable: true`；其余行逐字节保留（打包 `*-chunks` 行带 `seq0` 天然豁免），不重编号（迁移按位置重排，改写 seq 反而会弄断 `sourceEventSeqs`/`surfaceOp` 引用）。迁移管道随即将这些行以 `plugin:` 前缀转为不透明事件，载荷保留——这正是上游为插件自有事件设计的通道。版本 > 4 直接拒绝（不用本版假设改写外来格式）；版本缺失或 0–2/4 走原有解码+重编号路径。

## Alternatives considered

- **保留月历只换色板** — rejected：用户明确否定了月历形态本身；且按月四分位让颜色跨月不可比，换色板不解决结构问题。
- **贡献图改用固定 token 阈值分档** — rejected：不同用户量级差几个数量级，固定阈值会让轻量用户全白或重度用户全满；全窗四分位自适应且跨月可比。
- **修复时改用 vendored `session-persistence-jsonl` 解码** — rejected：那是 pin 内部模块，公开面不含 `decodeStorageRecord`，依赖它等于把同一漂移坑换个位置再踩一次；存储行语法对既有文件不可变，内置移植是正确边界。
- **保留月份选择器叠加贡献图** — rejected：整窗一次性铺开本来就不需要翻页，加控件只会回到控件比图大的老问题。
- **修补 vendored `RELEASED_V3_EVENT_TYPES` 补这两个类型** — rejected：vendored 树跟随上游 pin，本地补丁会在每次 pin 升级时制造冲突；且桌面注入的事件类型本就该走 `ignorable`/`plugin:` 通道，词表缺项是上游冻结时点早于桌面写盘的事实，不是词表的错误。
- **v3 工件也解码+重编号** — rejected：v3 seq 被迁移按位置重排，源 seq 只服务于 `sourceEventSeqs`/`surfaceOp` 引用——重编号会错位这些引用；打包行展开后也不是历史 catalog 认识的行形态。逐行准入重写是最小且可证明正确的干预。
- **修复时直接转写 v4** — rejected：迁移的状态机（turn/step 开合、seed 边界、catalog 事实）归 harness 独有，插件重写等于分叉格式语义；准入重写让 harness 自己的管道完成升级，写盘升级仍发生在它原有的 write-open 时机。

## Consequences

月历的月份下拉、起止日期输入、上一月/下一月等 9 个 locale 键删除，新增 `heat.window`/`heat.range`/`heat.clear`/`heat.hint`。范围筛选保留但只剩点选（shift 扩展），没有原生日期输入框——这是接受的代价，换取图形本体可读。

修复路径与 harness 包面彻底解耦，任何 pin 升级不再影响它；代价是打包行语法若未来新增 `-chunks` 代际，需同步内置解码器（此时它会显式抛错而不是静默写坏）。

v3 准入重写让"读取失败"的覆盖语义扩大了一格：此前修复只对字节级损坏有效，现在也能救回被迁移词表拒收的旧格式工件。代价是 `RELEASED_V3_EVENT_TYPES` 随包冻结、需要同步维护——但它是"released"集合，定义即不再变化。被补 `ignorable` 的事件在迁移后以 `plugin:*` 形态存活：鲸鱼会话的 presentation 元数据在该会话的 v4 视图中不再是正式类型（可接受——否则整个会话不可读），载荷完整保留。若未来出现 v5+ 工件，修复显式拒绝而不是按 v4 假设改写。

## Verification

`storage-rows.test.ts` 锁三种打包行展开、malformed 抛错与未知 `-chunks` 中止；`usage.test.ts` 锁周列分组与月份标签碰撞让位；`session-repair.test.ts` 锁 v3 准入重写（未知类型补 ignorable、released 类型与打包行逐字节保留、seq 不动）与 v>4 拒绝。本机 dsh-home 37 个真实会话工件经内置解码器全量 rebuild：3227 事件、0 错误。真实失败工件 `session-whale-12d39638-…` 端到端复验：修复前 `persistence.open('read')` 抛 `format v3 contains unknown event type`，对副本跑 `repairSessionLog` 后同一 `open`+`read` 返回 192 事件。面板 typecheck / test 187 / build / check-pack 全绿。

Supersedes（部分）：[紧凑月历与会话修复身份](2026-09-23-usage-calendar-repair.md) 的月历半篇（修复身份校验决定仍有效）。
