# 对抗审查报告 A —— 标准符合性（独立子代理）

- 对象：提交 `d00d528ffca`（启动页仪器画布→海平线画布改版）
- 方法：逐行读受影响文件全文（无 exec，按工作树即提交后状态核对）；约定/边界/安全/行为破坏/断言一致性五维
- 日期：2026-09-26

## 维度结论

- **仓库约定**：基本通过。`boot.css` 零颜色字面量（全部 `var(--boot-*)`/`color-mix`/`currentColor`）、零 `[data-ds-dark-theme]` 分支；`boot-tokens.css` 双主题 24 token 对称无死 token；`--boot-*` 无外泄；17 个 `getElementById` 与 HTML 全对齐；`[hidden]` 覆盖无坑。
- **边界/错误处理**：发现 P1（major）/P2/P3 三处实质问题（下表）。
- **安全面**：通过。日志全走 `textContent`，零 innerHTML 注入面；CSP 一致；IPC 边界未扩大。
- **既有行为破坏**：通过（recovery FSM、covered、最大化、reduced-motion、插件进度均保持）。
- **断言一致性**：断言与实现一致，但全为静态断言，对 P1–P3 盲区零覆盖。

## 问题清单（按发现时严重级；处置见 report.md 修复对照）

| # | 级 | 位置 | 问题 |
|---|---|---|---|
| P1 | major | dsh.js:674 + boot.js renderState | `snapshot.logs` 只推尾 80 行，renderState 每次 replaceChildren 重建 → 流式累积的抽屉被截回 ≤80 行、计数回跳，违背「完整日志 400 行」 |
| P2 | minor | boot.js cancelRestart catch | 「取消失败」直写 recoveryEl，被 250ms 倒计时 interval 下一 tick 覆盖 |
| P3 | minor | boot.css `.logdrawer` z6 > `.window-controls` z5 | 抽屉遮罩吞掉窗控三键点击 |
| P4 | minor | design-language L63 / motion.md:178 / 多处 | `.stage` 死引用、动效清单陈旧、「仪器画布」残留措辞 |
| P5 | nit | boot-recovery.js | `startupErrorLabel` 死导出、测试文案与页面漂移 |
| P6 | nit | boot.js FAILURE_TEXT_PATTERNS | `exited?` 不命中 `exit code`/`exit with` |
| P7 | nit | boot.js openLauncher then | `{ok:false,reason}` resolved 形状被静默吞掉 |
| P8 | nit | boot.js fallback 正则 | 缺 plugin-tree 三模式，与 LOG_ERROR_PATTERN 漂移 |
| P9 | nit | 多处 | 空快照不刷计数、@import 与 link 双载、ease 字面量混用、NaN 秒、浅色空层动画、drawer 无 aria-modal/焦点管理、CSP img-src 死配置、水下罩压水线 1px |

## 疑点

1. P1/P2 是否本提交新引入待 git 对比（后确认：80 行窗口为存量、400 行契约为新立——存量缺陷被新契约放大）
2. sidecar/封印哈希无法离线重算（后由 doc-sync 8/8 实证）
3. 「26/26」计数实际为 boot-recovery 8 + cover 13 + log-dump 5 合计（已澄清并修正卡的表述）
4. 浅色 `.stars` 空层动画是否真耗帧（推断性 nit，未实测）
