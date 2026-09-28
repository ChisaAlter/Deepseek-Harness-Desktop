# Decision: 工作区列表加载中也可选择无工作目录

Status: implemented

中文 | [English](2026-09-27-no-directory-pick-during-workspace-load.en.md)

## Problem

启动桌面端后，空会话 Hero 的工作区芯片菜单在 Workspace 列表仍显示「正在加载工作区…」时就能展开，「无工作目录」也在其中。用户此时点它会看到菜单关闭、芯片回到「选择工作区」，输入框保持惰性——一次点击表现为完全失效。

实机排查发现两层原因叠在一起，必须分开修：

1. **环境侧（本次实测的致命层）**：`$DSH_HOME/sessions/_no-cwd/preset-keep/session.v3.jsonl` 是明文 JSONL，而会话后端配置为 `zstd`；`WorkspaceRegistry` 启动时扫描会话头即抛 `uses .jsonl, but this backend is configured for compression "zstd"`，`workspace` 插件整条挂载失败，`workspaceController` 服务不可用。列表因此永远停在「正在加载工作区…」，`workspace/follow` 直接返回 `gateway/service-unavailable`——点任何工作区目标都不可能生效。该文件是外部写下的占位会话（`id: session-placeholder`，cwd 指向仓库），不是产品生成的会话。
2. **客户端侧（本记录修的产品缺陷）**：`scratchCwd`（Host 的 `$DSH_HOME/no-workspace`）只在 Workspace follow 的第一份 baseline 到达后才存在于 `WorkspaceSnapshot`，而 `connectNoDirectory()` 直接读取它，缺失即抛 `the Workspace baseline has not arrived yet`。Hero 的调用方只清掉 pending 标记、不显示任何错误，于是失败被吞成「没反应」——包括上面那种宿主根本没起来的情况，用户同样只看到毫无反应。

菜单本身不因加载态禁用「无工作目录」是有意的：它在列表加载期间就是一个合法目标，只是需要排队到 baseline 之后而不是立即失败。事件顺序由桌面壳的重连/重建放大——页面重建时 Hero 先渲染、baseline 后到。

## Decision

`connectNoDirectory()` 新增 `connectScratchCwd()`：`scratchCwd` 已存在时立即返回；`phase` 仍是 `pending` 时订阅 Workspace 列表，等待第一份 baseline 后继续候选复用或 `session.create({ cwd })`；订阅期间 owner 销毁则按 `lifetime` 中止；`phase === 'ready'` 或 `state === 'error'` 却仍无 `scratchCwd` 时以明确错误失败，不无限等待。

等待后重读快照再判定，避免 baseline 在订阅建立前后落地造成的漏唤醒；订阅在 resolve/reject/abort 三处都注销。

`openNoDirectory()` 与 `openWorkspace()` 对齐：被拒绝的创建经 `createFailed` 提示浮出，而不是只回滚芯片；被后续导航或销毁取代的请求仍然静默。

宿主故障本身不在客户端可修范围：`workspaceController` 缺席时选择器不再假装可用，而是让失败可见。实测环境里的那个残留文件按“先隔离、不删除”处理，移到 `%APPDATA%/Deepseek-Harness-Desktop/quarantine/sessions/` 下保留证据，Host 随即恢复正常挂载。

## Alternatives considered

- **加载态禁用「无工作目录」菜单项**：能让点击不至于失败，但把一个合法入口在启动窗口期隐藏——用户看到的仍是「这个选择不可用」，且没有解释；等待基线才符合菜单既有的可选语义。
- **在 UI 侧等待，每次点击轮询 `scratchCwd`**：把同一竞速复制到每个调用方（Hero 菜单、侧栏分组 `+`），且轮询与订阅比是同一件事的劣化实现。
- **保持立即抛错，只补可见提示**：用户至少能看到失败原因，但点击仍然不生效；启动窗口期本体是可修的，不该降级成报错。
- **让 `connectNoDirectory` 退回 `session.create` 的默认 cwd**：会把无目录会话落到 `process.cwd()`，可能等于真实 Workspace 路径并被成员投影吞并，违反无目录会话的核心不变量。
- **让会话后端忽略编码不匹配的文件**：能救本次环境，但把「根目录被两种编码污染」这一真实损坏静默化，会让用户以为会话丢了；扫描 fail-loud 是有意的，修法应是清理产生该文件的来源，而不是放宽读取。
- **删除残留的 `preset-keep` 占位会话**：能恢复，但销毁了排查证据且不可逆；隔离到 quarantine 既恢复启动又保留现场。

## Consequences

- Hero 在列表仍加载时选择「无工作目录」会在 baseline 到达后打开空白会话，芯片显示「无工作目录」、输入框解锁，不再表现为点击失效。
- 等待有界：baseline 正常但缺 `scratchCwd` 会以可读错误结束并弹提示，不会挂起；owner 销毁立即中止。
- 宿主服务缺席（如本次的编码冲突）现在以可见的「新建会话失败」暴露，而不是与「点击无效」混为一谈；实测确认提示内容随 Host 失败原因变化。
- 本次实测环境的残留文件已隔离至 `quarantine/sessions/`，`dsh web` 重新启动后不再出现 `4 entries did not activate`，`workspaceController` 恢复。
- 回归：`packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` 新增三条——加载中排队后成功、ready 但缺 cwd 可见失败、等待中销毁释放；定向 66 例、该卡四包门禁 1331 例通过。
- 桌面 fork marker 增加 `connectScratchCwd`，防止上游同步时静默回退成抛错版本。
- 相关记录：[无目录任务会话](../../../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-no-directory-task-sessions.md)。
