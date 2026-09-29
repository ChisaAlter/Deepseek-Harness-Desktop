# Four fix live verification (2026-09-29)

Scope: real source Electron, isolated `--user-data-dir` profiles, CDP-attached UI probes. No write to the installed profile at `C:\Users\48818\AppData\Roaming\Deepseek-Harness-Desktop`, no installer rebuild, no product-code edit in this run.

## Environment

- Windows source checkout, Electron 43.4.0 (`node_modules/electron`).
- Isolated profiles and loopback ports: `3197/9333`, `3198/9334`, `3199/9335`, `3200/9336`. Ports `3197` and `3200` also satisfied the previous co-existence check while the installed instance on the user profile was running.
- Probes attach to the real DOM and, where noted, exercise the real launcher/Harness IPC. Remote SSH itself is out of scope; the remote picker failure shown is the real `HTTP 400` from the disconnected fixture-less environment.

## Results

| # | Fix | Live assertion | Result |
| --- | --- | --- | --- |
| 1 | Hidden agent preset regression | Opened the real mode picker in the running source UI. Menu contained only `标准模式`, `PTC 模式`, `极简模式`, `创造模式`; no `鲸鱼娘` / `whale-girl` entry. | Pass |
| 2 | Remote workspace picker layout | Real `选择工作区目录` dialog, switched `本机` → `远程` on a live disconnected backend. `.dshr-flowContent` had `16px 24px` padding and `overflow:auto`; `.dshr-flowFooter` was a separate 68.7px row; `取消` rendered at `72x36` inside the footer; failure state kept its `重试` action. | Pass |
| 3 | Optional import must not preempt cold start | Fresh isolated profile started with 72 importable skills present under `C:\Users\48818\.agents\skills` and no desktop Harness sessions. The app entered the Harness workspace directly and wrote `last-desktop-start.json` `ok:true`; it did not route to the import tab. | Pass |
| 3b | Launcher home single action | Fresh isolated profile with `autoStartDesktop:false` opened the real launcher. Idle state showed one `启动桌面端` action and no `btn-recovery-retry`; diagnostics were collapsed. After click: `启动中…`, disabled start, and visible `正在准备运行时与插件 · 已等待 0 秒。`; the probe observed no duplicate start control. | Pass |
| 4 | Whale assistant default on | Fresh config intentionally omitted `whaleAssistantEnabled`. The real `shell.getConfig()` bridge returned `whaleAssistantEnabled:true`; the Harness UI showed the `鲸鱼娘` sidebar entry and the `助理` switch checked. | Pass |
| 4b | Boot/page reveal and source start | Fresh source instance: boot document stayed opaque (`opacity:1`) until the real Harness renderer mounted (`hasApp:true`, `opacity:1`); boot then reported `data-harness-covered:true`. The probe reached covered state in 19.8s on this cold load and completed with no page errors. | Pass |

The async process-stop part of the whale restart repair retains the earlier isolated trace evidence in `docs/qa/results/2026-09-29-whale-restart/` (no >500ms main-thread stall after the fix); this run adds fresh default-on and source-start confirmation.

## Artifacts

- `four-fix-probe.json`, `four-fix-remote-picker.png`, `four-fix-baseline.png`
- `launcher-home-probe.json`, `launcher-home-initial.png`, `launcher-home-pending.png`
- `whale-default-probe.json`, `boot-reveal-live.json`, `boot-reveal-live.png`
- Replay scripts: `four-fix-probe.mjs`, `launcher-home-probe.mjs`, `whale-default-probe.mjs`, `whale-default-config.mjs`, `boot-reveal-live.mjs`

## Boundaries

- These are source-Electron live probes, not packaged-installer acceptance. The installed app was left untouched.
- Remote SSH transport and remote authentication were not exercised; only the real renderer/plugin layout and its live disconnected error path were.
- No page-error array was emitted by the live probes; this is not a full crash-journal review.
