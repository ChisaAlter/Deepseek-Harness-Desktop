# Decision: 发布前 GUI 与核心回归契约对齐

Status: implemented

中文 | [English](2026-09-28-release-gui-contract-reconciliation.en.md)

## Problem

发布检查暴露退场 DOM 与立即卸载断言不一致、关闭弹窗覆盖调用方焦点、禁用入口仍被选作返回目标、桌面设置测试漏提供 shortcuts，以及桌面样式绕过 token。核心测试另依赖不存在的运行时 const enum、对非法工具调用仍要求成功组装，并意外继承临时目录外层包身份。

记录审计：[焦点与退场修复](2026-09-28-modal-focus-and-retained-exit-deactivation.md) 保留停用退场层的契约，本次补有效焦点与禁用入口；[单一右栏](../architecture/2026-09-28-single-panel-in-place.md) 保留容器所有权，本次不改变布局架构。

## Decision

- 关闭弹窗尊重调用方已聚焦的有效存活控件；原入口禁用或退场时选父层自动焦点控件。新前景层仍拥有焦点，不允许旧恢复抢占。
- 折叠测试先断言退出交互和无障碍树，再等待既定退场完成后断言卸载。设置测试提供实际声明的 shortcuts 依赖；账户菜单、侧栏品牌快照仅同步既有确认行为。
- 先更新设计语言，再把既有圆角数值归入共享 token；焦点绘制经过共享颜色变量和鼠标抑制，保留角色默认色。标题栏溢出菜单补共享材质与滚动条绑定，移除与 elevation 重复的中性描边。几何测试同时验证 token 与解析后的固定数值。
- 日志测试按公开 exporter 接口收集警告，不读取编译后不存在的 const enum。性质测试同时检查成功组装与非法调用拒绝的幂等性。插件身份测试明确建立匿名 profile 根，隔离外层仓库。
- 客户端目录生成器规范化 CRLF，再转义 TypeScript 字符串，保持跨平台一致；回放 overlay 使用现行 api-key 插件名。仅在 keyless replay 显式设置 `DSH_SNAPSHOT_HEADERS=refresh` 时更新工具说明与提示副本，并断言录制的 Session 字节不变；默认回放仍严格校验，不写任何快照。
- 冒烟等待真正的 Harness WebContents，通过首次欢迎页现有 API Key / 稍后配置控件进入工作区，不拿启动页代替。补齐 `dsh-platform-session` 安装资源及闭包断言，防止源码机存在而安装包缺失。

## Alternatives considered

- 关闭退场动画以满足旧断言：破坏已批准交互，拒绝。
- 更新所有快照或扩充样式例外名单：会隐藏真实缺陷；只更新已核对的两份快照，修复 token 消费，拒绝整体放宽。
- 为属性测试只生成合法工具名：丢失畸形输入覆盖；保留非法输入并验证其明确拒绝，拒绝缩窄生成器。

## Consequences

保留退出动效、角色几何与非法响应拒绝，测试观察真实的阶段和接口。新增焦点场景不证明全部平台的实际视觉行为；截图、源码启动和安装包验收分别记录，不互相替代。结果见[发布准备报告](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md)。
