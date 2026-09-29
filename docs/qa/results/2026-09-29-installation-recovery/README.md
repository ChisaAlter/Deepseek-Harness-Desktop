# 安装链路优化与验证 — 2026-09-29

## 范围与现场边界

本轮从代码审查推进到下载、安装确认与首次运行时提取的恢复优化。没有收到原用户的安装包版本、画面或日志，因此这些测试证明代码风险及修复，不证明原用户现场已经解决。没有发布、签名或重建 CI Setup；保留 NSIS 向导和 `/S` 安装契约，也未裁剪运行时依赖。

## 已复现并修复

- 下载正文无数据只能等待总超时；断线无重试；未知长度无字节进度。
- 安装子进程失败仍等待；同版本修复只能等到八分钟；安装失败可能被新注册记录掩盖。
- 归档损坏时旧运行时已经删除；低空间无预检；tar 没有超时和取消。
- 已验证 Setup 在再次安装时重新下载；半成品直接使用完整文件名。
- 安装器消失或被阻止后，自更新可能进入已提交状态，Host 接纳锁未释放。
- 版本页安装 IPC 拒绝没有 catch；未确认状态仍呈现活动进度。

## 证据

| 检查 | 结果 / 文件 |
| --- | --- |
| 原缺陷回归 | 先执行失败，再实施修复；新增测试覆盖真实 update/wait/extract 调用边界 |
| 首轮定向 | `focused-tests.log`：137/137 |
| 后续提取/反馈定向 | `late-focused-tests.log`：36/36 |
| 最后反馈检查 | `renderer-tests-final.log`：13/13 |
| 最后提取检查 | `extraction-tests-final.log`：22/22，包括新增的正式目录改名受阻后恢复旧树；该最后追加用例在全量确认进程启动后单独执行 |
| 全量回归 | `full-tests-confirmation.log`：2856 项，2854 通过、0 失败、2 跳过 |
| 文档治理 | `doc-sync.log`：7/7，包括决策、feature 卡、链接和双语配对 |
| 真 Electron 反馈 | `renderer-probe.cjs` / `renderer-probe.json`：20 场景通过；真实生产页面、明/暗 × 1024/720px × 五种进度状态。使用注入状态，不下载或安装真实 Setup |
| 源码冒烟 | `source-smoke.log`：界面、标题栏命中和 PTY 通过，pageErrors 为空 |
| 源码重启 | `restart-final.stdout.log` / `restart-final.stderr.log`：`npm start` prestart ready，Electron 主进程重新启动 |
| 真归档演练 | `extraction-probe.cjs` / `extraction-probe.json`：本地现存 2,351,472,640 字节归档，冷提取 71,253ms，复用 1ms；100ms ticker 最大间隔 116ms；临时测试目录已清理 |

真实归档演练使用本地既有打包资源和本轮 extractor，不是新构建安装包。Windows 链接在最终目录重建的回归使用真实 tar 和 junction fixture；旧归档演练不能替代最新完整装配的发行验收。截图已检查提示换行与状态收尾，但不代表真实 UAC、SmartScreen 或杀毒环境验收。

验证历史保留：首轮 `full-tests.log` 全绿；中间 `full-tests-final.log` 的浏览器权限 positive-control 用例在「销毁 webContents 后拒绝」检查失败一次。`permission-recheck.log` 单独重跑通过，随后 `full-tests-confirmation.log` 完整重跑通过。本轮没有修改权限代码或放宽该检查。

## WER 后续：启动链接操作异步化

用户随后提供的 Windows WER 记录 Whale Isle.exe 0.3.3.0 / Windows 10 19045 / AppHangB1，事件时间 2026-09-29 15:41:14 UTC。它证明安装路径下的应用曾未响应，不含线程堆栈，不能锁定阻塞函数；未把用户原始报告或个人路径复制进仓库。

启动仍直接调用同步链接循环，批量 realpath/stat/junction 操作占用 Electron 主线程。本轮把启动调用切到异步文件 I/O，根 realpath 每轮只取一次；准备期支持取消，正式切换期完成链接重建或回滚后才返回。既有 ticker 每五秒报告链接完成数/总数与耗时，构建脚本保留同步 API。

- 红灯：`node --test --test-name-pattern='packaged startup checks|cancelling a slow' src/main/harness-extract.test.js` 在修改前 0/2，通过实际提取入口阻断同步 realpath 并模拟慢异步 I/O；旧代码因同步检查失败误走提取，且异步取消没有触发。修改后通过。
- 定向：`async-links-focused.log`，148/148，包括路径越界、父 junction 越界、真实目录保护、取消恢复和最终链接失败回滚。
- 全量：`async-links-full.log`，2865 项，2863 通过、0 失败、2 跳过。
- 源码重启：`async-links-restart.stdout.log`；`async-links-smoke.log` 界面、标题栏命中、PTY 成功，`pageErrors: []`。
- 演练：`node docs/qa/results/2026-09-29-installation-recovery/async-links-probe.cjs`；机器本地临时目录中构造 747 个目标、3602 条链接，结果见 `async-links-probe.json`。临时目录已清理。

| 链接操作 | 总耗时 | 10ms 事件循环探针最大间隔 |
| --- | --- | --- |
| 同步首次创建 | 26070ms | 26087ms |
| 同步已有链接检查 | 11659ms | 11674ms |
| 异步已有链接检查 | 4602ms | 30ms |
| 异步链接清理 | 3689ms | 38ms |
| 异步首次创建 | 7205ms | 42ms |

这是合成本地文件系统演练，非受影响用户复现、真实安装包或完整依赖拓扑验收。演练与全量测试部分并发、按固定顺序运行，缓存与系统负载不同，不能据此宣称稳定的加速倍数；它直接展示同步循环期间事件循环无法响应，以及异步循环仍能处理定时器。单次 OS 文件调用不能被取消强制打断，取消在其完成后生效。

## 仍需发布阶段验证

对同一 CI SHA 的真实 Setup 验证：全新安装、同版本修复、覆盖升级、UAC 拒绝、安装向导取消、低空间、杀毒拦截及慢盘首次启动。本轮明确保留同版本修复「结果待确认」；部分下载从头有界重试，不宣称支持断点续传。临时解压比原地覆盖需要更多峰值空间，空间估算不保证后续写入永不失败。
