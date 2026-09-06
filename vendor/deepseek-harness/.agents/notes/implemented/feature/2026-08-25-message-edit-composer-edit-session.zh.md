# Agent Note: 消息编辑复用常驻 composer 并保留当前会话

Status: implemented

[English](2026-08-25-message-edit-composer-edit-session.md) | 中文

## 决策

编辑面就是常驻 composer。`SessionInput.beginEdit` 收起用户草稿和图片、回填原文、发布编辑状态并重定向提交，不创建第二个气泡编辑器。取消恢复收起的内容；composer 侧取消保留输入框焦点，气泡侧取消将焦点交还铅笔。即使草稿文本未变化，编辑开始和结束也发布状态。

确认始终保留当前 Session ID，首条消息也不例外。作用域 conversation 服务通过普通附件准入和 prompt 回执携带 `editMessageSeq`，不调用 fork 或导航。Host 在附件准备后检查目标仍是最新开启轮次的用户消息、会话空闲且没有待处理工作。Pre-step 再检查目标，并提供以消息 ID 为键的 `surfaceIntents`。loop 通过既有 Session surface replacement 校验器提交修订提示词。更早轮次保留；旧用户输入、模型输出和工具结果退出模型历史。仍需使用的注入指令以保留副本重新入日志，同一来源的新上下文优先。

修订消息的 Host 所有 `source.edit` 记录目标消息和轮次。Chat 显示用户 replacement，并累计被替换轮次 ID，在实时追加、回放和分页时隐藏旧轮次行、导航项及旧版摘要贡献。压缩 replacement 仍仅作用于模型。原始日志事件保持不可变且连续，已执行的工具副作用不回滚。

## 替代方案

文件指令上下文在修订时累计保留；同一来源的新快照优先，旧的一次性通知、relay 和 recall 不保留。Client 通过 `scope.get('conversation')` 获取作用域服务，因为该 Session scope 未声明功能插件的注入属性。

Fork 后打开子会话违反「编辑不创建另一对话」的产品要求。物理截断会破坏追加式持久化和事件游标。气泡内第二套编辑器会复制 composer 状态并失去引用、附件及键盘行为。既有 surface replacement 在不做上述改变的前提下保留回放能力。

## 验证

插件测试锁定首条和后续消息不调用 fork/open、取消及准入失败。Controller 测试驱动真实 inbox 和 loop，检查模型历史、连续编辑、原日志保留及回放。Chat 组装测试覆盖实时更新、等价刷新回放和历史分页。无密钥 Web 场景启动真实 profile，验证首条及第二条消息、两侧取消、连续编辑、侧栏数量、草稿恢复和刷新。

## 限制

仅空闲时最新的纯文本用户消息可编辑。已被压缩移出模型上下文的目标会被拒绝。诊断视图保留追加式日志，编辑不撤销工具。准入失败保留修订内容，可重试或取消。
