# Decision: 在鲸屿 Web 运行时内接入上游任务保护、快捷键、Office 与 Diff

Status: proposed

中文 | [English](2026-09-25-upstream-capability-adoption.en.md)

## Problem

当前 vendor 已钉 DSH 0.1.7-rc.2，但鲸屿运行的是独立 Node 的 Web profile，不是官方 Desktop Host。包已进入源码并不意味着对应桌面能力已装配。旧接入计划遗漏部分停止/安装入口，把普通请求拦截等同全部生产者冻结，并把 Office 降级当作完整出口，缺少可执行的恢复与验证要求。

2026-09-25 的只读核实还纠正了一个关键诊断：从业务包解析 native engine 失败，但从实际 libreoffice-kit 的 importer 可解析 Windows x64 0.1.1。不能据前者断言引擎缺失或转换必失败。完整步骤、具名源码证据及官方版本时间戳由[修订计划](../../../superpowers/plans/2026-09-25-upstream-adoption-plan.md)持有；本记录只保留选择理由，不声称已实施。

已有决定审计（仅本提案相关命中；其他品牌、安装器视觉、远程修复记录不改变本选择）：

| 记录 | 分类 | 本提案关系 |
| --- | --- | --- |
| [0.1.7 桌面适配](../../implemented/architecture/2026-09-23-harness-017-desktop-adaptation.md) | 部分重叠 | 延续上游接口优先、桌面功能保真；本提案不重新同步 vendor |
| [Launcher 独立分发](2026-09-24-launcher-standalone-distribution.md) | 部分重叠 | 保留 full/slim 及跨进程边界，只增加实际中断前的协调；不认定该提案全部已完成 |
| [单一可见右栏提案](2026-09-22-single-visible-right-sidebar.md) | 过时方向、部分重叠 | 其官方右栏所有权方案不作为现状；采用当前工作环卡的 ui-surfaces 所有权及互斥要求；不在本批处置旧提案 |
| [性能测量](../testing/2026-09-20-desktop-performance-measurement.md) | 部分重叠 | 沿用先登记测量、保留原始样本；新增 Diff 呈现测量不改旧 C1 探针结论 |
| [预览权限](../bug-fix/2026-09-19-preview-permission-origin-scope.md) | 部分重叠 | Office 不能扩大路径、frame 或资源 owner 权限；继续遵守现有授权实现 |
| [打包插件复用](../process/2026-09-22-packaging-plugin-reuse.md) | 部分重叠 | 复用必须证明闭包；Office 增加实际 importer、归档后和解包后的检查 |
| [非阻塞启动更新](../product/2026-09-22-nonblocking-startup-update.md) | 部分重叠 | 下载/检查可提前，真正中断动作才进入保护；不另建更新渠道 |

## Proposal

1. 保留 Electron + 独立 Node Web profile，以 desktop-owned overlays 接能力。P0 建立真实基线，依次交付任务保护、快捷键、Office、Diff；兼容检查从 P0 开始贯穿阶段。
2. 真退出、重启、停止、reload 清理、blockmap/full installer、slim 外部安装及独立 delta 共用协调器。确认在配置提交、附属 before-quit 清理、停止、安装器或安装树写入之前；Host 接纳控制覆盖已登记的 API、Schedule、Bots、IM、jobs，壳覆盖 PTY。owner/generation、独立控制通道、有界 drain、取消与恢复是同一合同；未知覆盖阻止自动安装。delta fallback 保持同目标排他事务，恢复未知时保留备份并阻止混合树启动，不把旧分发提案的重建 Setup 方式当成当前代码。
3. Schedule 默认关闭，启用后通过 catalog 检查所有 active 提醒，包括未来与冷 Session。Bots 仍拥有 routines；只按同源 ID 去重，不重复迁移投递。故障未知与明确禁用分开。
4. 快捷键复用上游 registry/protocol，鲸屿以窄 adapter 提供 desktop runtime、主进程设备文件、菜单及 guest 输入。有效 revision 是键帽和分发唯一依据；避免完整伪造官方壳桥，保持浏览器 Web 路径。默认键与优先级解耦：显式 local-first policy 保护终端 Ctrl+C/Ctrl+W、编辑动作、modal 与录制；用户覆盖不能抢占受保护上下文。原生层和 dispatcher 先按同一策略裁定再消费，不允许先吞键后异步拒绝。
5. Office 首版 Windows x64 完整包包含锁定的 runtime、技能、kit 与 native 闭包；按真实 Node 解包位置解析，离线首调原子安装并保留上一 digest。三格式创建/编辑/结构校验/Files 预览及 CLI 渲染、PDF、XLSX 新文件重算均有出口，cli:false 只作临时诊断。
6. Office 通过槽位接 Files；Diff 的纯呈现提入 ui-primitives，两类业务 diff 各自适配。遵守 feature 插件不得互相运行时 import 的规则，维持当前单可见右栏和高亮任务小于 50 ms 的设计要求。
7. 保留自有 Browser 及 browse picker，维持远程目录归属。回退单位是本阶段文件基线/hunks、overlay、adapter、runtime/payload 组合；用户配置、会话和官方 home 不作为清理对象。

## Alternatives considered

- **直接采用官方 Desktop Host/profile**：可获得整套装配，但会改变现有 Launcher、远程和桌面扩展生命周期，超出按需接入目标，因此不采用。
- **只在 before-quit 检查并锁 HTTP**：改动少，但安装器可能已启动，Schedule/Bots 等也可继续投递，不能满足保护目标，因此不采用。
- **让快捷键维持 Web 模式，只替换存储**：可减少 native 适配，但默认键、菜单和 guest 分发仍不一致，因此采用完整窄 adapter。
- **只隐藏 Office 失败入口或首次联网下载资源**：能迅速止损或减少体积，但无法满足三格式预览与离线可用；允许独立止损，不计完整交付。
- **直接导入 FileDiff 或复制整份组件**：接线短，但违反 feature 分层或产生两份演进来源，因此只共享纯呈现，业务状态继续各自拥有。

## Acceptance criteria

- 计划的 Q/K/O/D/C 账本逐项通过，具备源码及干净 Windows 安装态证据；未运行不计通过。
- 同一候选的 shell/vendor 检查、official build、装配及文档门禁与实际行为对应；源码 pin 不冒充发布验证。
- 中断/取消/断线/旧代解锁/安装失败均可恢复；保护覆盖范围及未知状态可解释。
- Office 真实 importer 的完整闭包、三格式矩阵、离线复制与降级恢复有证据；Diff 保留原文且高亮主线程任务小于 50 ms。
- task-owned 回退演练保留已有未提交修改及用户数据；新提案仅在对应行为和验证落地后转 implemented。

## Risks

跨进程与生产者覆盖是主要实施成本，不能用一个 HTTP 中间件隐去缺口。native adapter 会影响输入优先级，必须用实际 IME、终端和 guest 验证。Office 增加体积、磁盘峰值与二进制签名工作，需实测而非估算通过。更换 runtime/payload 不代表旧版本可读新持久数据；未验证兼容时只在隔离副本演练。当前脏工作树和其他并行修改要求按任务 hunks 回退。
