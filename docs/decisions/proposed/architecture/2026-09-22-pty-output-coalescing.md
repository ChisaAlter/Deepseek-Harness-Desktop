# Decision: PTY 输出按 burst 合并后再跨 IPC

Status: proposed

中文 | [English](2026-09-22-pty-output-coalescing.en.md)

## Problem

`src/main/pty.js` 的 `onData` 回调对每一个 backend chunk 立即 `publish('shell:pty-data')`，
`registerPtyIpc` 再对 owner 的 webContents 逐条 `send`。renderer 侧
`ui-user-terminal/src/client/pty-bridge.ts` 每个事件扇出到全部 live store，`stores.ts` 的
`appendData` 执行 `session.buffer + data` 并按 256 KiB（JS 字符串长度，不是字节数）截断。

一段构建日志、`cat` 大文件或 `npm test` 的输出会生成成千上万个小 chunk。IPC 条数、store
publication 次数与字符串复制次数都随 chunk 数线性增长；replay buffer 满之后，每次
`appendData` 还要复制接近上限的字符串。终端的用户可见症状是高吞吐输出期间 renderer 主线程
抖动与输入回显变慢。

这不是渲染错误也不是数据丢失，代价全在**交付次数**上：同样的字节，用更少的消息送达。

## Proposal

在 `createPtyController` 内按 PTY 合并输出，而不是在渲染端去重：

- 空闲后到达的第一个 chunk **立即**发布，因此交互式回显不付合并窗口。
- 同一 burst 内后续 chunk 追加到 per-PTY 队列，按 `8 ms` 或 `32 KiB`（UTF-8 字节，先到者）
  flush 成一条 `shell:pty-data`。
- flush 前先**按容量追加**：当前 pending 已有 `n` 字节、新 chunk 有 `m` 字节时，若
  `n + m > 上限` 就先 flush 掉已有部分，再把新 chunk 放进队列。上限因此是真正的 payload 上界，
  而不是「追加后再判断」的触发线——后者允许两个合规 chunk 合并出超过上限的一条 payload。
  单个 backend chunk 本身就超上限时，按该 chunk 原样发出（这是无法再切分的例外）。
- `onExit`、`kill`、`killAll` 先 flush 再继续，`shell:pty-exit` 永远排在已缓冲输出之后。
- 定时器与队列随 owner generation 一起清理，kill 之后到达的迟到回调不得重新创建 batching 状态；
  不使用已在 `pty.js` 里被否掉的 `unref()`（那会让最后一个 chunk 静默留在队列里）。

第一版只做**合并**。`node-pty` 的 `pause`/`resume` 是否真能约束 ConPTY/backend 的生产速度尚未
验证，因此本决策不声称实现背压，也不删除数据。完整字节流由 renderer 的 replay buffer 继续
兜住；本项只减少消息数。

## Alternatives considered

- **提高 renderer replay buffer 或改成 ring buffer** — deferred：缓冲区大小不减少 IPC 条数与
  字符串复制；只有在合并后仍被复制/GC 主导时才有必要。先解决交付次数。

- **在渲染端 `pty-bridge.ts` 合并事件** — rejected：IPC 与 `webContents.send` 的成本已经付过，
  渲染端合并只减少 store 更新，省不掉主进程→renderer 的那一半成本。

- **按字节阈值合并、完全不使用定时器** — rejected：只按阈值会让交互式小输出一直停在队列里，
  直到下一次大输出才可见。时间窗是交互性所必需的。

- **直接用 `unref()` 的定时器，避免测试/退出被挂起** — rejected：`unref()` 允许进程在最后一个
  chunk 仍被缓冲时退出，尾部输出丢失。生命周期改为在 exit/kill/killAll 明确 flush。

- **把 `pause`/`resume` 当作背压一起实现** — deferred：`node-pty` 在 Windows 走 ConPTY，
  `pause` 语义未被证明能传导到生产端；在没有实测证据前把「批合并」说成「背压」属于虚假完成。

- **先 push 再判断是否达到上限** — rejected（已实现并推翻）：两个各自低于上限的普通 chunk
  可以合并出一条超过上限的 payload（例如 20 KiB + 20 KiB → 一条 40 KiB）。现有上限测试用
  整齐的 4 KiB chunk，恰好掩盖了这条路径。上限要在追加前按容量计算。

## Acceptance criteria

- 10,000 × 1 KiB 合成小 chunk：IPC 数据消息数 ≤ 2,000（相对 chunk 数减少 ≥ 80%），拼接后的
  内容与输入完全一致。
- 100,000 × 1 KiB 合成 chunk 在同一实现上计数 100,000 → 3,126（−96.9%）。
- 空闲后单次输出不等待合并窗口（`coalesceMs` 设为 5 s 时仍立即发布）。
- 单条合并 payload 不超过 32 KiB（UTF-8 字节），除非单个 backend chunk 本身更大。
  负例覆盖 `20 KiB + 20 KiB`、非整除大小、多字节 UTF-8 文本与超大单包。
- `shell:pty-exit` 之前必须已发布全部缓冲输出；`kill` / `killAll` 不残留定时器或队列；
  kill 之后到达的迟到回调不重新创建 batching 状态。
- 既有 owner 校验、sender 代际、尺寸归一化、kill 后 no-op 等用例全部保持通过。

## Risks

- ANSI/OSC/CSI 序列可能跨 backend chunk；合并只拼接字符串、不解析内容，序列仍按原字节顺序
  到达 renderer，因此不受影响。真正需要担心的是 flush 顺序与丢失，二者由 exit/kill 前 flush
  和「不使用 `unref()`」两条规则约束。
- 8 ms 窗口会给高吞吐输出引入有界排队延迟；上限即窗口或 32 KiB 中的先到者。交互式（空闲后
  首次）输出不在此列。
- 合并会改变 renderer 观察到的事件粒度；若将来有消费者依赖「一个 backend chunk 一条事件」
  （例如逐 chunk 做协议解析），必须改为自行缓冲，而不是回退合并。
- 背压仍未解决：持续高吞吐时主进程仍会不断入队并 flush，只是消息更少。该项保持未完成。
