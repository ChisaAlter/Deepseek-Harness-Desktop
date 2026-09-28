# Decision: 启动器停止失效与控件互斥修复

Status: implemented

中文 | [English](2026-09-27-launcher-stop-controls.en.md)

## Problem

用户报告两处启动器缺陷：「关闭桌面端」点击后桌面端仍在运行；运行态下「打开桌面端窗口」与「关闭桌面端」两按钮同时存在，而非按状态互斥。实机追因发现停止链路叠着三个独立 bug，任何一个都足以让停止失效或行为异常：

1. **控制面 URL 被 token 查询串吞掉**：`dsh web` 就绪行打印的是带认证查询的 URL（`http://127.0.0.1:3080/?token=…`），`dsh.js` 原样存入 `baseUrl`（BrowserView 加载与会话 cookie 也依赖该串）。`task-protection.js` 的 `controlOp` 直接拼接路径，实际请求变成 `GET /?token=…/dshd-task-control/inspect`——路径仍是 `/`，落到 SPA fallback 返回 405。inspect 永不成功，覆盖按未知处理，acquire 同样 405，commit 永不执行。
2. **升级 socket 终身占用 pending 使 drain 永远超时**：`gateUpgradeHandler` 把准入从 accept 一直持有到 socket close。Web UI 常驻两条 `/api/remote.mux` WebSocket，acquire 的 drain 等这两条永远不 settle 的 promise，40 秒后返回 `dshd/drain-timeout`。修复 405 后 stop 实际走到这里才失败——真实死因，日志表现是「确认后无事发生」。
3. **schedule 覆盖误报 unavailable**：`collectSchedule` 不看 `DSHD_SCHEDULE_ENABLED`——桌面默认不开启 schedule（stock overlay `disabled: true`），服务恒缺席，于是每次停止都因「部分后台服务状态未知」弹确认。README 契约本就写明 flag 未设应报 `intentional-disabled`（`collectBots` 已照办，schedule 漏了）。

同时，渲染层 `syncDesktopControls` 故意让 start 常显（运行态改名「打开桌面端窗口」走单实例聚焦），造成两控件同屏。

## Decision

1. `task-protection.js` `baseUrl()` 归一化：经 `new URL(raw).origin` 取源再拼控制前缀，保留 `dsh.baseUrl` 原文供 BrowserView/cookie 使用（与 `workspace-rpc.js` 既有约定一致）。
2. `gateUpgradeHandler` 改为连接期准入：accept 后立即 `done()`——升级 socket 的寿命即传输寿命，不算可 drain 的工作；锁定期内新升级仍 503（README 行为不变），socket 上交付的工作仍由 `resolveAgent`/`jobs.start`  chokepoint 拦截。`collectSockets` 的 inspect 计数保留——已建立的远程连接作为 activeWork 提示（「2 条已建立的远程连接」）是刻意的提示面，不参与 drain。
3. `collectSchedule` 先查 `DSHD_SCHEDULE_ENABLED`：未设报 `intentional-disabled` 并跳过服务查找；已设而服务缺席仍 `unavailable`（加载失败绝不读作「有意关闭」），与 `collectBots` 完全同构。
4. `syncDesktopControls` 互斥：running 只显示「关闭桌面端」，stopped 只显示「启动桌面端」；运行态下重显被关的窗口改走托盘 `showMain`。
5. 诊断副产物转正：`admit(state, label)` 让 drain-timeout 响应携带 `pendingCount` + `pendingLabels`（如 `upgrade /api/remote.mux`），把本次最难定位的一步变成一等可观测信号，README 与测试同步登记。临时文件/控制台 STOPDBG 全部撤除。

## Alternatives considered

- **drain 时主动关闭存量升级 socket**：能把 pending 清空，但 stop/restart 这类非终态操作会误杀健康客户端连接——socket 是传输不是工作单元，拒绝新连接已足够，故不采用。
- **把升级 socket 从 inspect 的 activeWork 里也去掉**：能减少确认弹窗，但远程客户端确实连着、终态操作会断它——保留提示而把 drain 语义修对，提示与 drain 两个面各归其位。
- **`dsh.js` 存 baseUrl 时剥掉查询串**：更「干净」，但 cookie 探测与 BrowserView 首载都消费 token——剥掉会破坏登录链路；归一化放在消费控制面的 `controlOp` 侧，影响面最小。
- **pendingLabels 全面回滚**：能最小化 diff，但 drain-timeout 一度是无法观测的黑盒；保留标签后同类故障可直接从 acquire 响应读出卡住的准入种类。

## Consequences

- 停止链端到端恢复：实机验证 inspect→确认→acquire（drain 即刻完成）→commit→`proceeded=true`，`dsh web` 子进程退出、启动器回落到仅「启动桌面端」。
- 默认配置（schedule/bots 未开）下覆盖不再误报 unavailable；彼时远程连接仍会触发一次确认。同日后续：launcher 发起停止改 `preConfirmed` 不再弹窗（用户判定显式点击即同意，见 [launcher-stop-preconfirmed](../product/2026-09-27-launcher-stop-preconfirmed.md)）。
- 锁语义精确化：pending 集合只含「会结束的准入」（HTTP 请求、resolveAgent、jobs.start、fallback 写、connection 瀑布），传输期对象不进入 drain 集合。
- `acquire` 的 drain-timeout 响应新增 `pendingLabels` 字段；旧消费方只读 `code` 不受影响。
- 回归面：`src/main/task-control-plugin.test.js` + `task-protection.test.js` 共 23 例（新增：token URL 控制面、socket 不阻 drain + 锁内 503、schedule flag 三态、pendingLabels 断言）；全量 `npm test` 2537 绿。
- 相关记录：[任务保护协调器与 Host 接纳锁](../architecture/2026-09-25-task-protection-coordinator.md)。
