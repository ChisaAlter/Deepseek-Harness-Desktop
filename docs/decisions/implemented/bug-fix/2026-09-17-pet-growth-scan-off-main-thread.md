# Decision: 宠物成长值语料扫描移出 Electron 主线程

Status: implemented

中文 | [English](2026-09-17-pet-growth-scan-off-main-thread.en.md)

## Problem

`scanSessionTokens` 由 60s `rescanGrowth` 定时器与 `shell:live2d-feed`/`shell:live2d-growth` IPC 同步触发，在 Electron **主进程**对每个 size+mtime 变化的会话日志执行 `fs.readFileSync` + 逐帧 `zstdDecompressSync` + 逐行 `JSON.parse`。活跃会话的日志随每次落盘批次（~200ms）变化，60s tick 必然 miss 缓存 → 全量重解码；日志体积随会话增长（实测解压约 75ms/压缩 MB），大语料会话下每次重扫是秒级主线程冻结——所有窗口、IPC、光标泵一起卡。代码注释假设「session logs are small (KB-scale)」在长会话上不成立，是用户反馈「长时间使用后时不时卡顿」的已证实机制。

## Decision

语料扫描原样移入 `worker_threads`：`pet-growth-scan-worker.js` 持有逐文件解码缓存并在工作线程跑同一份 `scanSessionTokens`；主侧 `createScanWorker()` 封装消息往返（惰性 spawn、`unref()`、崩溃后下次 scan 重 spawn、`close()` 终态拒绝）。`createGrowthTracker.refresh()` 改 async，tracker 内合并并发调用（in-flight 共享一个扫描 promise），新增 `scanTokens` 注入点供测试与未来实现替换；`dispose()` 终止 worker。worker 入口与本模块按 `dshd-daemon-runner` 同一约定进 `asarUnpack`（plain-node 线程读不了 app.asar）。簿记语义（baseline 水位、(turn,step) last-wins 去重、今日累计、单餐封顶）逐行不变。

## Alternatives considered

- **复用 `pet-dsh-watch` 的增量尾随做 growth** — rejected：watcher 有持久化字节游标，但 growth 要的是 per-(turn,step) last-wins 用量表；把那张表持久化要么撑大 config.json、要么新增落盘格式，且语料回填完成前必须先闸住 feedable（否则历史存量变成口粮、违反 baseline 契约）——状态机与迁移成本远大于进程边界。
- **保持同步、每次 tick 限量字节节流** — rejected：语料未扫完前 tokensSeen/baseline 不可信，需要引入「baseline 未就绪」态并改 feedable 语义；只是把长冻结切成多个小尖刺，不消除主线程成本。
- **给扫描加文件大小上限跳过大日志** — rejected：跳过大文件直接低估 tokensSeen 与 baseline，喂养账与「只读聚合、绝不漏数」契约同时被破坏。
- **`utilityProcess.fork` / `child_process` 承载扫描** — rejected：同样的 asar 约束且进程开销更重；worker_threads 同进程内即可满足隔离诉求。

## Consequences

代价：worker 入口与 `pet-growth.js` 进 `asarUnpack`（打包时磁盘两份拷贝，与 daemon-runner 同先例）；`refresh()` 从同步变 Promise——`feedTokens`/`growthSnapshot` IPC 变 async（`ipcMain.handle` 对 invoke 侧透明），三个调用点全部 await；新增一条 main↔worker 消息契约（`{type:'scan',id,sessionsDir}` → `{id,ok,total,sessions}`），扫描失败如实 reject、由调用点按既有 try/catch 兜底（60s tick 静默留待下轮）。收益：语料再大也只占 worker 线程，主进程 60s tick 退化为一次消息往返——长会话下周期性全局冻结消除；`node --test` pet-growth 23 pass（新增 worker 一致性、主线程活性、并发合并、失败传播、close 终态 5 例），desktop-live2d/pet-dsh-watch/pet-settings 套件不变，main 全套 1188 pass。
