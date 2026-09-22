# Windows Acceptance Ledger

Date observed: September 6, 2026 Beijing time (September 5, 2026 UTC)

This is the complete per-case ledger derived from the unique `TC-*` headings in [production-acceptance-test-cases.md](../../../production-acceptance-test-cases.md). It does not inherit results from any older candidate. Current integration: 23/66 P0 cases passed; 43 P0 cases remain not release-ready. Four cases are specifically Blocked by native-tool limitations; all untouched cases remain **Blocked — not yet exercised on this candidate**. No full approval is implied.

## Candidate Provenance

| Item | Value |
| --- | --- |
| Candidate commit | `a6e9271f8724cd27195398fe7c0ea485eb007dfb` |
| Build run | `33969469600` (verified success now) |
| Tests run | `33969468969` (verified success now) |
| Windows Setup SHA256 | `ade70b6681bb56265bcc8e549948dae61b502ef21791f2b3796005ba82fca9c9` |
| Installed path | `C:/软件/Deepseek-Harness-Desktop` |
| Installed `app.asar` SHA256 | `7aaffd00cd7c7f6149de2b1e599dd5b9ca573cd6dd863b8ab78610a4a22aca8d` |
| Package identity | Installed `app.asar` SHA matches the extracted artifact verified this run |
| Bundled Node | `v22.22.2` |
| Harness pin | `0.1.2-rc.1`, SHA `a66e4702047846cdaa10c66c9d3df3951f5ea70d` |
| New local evidence directory | `.tmp/windows-acceptance-20260906` |

## Ledger

`Pass` rows are backed by this run's evidence below. `Blocked` rows are not approved; unless individually explained below, they mean **not yet exercised**, not a demonstrated product failure or a granted waiver.

