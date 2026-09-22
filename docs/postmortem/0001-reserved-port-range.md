# Postmortem 0001: Windows 保留端口段让 connect 探测撒谎

## Executive summary

部分 Windows 机器上桌面端无法启动 Harness：端口选择器认为候选端口空闲，`dsh web` 真正 bind 时却报 `EACCES`。根因是 Windows 的 Hyper-V / WinNAT 动态保留段（如 2989-3088）——这些端口上没有监听者，TCP connect 探测返回失败即被判为「空闲」，但任何进程都 bind 不上。修复把「能不能连」换成「能不能监听」：起真实 server listen 探测。

## Timeline

- 端口选择器用 `net.connect` 探测占用：连不上 = 空闲。
- 用户机器上 Hyper-V/WinNAT 保留段内的端口被选中，`dsh web` 启动即 `EACCES`，启动失败。
- 修复落地 `bindPortStatus`（`src/main/dsh.js`）：对每个候选端口起 `net.createServer().listen()` 真探测，`listening` 才算空闲且可绑；`EACCES`/`EADDRINUSE`/`TIMEOUT` 一律视为不可用继续扫描。

## Root cause

「端口空闲」有两个不同含义：没有进程在监听（connect 探测的答案），与这个进程能 bind（listen 探测的答案）。Windows 保留段制造了两者之间的裂缝。探测回答了错误的问题。

## Why every test / check missed it

- 单测跑在没有保留段的开发机与 CI 上——环境里没有「connect 失败但 bind 也失败」的端口态。
- connect 探测的假设在 Linux/macOS 与多数 Windows 机器上成立；缺陷需要特定 Windows 网络配置才显形。
- 打包冒烟走的也是无保留段环境。

## Guardrails added

- `bindPortStatus`/`canBindPort`：端口可用性判定改为真监听探测，错误码（`EACCES`/`EADDRINUSE`/`TIMEOUT`）透出到启动失败信息。
- `src/main/dsh.test.js` 注入 `bindableStatus` 覆盖保留段语义（connect 不通、bind 被拒时跳过该端口继续扫）。

## Lessons

- **探测要回答真问题**：「我要不要 bind」就用 bind 探测；用旁路观测（connect）推断一个只有尝试才知道的属性，在对抗性环境里必然撒谎。
- **OS 平台持有看不见的保留资源**：端口、路径、进程名都可能有系统级占用，`EACCES` 不等于「被别的进程占了」。
