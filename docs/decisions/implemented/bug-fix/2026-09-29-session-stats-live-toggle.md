# Decision: 会话统计开关与统计条共享即时状态

Status: implemented

中文 | [English](2026-09-29-session-stats-live-toggle.en.md)

## Problem

界面设置通过 ComposerSubmissionPolicy 立即更新开关，但 ui-chat 另外订阅 Host 配置维护统计条状态。配置写回期间，开关已关闭而底部数字仍显示；运行应用实测延迟超过一秒，跨插件回归也复现了此分歧。

三个 dock 开关的 policy 还会无条件接纳写入途中的整节配置推送。连续切换时，旧推送可覆盖尚未保存的新选择；同一开关的过期完成通知也不能代表最新点击。仅统一统计条来源不能消除这类反复跳变。

记录审计：现有[界面可见性决定](../../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-19-interface-settings-chrome-visibility.md)持有开关与保留行间距的产品语义，本次补齐跨插件即时状态的传递；不取代该决定。桌面 proposed、implemented、rejected 中未找到持有这条即时传递路径的决定。

## Decision

conversation.composer.dock 的槽位注入直接提供 ComposerSubmissionPolicy.statsLine。StatsPills 通过框架生成的 useStatsLine 订阅同一来源；ui-chat 删除独立配置镜像。开关先发布、Host 后保存，加载和外部配置更新继续由原 policy 接纳。

关闭保留统计行间隔，数字与交互隐藏；开启恢复统计。费用和峰谷行保持各自开关，统计口径不变。

policy 对 statsLine、sessionCost、officialPeakValley 分别记录最新写入身份。在 Host 接受且共享配置镜像反映该选择前，保留即时状态；一次写入因后续同节写入而先完成、后发布时也不会提前放行旧配置。旧请求完成不解除新请求的保护。最新请求拒绝或抛错时回到已确认配置；确认后重新接纳外部更新，销毁后不再发布。

## Alternatives considered

- 继续等 Host 配置确认：保留较少的槽位声明，但会让即时开关与统计条在慢写回时分歧，拒绝。
- 新增跨插件服务或全局事件：能够广播切换，但已有 dock 是统计条的宿主，槽位注入即可传递其拥有的状态，拒绝额外通道。
- 仅在请求返回时解除保护：共享 ConfigForm 可能延迟发布被后续写入取代的响应，仍会暴露旧镜像；同时等待接受与镜像确认。

## Consequences

统计条与开关同步，不依赖写回延迟。dock 的类型契约增加可观察偏好，消费者通过派生 props 获取；回归覆盖旧推送、三个字段交错写入、同字段往返点击、过期成功/失败、最新失败恢复、外部更新与销毁。既有组件测试覆盖隐藏后留白及费用/峰谷显示矩阵。本次不重写设置持久化，也不改变三个开关的产品联动规则。