| ID | Priority | Case | Status |
| --- | --- | --- | --- |
| TC-INST-001 | P0 | 安装包校验、安装并可启动 | Blocked |
| TC-INST-002 | P0 | 单实例锁 | Pass |
| TC-INST-003 | P0 | 冷启动：插件加载留在启动页 | Blocked |
| TC-INST-004 | P0 | 启动失败：重试与导出日志（造障） | Blocked |
| TC-INST-005 | P0 | 用户插件弄挂：跳过插件树（造障） | Blocked |
| TC-INST-006 | P0 | 跳过之后：重试完整插件（造障，接 005） | Blocked |
| TC-INST-007 | P1 | 自动重启倒计时与取消（造障） | Blocked |
| TC-INST-008 | P0 | 版本与 Release 备注一致 | Pass |
| TC-INST-009 | P0 | 覆盖升级（旧版 → 本包） | Blocked |
| TC-INST-010 | P1 | 卸载 | Blocked |
| TC-INST-011 | P0 | 官方 `~/.dsh` 插件不能拖死桌面新装（造障） | Blocked |
| TC-INST-011b | P0 | 官方 credentials.yaml 毒化不能拖死桌面（造障） | Blocked |
| TC-LAUNCH-001 | P0 | 冷启动只开启动器 | Blocked |
| TC-LAUNCH-002 | P0 | 无更新则自动进桌面 | Blocked |
| TC-LAUNCH-003 | P0 | 有更新点否仍能进桌面 | Blocked |
| TC-LAUNCH-004 | P0 | 空家目录停在导入 | Blocked |
| TC-LAUNCH-005 | P0 | 启动失败留下启动器并可禁用插件（造障） | Blocked |
| TC-LAUNCH-006 | P0 | 托盘与文件菜单可再打开启动器 | Blocked |
| TC-LAUNCH-007 | P0 | 启动器浅色/深色跟官方表，不跟壁纸种子 | Blocked |
| TC-LAUNCH-008 | P0 | 更新下载失败留在启动器（造障） | Blocked |
| TC-INST-012 | P0 | 同版本 overlay 必须重解压 Harness | Blocked |
| TC-INST-013 | P0 | 安装包内 Node 与 CI 一致 | Pass |
| TC-MODEL-001 | P0 | 添加自定义网关并保存脱敏 | Blocked |
| TC-MODEL-002 | P1 | 获取可用模型（若入口存在） | Blocked |
| TC-MODEL-003 | P0 | 选中模型作为新会话默认 | Blocked |
| TC-MODEL-004 | P0 | 第三方思考强度 | Pass |
| TC-MODEL-005 | P0 | 识图兜底模型 | Blocked |
| TC-MODEL-006 | P1 | 兼容性兜底（按需） | Blocked |
| TC-MODEL-007 | P1 | 无可用模型时 Composer 阻拦 | Blocked |
| TC-WS-001 | P0 | 选择工作区并进入四栏 | Pass |
| TC-WS-002 | P0 | 快捷键：设置 / 右栏 / 终端 | Blocked |
| TC-WS-003 | P1 | 应用菜单跳转 | Blocked |
| TC-WS-004 | P0 | 窗口控件 | Blocked (native tool limitation) |
| TC-WS-005 | P1 | 非 Git 目录 | Blocked |
| TC-WS-006 | P0 | 打开已登记的兄弟工作区 | Pass |
| TC-CHAT-001 | P0 | 附录 A 第 1 轮：连通与验证码 | Pass |
| TC-CHAT-002 | P0 | 附录 A 第 2 轮：记忆验证码 | Pass |
| TC-CHAT-003 | P0 | 附录 A 第 3 轮：读 README | Pass |
| TC-CHAT-004 | P0 | 附录 A 第 4 轮：终端/命令 | Pass |
| TC-CHAT-005 | P0 | 附录 A 第 5 轮：综合汇总 | Pass |
| TC-CHAT-006 | P0 | Composer 官方命令边界 | Blocked |
| TC-CHAT-007 | P0 | Files Mention 写入草稿 | Pass |
| TC-CHAT-008 | P0 | 文件预览「添加到对话」L 范围 | Pass |
| TC-CHAT-009 | P0 | 编辑最近用户消息并重发 | Pass |
| TC-CHAT-010 | P1 | 已归档取消归档 | Blocked |
| TC-CHAT-011 | P2 | 主模型附件图（无兜底时） | Blocked |
| TC-CHAT-012 | P1 | 取消进行中的生成 | Blocked |
| TC-CHAT-013 | P1 | 已归档删除会话 | Blocked |
| TC-SESS-001 | P1 | 新建 / 切换会话 | Blocked |
| TC-SESS-002 | P1 | 会话列表浏览 | Blocked |
| TC-SESS-003 | P0 | 重启后会话仍在 | Pass |
| TC-APPROVE-001 | P0 | 批准（Allow once） | Blocked |
| TC-APPROVE-002 | P0 | 拒绝 | Blocked |
| TC-APPROVE-003 | P1 | 工具卡可读 | Blocked |
| TC-GIT-001 | P0 | 状态与分支菜单 | Pass |
| TC-GIT-002 | P1 | 切换或创建分支 | Blocked |
| TC-GIT-003 | P0 | 暂存与提交 | Blocked |
| TC-GIT-004 | P1 | Push / Pull / 开变更请求 | Blocked |
| TC-GIT-005 | P1 | Diff 与工作区一致 | Blocked |
| TC-GIT-006 | P1 | Discard / 取消暂存（若有） | Blocked |
| TC-GIT-007 | P2 | 非仓库 Init（若有） | Blocked |
| TC-SURF-001 | P0 | Files：搜索、预览、送对话 | Pass |
| TC-SURF-002 | P1 | Files：保存与系统打开 | Blocked |
| TC-SURF-003 | P1 | Files：未保存关闭确认 | Blocked |
| TC-SURF-004 | P0 | Browser：URL 与导航 | Pass |
| TC-SURF-005 | P2 | Browser：截图 / PiP / 录制 | Blocked |
| TC-SURF-006 | P1 | Agents 面板 | Blocked |
| TC-SURF-007 | P0 | Tab 关闭在标题右侧 | Pass |
| TC-TERM-001 | P0 | 底栏终端可用 | Blocked |
| TC-TERM-002 | P0 | 选区送对话 | Blocked |
| TC-TERM-003 | P1 | 多会话 / 分屏 | Blocked |
| TC-TERM-004 | P1 | 销毁与重建 | Blocked |
| TC-APP-001 | P0 | 浅色 / 深色 | Blocked |
| TC-APP-002 | P0 | Appearance 行能力边界 | Blocked |
| TC-APP-003 | P0 | 本地选择壁纸并裁切 | Blocked |
| TC-APP-004 | P1 | 清除壁纸 | Blocked |
| TC-APP-005 | P0 | Browse 图库窗口 | Blocked |
| TC-APP-006 | P0 | 收藏与确认设壁纸 | Blocked |
| TC-APP-007 | P1 | 图库内源 CRUD | Blocked |
| TC-APP-008 | P0 | Wallhaven 仅 SFW | Blocked |
| TC-APP-009 | P1 | 禁源不出现 | Blocked |
| TC-APP-010 | P1 | 毛玻璃与像素化 | Blocked |
| TC-APP-011 | P1 | 主题库 | Blocked |
| TC-APP-012 | P1 | 透明主题 | Blocked |
| TC-APP-013 | P1 | 透明主题无壁纸惰性 | Blocked |
| TC-APP-014 | P1 | 透明主题可读性 | Blocked |
| TC-EXT-001 | P0 | 设置分区可达 | Pass |
| TC-EXT-002 | P0 | 无独立市场窗口 | Blocked |
| TC-EXT-003 | P0 | 市场浏览与刷新 | Pass |
| TC-EXT-004 | P1 | 安装市场插件 | Blocked |
| TC-EXT-005 | P1 | 卸载插件 | Blocked |
| TC-EXT-006 | P1 | MCP / Skills 入口 | Blocked |
| TC-EXT-007 | P1 | dshbot 本体剥离与用户安装保留 | Blocked |
| TC-EXT-008 | P0 | 设置内用量统计 | Pass |
| TC-EXT-009 | P1 | 设置内远程双标签 | Blocked |
| TC-DESK-001 | P0 | 关闭进托盘 | Blocked (native tool limitation) |
| TC-DESK-002 | P0 | 托盘菜单完整 | Blocked (native tool limitation) |
| TC-DESK-003 | P0 | 关闭行为：直接退出 | Pass |
| TC-DESK-004 | P0 | 托盘退出 | Blocked (native tool limitation) |
| TC-DESK-005 | P1 | 检查更新 | Blocked |
| TC-DESK-006 | P1 | 下载并安装更新（有新版本时） | Blocked |
| TC-DESK-007 | P2 | 开机启动（若设置项存在） | Blocked |
| TC-DESK-008 | P1 | Harness 自动重启设置 | Blocked |
| TC-DESK-009 | P1 | 关于页打开运行目录 | Blocked |
| TC-NEG-001 | P0 | 远程默认关闭且不监听 | Blocked |
| TC-REM-001 | P0 | 打开局域网远程并出现二维码 | Blocked |
| TC-REM-002 | P0 | 第二客户端实机全量（本轮：手机 Web UI） | Blocked |
| TC-REM-003 | P1 | 审批允许一次 / 拒绝 | Blocked |
| TC-NEG-002 | P0 | Harness 崩溃恢复（造障） | Blocked |
| TC-NEG-003 | P1 | 错误密钥 | Blocked |
| TC-NEG-004 | P2 | 离线启动 | Blocked |
| TC-NEG-005 | P0 | 配置持久化抽检 | Blocked |
| TC-NEG-006 | P1 | 关闭遮罩 | Blocked |

