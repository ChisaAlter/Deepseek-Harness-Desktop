# Decision: 干净 CI 的构建前提与物理路径一致性

Status: implemented

中文 | [English](2026-09-28-clean-ci-portability.en.md)

## Problem

候选 89850d10de0 的远端测试暴露本机已有产物掩盖的问题：快捷键与插件兼容性测试需要上游 lib，但桌面 job 未构建；macOS 临时目录的 /var 与 /private/var 别名使实例检查误判、相对链接失效，并使导入故障夹具提前触发父链接拒绝。另有跨平台入口路径和未保持事件循环的 drain 定时器缺陷。

记录审计：[实例布局](../architecture/2026-09-28-runtime-instance-layout.md) 的一源一目录契约保持，本次补物理路径归一；[任务保护](../architecture/2026-09-25-task-protection-coordinator.md) 的 drain 结果必须兑现，不改变确认策略；[GUI 回归对齐](2026-09-28-release-gui-contract-reconciliation.md) 保留检查强度，本次声明干净 runner 所需前提。

## Decision

- CI 桌面矩阵显式安装上游依赖并构建桥接 lib，预算覆盖构建；不跳过依赖真实桥接的测试。纯源码圆角断言仍不读产物，编译后断言在 vendor 构建后执行。
- 实例装配和比较使用物理根，POSIX 相对链接从物理父目录计算，避免把同一目标的别名视为不同实例。
- 工作区权威使用原生同步 realpath，与异步文件读写保持同一坐标，避免 Windows 8.3 短名导致合法访问被拒；不在副作用阶段重新跟随授权根来迁就别名，外链与 .git 拒绝保持不变。
- 导入与工作区夹具使用真实临时根；恶意子链接的负例与生产父链接拒绝不放宽。媒体许可测试显式提供 OS 授权事实，异步等待回调。
- 组件入口在所有宿主上拒绝 Windows 绝对/驱动器相对路径，统一路径分隔符后再验证根内边界。
- 被 await 的 drain 超时保留 timer 引用，finally 清除 timer；既不丢结果，也不让已排空的操作多等待。独立 Node 进程回归验证只有该 timer 时仍返回超时结论。

## Alternatives considered

- 跳过 macOS 或缺 lib 测试：会保留干净环境与平台缺陷，拒绝。
- 全面放开导入父链接：会削弱数据保全；规范化测试根而保留生产保护，拒绝放宽。
- 仅增加 drain 测试等待时间：事件循环已经退出时无效；修正 timer 生命周期。

## Consequences

桌面 CI 增加桥接构建成本，换取真实运行时契约覆盖。路径别名比较与创建采用相同物理坐标，Windows 仍使用 junction。定向 162 项通过，最终平台矩阵结果记录在[发布准备报告](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md)。
