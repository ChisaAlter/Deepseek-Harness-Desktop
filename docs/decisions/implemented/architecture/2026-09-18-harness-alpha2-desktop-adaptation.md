# Decision: Harness alpha.2 的桌面接口适配

Status: implemented

中文 | [English](2026-09-18-harness-alpha2-desktop-adaptation.en.md)

## Problem

alpha.2 将会话导航从 session controller 拆到 workspace navigation，以持有引用代替全局 current 字段，并将输入队列改为 inbox。文本合并即使成功，也可能留下技能页错误作用域、代理面板无法跳转以及会话组件缺少注入的问题。

现有决定审计：[alpha.1 合并漂移裁定](../bug-fix/2026-09-17-vendor-alpha1-merge-drift-remediation.md) 部分重叠，继续提供「上游契约优先、桌面特性保真」原则；本文仅记录 alpha.2 新接口的适配，不取代历史修复。

## Decision

- 保留三方合并及原有桌面扩展，使用 alpha.2 的会话引用、状态接口和组件工厂；不恢复已删除的 current、queue 或 open 接口。
- 代理跳转经 workspace navigation 传递完整子代理地址；技能目录从主视图持有的会话选择作用域，保留按会话缓存 cwd 的防闪烁行为。
- 会话正文扩展链、插件会话呈现、无目录入口、草稿过渡、输入框宽度和键入特效适配到新工厂注入合同。主视图外的会话引用不能改变技能页作用域。
- 沙箱升级遵循 alpha.2：重复请求当前模式直接成功；请求更窄模式拒绝，不再静默沿用更宽权限。保留审批取消信号传播。
- CLI 的 `web` 名称是 profile 简写。桌面启动参数仍保持 launcher 参数在 app 参数前，测试从新 profile parser 提取真实参数定义。
- 模型编辑采用 alpha.2 的可展开共享行和有效输入类型继承；显式编辑不能取消最后一种类型，保存按 text、image 排序。桌面推理档位继续保留，旧测试通过实际展开动作验证新版合同。
- 桌面继续只由 AppFrame 的 captionDrag 声明窗口拖动区域；新固定浮层声明 no-drag，保留鼠标离开即隐藏 Tooltip 的行为，同时纳入上游嵌套 Tooltip 抑制。
- 弹层在打开的同次渲染中挂载，保证焦点 effect 能访问节点；退出仍保持 200ms。模型菜单从已提交 DOM 读取键盘行，避免渲染期间清空引用，并在退出完成后才重置子页。

## Alternatives considered

- 保留旧 session controller 接口可减少局部修改，但会形成两套导航所有权，破坏引用释放和视图同步，拒绝。
- 全部使用上游 UI 可减少冲突，但会移除已验收的桌面交互与插件扩展，拒绝。
- 将更窄沙箱请求静默映射到当前较宽模式可兼容旧调用，但不符合请求语义和上游验证，拒绝。

## Consequences

桌面代码与上游对象生命周期保持一致，代价是消费者、夹具、依赖声明及生成目录必须一并适配。固定版本更新不等同于验收完成；构建、GUI/核心契约、桌面启动与 fork 不变量由同步功能卡记录验证结果。原有用户修改逐字节保留；不创建分支或提交。