## Counts

| Priority | Cases | Current status |
| --- | ---: | --- |
| P0 | 66 | 23 Pass; 4 specifically Blocked; 39 untouched |
| P1 | 42 | Blocked — not yet exercised |
| P2 | 5 | Blocked — not yet exercised |
| Total | 113 | 23 Pass; 4 specifically Blocked; 86 untouched |

## Evidence And Observations

These entries come only from sanitized `.tmp/windows-acceptance-20260906/native-evidence.json` for this candidate. Artifact names below are private local filenames only; raw screenshots, session history, and secrets are not copied here.

| ID | Status | Detail | Private local artifact |
| --- | --- | --- | --- |
| TC-CHAT-001 | Pass | Installed CI candidate, ChisaTerminal new session, `grok-4.6` High. Reply included connectivity and验证码 `789`. | `native-evidence.json` |
| TC-CHAT-002 | Pass | Same installed candidate session returned exactly `789`. | `native-evidence.json` |
| TC-CHAT-003 | Pass | Three tool calls included reading `README.md`; the three-sentence summary matched the real ChisaTerminal README. | `native-evidence.json` |
| TC-CHAT-004 | Pass | Same installed session completed a supported `session.prompt` flow; history confirms `pwsh` executed `Split-Path -Leaf (Get-Location)` in `C:/Ai/ChisaTerminal`, with `isError=false`. | `appendix-turn4.png` |
| TC-CHAT-005 | Pass | Summary preserved `789`, the accurate ChisaTerminal product summary, and the ChisaTerminal directory. | `appendix-turn5.png` |
| TC-WS-006 | Pass | Selected registered sibling workspace `C:/Ai/ChisaTerminal`; `session.list` cwd and real PowerShell output agree. | `native-evidence.json` |
| TC-CHAT-009 | Pass | Edited the latest summary prompt; fork titled `(1)` preserved the original session and returned 编辑验收成功。 | `message-edit.png` |
| TC-MODEL-004 | Pass | High completed the appendix and edit reply; Low completed with 低档位验收成功。 | `model-low.png` |
| TC-SURF-007 | Pass | Both surface tabs showed close icons to the right of their titles. | `native-evidence.json` |
| TC-CHAT-008 | Pass | Added README source lines 1–3 to Composer as `L1 to L3 README.md` plus a text fence. | `files-lines-to-chat.png` |
| TC-CHAT-007 | Pass | Root README Mention appended `[README.md](README.md)` and left Send enabled. | `files-mention.png` |
| TC-SURF-001 | Pass | Files populated; README search returned root `README.md`, which opened readably; selection and Mention reached Composer. | `files-search.png`; `files-lines-to-chat.png`; `files-mention.png` |
| TC-INST-008 | Pass | About showed `0.2.9`; installed harness pin `0.1.2-rc.1` with SHA `a66e4702047846cdaa10c66c9d3df3951f5ea70d` matched release notes. | `about-version.png` |
| TC-INST-013 | Pass | Installed `resources/node.exe --version` returned `v22.22.2`; installed `app.asar` matched the CI extraction hash. | `native-evidence.json` |
| TC-EXT-008 | Pass | Usage Stats opened in the same app with token/session KPIs, refresh/export controls, and heatmap. | `native-evidence.json` |
| TC-EXT-001 | Pass | MCP, Skills, Plugins, Market, and Usage Stats were reachable within installed Settings. | `native-evidence.json` |
| TC-EXT-003 | Pass | Market Discover showed 3192 entries; refresh kept the list usable without a Harness crash. | `native-evidence.json` |
| TC-SURF-004 | Pass | Installed Browser loaded example.com, navigated to IANA, and passed Back, Forward, and Refresh checks. | `browser-navigation.png` |
| TC-GIT-001 | Pass | Installed sibling-workspace branch menu listed current `master`, `111`, and `codex/qa-ci-33942243475`, matching Git; no checkout or staging occurred. | `git-branches.png` |
| TC-WS-001 | Pass | Registered Git workspace showed sidebar, chat, Composer, Git controls, terminal, and functioning right surfaces. | `native-evidence.json` |
| TC-INST-002 | Pass | Start Menu `.lnk` restored the same window handle and main PID; exactly one app window was observed. | `single-instance-restored.png` |
| TC-DESK-001 | Blocked | Close-to-tray hid the window while the app and Harness listener persisted, but native tooling exposed no tray target to verify icon visibility. | `native-evidence.json` |
| TC-DESK-003 | Pass | With `closeToTray=false`, native close exited all app processes and removed the port 3080 listener; the same shortcut relaunched. | `restart-history.png` |
| TC-SESS-003 | Pass | After full shutdown and shortcut restart, original/edit-fork sessions and draft remained; the installed fork replied without re-entering credentials. | `restart-history.png`; `restart-model-reply.png` |
| TC-WS-004 | Blocked | Maximize/restore and close worked, but minimize could not be conclusively observed; coordinate-cache recovery required a tool reset. | `native-evidence.json` |
| TC-DESK-002 | Blocked | Native window inventory exposed no taskbar or notification-overflow target, so tray menu actions could not be signed. | `native-evidence.json` |
| TC-DESK-004 | Blocked | Explicit normal quit passed separately, but the actual tray Quit item was inaccessible and was not substituted. | `native-evidence.json` |

