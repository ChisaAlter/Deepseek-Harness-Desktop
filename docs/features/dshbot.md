# Feature: dshbot detachment

| Field | Value |
| --- | --- |
| **id** | `dshbot` |
| **status** | `removed-from-desktop` |
| **last verified** | 2026-09-10 — Hermes 式受管会话顶部已收口：Bot/群聊保留真实标题、根级面板与窗口控制，隐藏预设、轨迹、Session 日志、Git 分支及 Commit；实机同时验证普通 New Session 仍显示这些开发入口。展开侧栏一级区域切换与 Bot 页三级切换均横向等分；受管 composer 保留普通会话同高 footer，实机两者输入卡底边间距均为 32px。Bot 资料的工具、Skills、MCP 明细改用共享选择弹窗，主表单仅保留模式、范围和选择摘要；取消丢弃弹窗草稿，完成后仍需资料保存。形状头像增加 Hermes Bots 的空闲/工作动态脸、共享 15fps 可见性时钟和 OpenBot 式选中环；图片头像与减弱动效保持静态。群聊正文接入通用 composer-overlay 协议并恢复内部滚动，最后一轮操作保持在输入框之上；最新一轮默认展开且不显示冗余收起按钮，历史轮次折叠为摘要，显式展开后才显示“收起本轮对话”；插件 body 接管空白 Session 时隐藏普通空白画布，新群不再被两个 flex 子项挤成半屏，空态使用 Hermes Bots 群聊提示；侧栏群运行态仅在待审批、成员错误或 Session 缺失时展开。OpenBot 固定提交源码复核后，群页改为宿主唯一标题、紧凑成员头像和按需活动区，移除常驻空闲成员行及空活动占位；无正文执行状态移出聊天记录，最新轮次不画 thread 轨道。插件浏览器 49/49、相关客户端测试 160/160、完整客户端类型检查及 official build 通过；实机验证新群正文高度 846px、空态内容区 716px、占位画布高度 0、无文档溢出，并确认 3 名成员群页无重复标题、无空闲状态行、正文只显示真实发言。桌面仍不预置 dshbot；冻结范围、排除项、发布与默认 profile 边界不变。 |

## User paths

1. 全新桌面不附带 dshbot 源码、预置、推荐卡或专属发布流程。
2. 旧桌面预置只移除受管装载块及指向旧预置副本的链接，不重新复制或装载插件。
3. 用户自行安装的 dshbot 仍作为普通插件列出；不兼容时在启动器单独禁用，独立插件修复后可重新启用。

## Invariants

- 本仓没有 `vendor/dshbot` 实现、开发预置开关消费者、专属导出/发布脚本。
- 用户插件包、manifest 依赖与 bundles、机器人设置、记忆、房间 preset 和会话不因预置清理而删除。
- 普通禁用仅移除该插件的装载声明，保留依赖和磁盘数据；通用启用可恢复装载。
- 不因本体剥离把 dshbot 加入永久禁止安装名单；市场不额外注入第一方推荐，目录与用户安装仍走通用规则。
- 旧的桌面预置代码副本可以留在磁盘作为恢复材料，但不再被自动引用。

## Allowed touch

- `vendor/dshbot/**`、`src/main/dshbot-*.test.js`、原 `src/main/dshbot-preset.js` 的移除
- `src/main/legacy-dshbot-preset.js` 及测试；`index.js`、`harness-controller.js` 仅旧预置调用
- `src/main/marketplace-catalog.js` 及测试；`release-ui-walk.js` 及测试；`src/shared/post-merge-ui.test.js`
- 本仓 dshbot 专属导出、发布脚本及 workflow 的移除
- 本卡、handbook、Feature 索引、短规则、发版说明与 QA 记录
- 独立插件所需的通用 Session presentation、managed composer、pending
  interaction 与 `conversation.session.body` 扩展；实现不得识别 dshbot
  包名或恢复桌面预置关系，普通会话行为必须保持不变
- `ui-sidebar` 展开态区域切换的通用等分几何及聚焦样式测试；折叠 rail
  必须保持既有纵向圆形导航

## Gates

- 无插件源码的桌面构建与启动。
- 新 profile、旧受管 patch/link、真实用户目录安装、pnpm 链接安装均有测试。
- 单独禁用和重新启用保持其他插件及用户数据不变。
- 通用插件归因、启动失败恢复和完整桌面回归通过。

## Sources

- 独立维护边界：`ChisaAlter/dshbot`，不由本仓发布。
- 本体入口：`src/main/legacy-dshbot-preset.js`。
- 旧决策与历史验收保留于 `docs/superpowers/`、`docs/qa/`，不代表本版仍交付机器人功能。
