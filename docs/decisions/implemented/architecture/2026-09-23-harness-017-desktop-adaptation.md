# Decision: Harness 0.1.7-alpha.2 的桌面接口适配

Status: implemented

中文 | [English](2026-09-23-harness-017-desktop-adaptation.en.md)

## Problem

`dsh-v0.1.7-alpha.2` 改动设置表单、会话投影、作业服务和客户端槽位。直接沿用桌面端针对旧接口的代码，会让标题栏开关、设置页、代理列表和文档预览无法编译或失去实时更新；整树替换则会移除桌面已有交互。

现有决定审计：[alpha.2 桌面适配](2026-09-18-harness-alpha2-desktop-adaptation.md) 与本次决定部分重叠，继续约束会话引用及桌面特性；[alpha.1 合并漂移裁定](../bug-fix/2026-09-17-vendor-alpha1-merge-drift-remediation.md) 继续提供上游契约优先、桌面特性保真的判定规则。本文只记录 0.1.7 新接口的适配，不取代两篇历史决定。

## Decision

- 继续以旧 pin 为共同祖先做三方合并，将官方树与桌面扩展一起纳入新 pin；pin 只标识已应用的源码版本，不代表构建或发布验收通过。
- 桌面设置消费者改用上游 `ConfigForm` 和 `configForms` 服务，保留标题栏及 Git 开关的持久化和加载期默认可见行为；不在桌面代码中复活已移除的 `SettingsScope`。
- `ui-conversation` 的可编辑会话偏好全部作为 Host `Config` 的 volatile 字段登记，沿用同一份字段 schema；否则 `ConfigForm` 虽显示可写，实际 `settings.mutate` 会拒绝未登记字段并把开关状态回退。常驻 header 与 Session header 共享一层网格和内边距，避免新槽位嵌套后重复挤压标题及右栏起点。
- `ui-theme` 的桌面外观字段同样全部登记为 Host volatile 配置，避免页面仍显示壁纸、玻璃、字体等控件却无法保存。归档沿用 `dsh.workspace.view.v5` 的 `showArchivedList`，在侧栏底部独立、默认折叠；视图选项不能绕过该设置。
- 设置壳渲染新版 `settings.launcher` 账户入口；账户插件识别 DSHD 实际的 `window.shell` 桥接。识图选择器改写新版 `llm-vision-fallback` live 配置，且补导入映射与已改名 `settings.yaml.imported` 的一次性恢复，避免升级后丢失已有识图路由。
- 官方账户菜单已经提供设置动作时，侧栏底部只呈现账户入口；未注册账户入口时才呈现原设置按钮。更新和连接状态保持独立，设置导航仍由同一个壳负责。这样两种装配方式都可用，同时避免登录后出现两个同名入口。
- 对合并版首次导入时漏登记的 `ui-theme`、`ui-conversation` 字段，从 `settings.yaml.imported` 逐字段补录；只写当前表单 schema 认可且 profile 未显式覆盖的字段，并分别记录完成标记。合并版已能编辑的主题偏好、字号和 busy-enter 不重放，以免覆盖升级后用户的新选择。
- 代理列表从会话 `projectionsBySession` 的 `subagentCatalog` 读取当前会话代理，缺少目录时再从会话父子关系回退；作业状态从上游 Jobs 服务读取。桌面仍以主视图持有的会话为作用域。
- 会话正文、文档预览和设置页按上游新槽位与注入接口接线，保留桌面会话呈现、预览动作、右栏工作环以及设计语言中既有的视觉约束；测试夹具按实际新接口调整，继续验证这些桌面行为。
- 官方聚合构建只选取仍有 `package.json` 的工作区。已删除包残留的本地 `lib` 或 `node_modules` 不应被当成待打包源码。

## Alternatives considered

- 保留旧设置与代理服务的本地兼容层能减少当前调用点修改，但会形成第二套生命周期与状态来源，让断线恢复和上游后续升级更难裁定，故拒绝。
- 保留账户菜单和独立设置按钮并列可省去入口调整，但在官方登录后的侧栏形成两个同名动作，也让关闭后的焦点归属不清，故拒绝。
- 用上游文件直接覆盖整个 vendor 树可以减少合并冲突，但会删除桌面已经验收的扩展及其回归保护，故拒绝。
- 通过删除失败用例或放宽断言让测试套件通过可以缩短迁移时间，但无法证明桌面行为在新接口上仍成立，故拒绝。

## Consequences

桌面消费方、包依赖、测试夹具和文档须与官方接口一起迁移。版本 pin 更新后仍须完成 vendor 构建、回归、桌面源码冒烟和应用重启；验证状态以[同步特性卡](../../../features/harness-upstream-sync.md)为准。本次用户明确要求提交本地快照及完成后的合并结果，提交不等于发布。