## Run Notes

- Performed-case result: **23 Pass, 4 specifically Blocked, no product Fail found**.
- The four specific Blocked cases are native-tool-limited, not product failures. All other not-yet-exercised cases remain pending and are not Pass.
- No connected `adb` device was available; phone cases remain untested pending hardware.
- `closeToTray=true` was restored, reasoning `High` was restored, the app was relaunched from the original shortcut, and temporary QA API devices were revoked.
- No source or binary change was made by this acceptance run.
- Cleanup audit caught a stale snapshot in the temporary API driver: six test devices had not actually been revoked despite the early log message. Only those six owned devices were revoked, and readback confirmed zero active test devices. The driver now loads the registry in `finally` and verifies revocation from a fresh disk snapshot; early cleanup log lines alone are not evidence.
- Separate local support checks passed: 23 installer/CI-isolation unit tests, the `v0.2.9` version guard, Windows asset SHA512 checks, and release-notes-copy equality. These checks do not increase the 23 production P0 Pass count.

## Section 16

| Item | Value |
| --- | --- |
| Actions run URL | `https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33969469600` |
| Artifact | `DeepSeek-Harness-windows-x64` |
| Setup file | `Deepseek-Harness-Desktop-Setup-0.2.9.exe` |
| Setup SHA256 | `ade70b6681bb56265bcc8e549948dae61b502ef21791f2b3796005ba82fca9c9` |
| Release will upload same SHA | ☐ unsigned |
| P0 result | **23/66 Pass; 43 not release-ready** |
| Release waiver | ☐ None; no waiver recorded |
| Release identity | Any eventual release must upload this same Setup SHA256 |
| Conclusion | **Release forbidden; not release ready; unsigned** |
| Test owner / date | Main agent / September 6, 2026 Beijing time |
| Product owner / date | ☐ |
