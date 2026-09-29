# Decision: 鲸鱼娘默认开启与非阻塞重启

Status: implemented

中文 | [English](2026-09-29-whale-default-restart.en.md)

## Problem

用户要求鲸鱼娘默认开启，并报告打开开关后桌面卡住约半分钟。配置默认值为 false；重启先停止旧 Harness，之后才切回恢复页。Windows 进程查询和终止使用同步命令，阻塞 Electron 主线程。

## Decision

`whaleAssistantEnabled` 默认 true，已有显式 false 保留。桌宠形象开关保持独立。任务保护批准重启后，控制器先显示既有恢复画布，再停止旧服务。进程查询与终止改用有超时、隐藏窗口的异步 execFile；停止、残留清理和启动失败清理均等待终止完成，保留 PID 来源、进程名称白名单、自身进程排除和代际检查。

用户明确确认扩展修改 `src/main/dsh.js`。不改变 inspect/acquire/drain 或任务中断确认，不以缩短排空期限伪装加速。

## Alternatives considered

只改默认值能避免首次手动开启，但不能修复后续开关的阻塞。只提前显示恢复页仍会在同步系统命令期间冻结动画，故同时异步化进程清理。

默认迁移覆盖所有 false 会取消用户已保存的关闭选择，故只修改缺省值。热挂载插件需要另一套生命周期契约，本次保留既有重启机制。

## Consequences

默认即可使用助理；重启等待有恢复页，进程停止期间事件循环可响应。服务重新加载仍需时间，不承诺秒开。异步化要求所有清理调用等待完成，回归覆盖停止期间不清 PID、不启动下一代，以及非 node/dsh 进程拒绝终止。

隔离 Electron 实测：修复前一次重启约 17.5 秒，主线程停顿约 2.1 秒；修复后一次约 24.9 秒，恢复页在重启开始后约 16 毫秒就绪，切换期间无超过 500 毫秒的主线程停顿。两次负载不同，不作为整体启动提速证据。隔离实例的任务确认自动接受，未修改生产确认行为。定向测试 324 项通过；证据见 [QA 记录](../../../qa/results/2026-09-29-whale-restart/RESULTS.md)。

相关决定审计：[唯一常驻会话与设置](../product/2026-09-24-whale-single-conversation-settings.md)部分重叠，保留会话与 IM 语义；[退出连接误报](2026-09-29-quit-transport-false-positive.md)仅涉及任务检查，保留；[性能局部回退](../architecture/2026-09-24-whale-performance-partial-rollback.md)涉及绘制调度，与本次停止链路无关。未找到需取代的默认开关决定。
