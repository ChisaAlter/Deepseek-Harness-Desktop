# 模块：启动与 Harness 生命周期

## 职责与非目标

**职责：** 冷启动闸门（只开启动器）、拉起 / 监视 `dsh web`、boot 态机、就绪后露出 BrowserView、崩溃重启。  
**非目标：** 不实现对话业务；不扩散启动页海平线画布到启动器或其它页。

## 用户路径

1. 冷启动只见启动器：检查正式版、可选导入、再启桌面端。  
2. 桌面主窗见海平线画布与底缘日志 ticker（点击开抽屉看全部） → 插件进度 → 主界面。  
3. 失败：启动器留下并打开插件问诊；boot 仍可重试、取消自动重启、导出日志、回启动器排查；跳过用户插件是自动恢复路径而非按钮。  
4. 运行中 Harness 挂掉：故障态与可选自动重启。

## 架构要点

- `whenReady` 只 `showLauncher()`；`HarnessController.start()` 由启动器在更新检查之后触发。  
- `HarnessController` 拥有子进程与揭示时机；boot 只消费事件。  
- 恢复与手动重启共享未完成的 boot 导航；新 Harness 揭示前必须等待旧导航完成，避免迟到的启动页覆盖新界面。
- 插件装载进度留在 boot，不切官方加载页。  
- 揭示先持桌面透明，等待窗控注入与全尺寸布局产帧，再按动效 token 淡入；boot 保持不透明，渲染侧报告过渡完成后才遮盖。取消/替换后的旧回调无效，减弱动效直切；失败回退也须挂载并解除透明，而非只隐藏 boot。
- 无账号或模型密钥也直接揭示工作区，不弹原版欢迎窗；登录和密钥配置留在设置。后台账号观察保留授权外开与 Platform 身份刷新，退出/过期不隐藏工作区。冒烟检测到欢迎窗即失败，不自动点击跳过，见 [desktop-welcome](../../features/desktop-welcome.md)。
- 主 frame preload 的 `dshDesktop.onboarding: false` 同时关闭首次用途/过程引导，不创建 controller、不写完成标记或默认偏好；通用设置保留这些选项。冒烟不代点继续/稍后配置。
- 流程详述：[../flows/boot-to-ready.md](../flows/boot-to-ready.md)

## 实现入口

- `src/main/index.js`、`launcher-gate.js`、`harness-controller.js`、`dsh.js`、`harness-extract.js`、`window.js`、`chrome.js`、`../shared/dsh-home.js`、`../shared/themes.js`
- `src/renderer/launcher.html` / `launcher.js` / `launcher.css`
- `src/renderer/boot.html` / `boot.js` / `boot.css` / `boot-tokens.css`

## 退出/更新保护（P1）

显式 quit 现与安装/启动器停止一样跳过工作清单二次确认，但保留检查、接纳锁和 drain；锁/排空失败仍显示故障恢复提示。Host 不把本地回环空闲长连接计作远程工作，agent/job/在途请求仍独立检查，见[退出修复](../../decisions/implemented/bug-fix/2026-09-29-quit-transport-false-positive.md)。重启/重载仍需活动任务确认。

退出、重启、停止、reload、更新、增量安装全部过 `src/main/task-protection.js` 协调器：`inspect → 脏则确认（壳层弹窗，无可见窗退原生框） → acquire（Host 接纳锁 + drain）→ 复查 → commit`；launcher 发起的停止（peer `stop-desktop` 与自带启动器 `stopOp`）带 `preConfirmed` 跳过两道确认门——点击即同意。Host 侧 `vendor/dsh-task-control`（overlay `desktop-task-control.patch.yml` 每次启动挂载）包裹 webServer 路由/升级/`connection/request` 瀑布与 `sessionController.resolveAgent`、`jobs.start`，锁定期间新工作一律拒绝，解锁时驱动 schedule `requestDrive` 恢复到期投递。slim 包经 userData 的 `task-control-peer.json` 握手让外部桌面自己跑协调；无握手的旧桌面走 WM_CLOSE，进程仍在即阻断，不再 `taskkill /F`。决策记录：[../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md](../../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md)。

## 不变量

- Feature card：[../../features/desktop-launcher.md](../../features/desktop-launcher.md)、[../../features/boot-page.md](../../features/boot-page.md)、[../../features/dsh-home.md](../../features/dsh-home.md)、[../../features/task-protection.md](../../features/task-protection.md)
- 启动器走官方 `--dsw-alias-*`；`--boot-*` 不得用于启动器 / 设置 / 官方 UI / 关闭遮罩。
- 启动器浅色/深色跟官方 dsh web 表（`data-ds-dark-theme`），不把 Appearance 壁纸种子写进 token。
- 桌面家目录见 [dsh-home.md](dsh-home.md)：`userData/dsh-home`，不读官方 `~/.dsh`。
- 打包运行时目录 `userData/runtime/<version>` 用 pin+归档戳校验；同版本覆盖安装不得沿用旧 Harness 树。

## 门槛

- QA：`TC-LAUNCH-001` … `TC-LAUNCH-008`、`TC-INST-001` … `TC-INST-008`、`TC-INST-009`、`TC-INST-011`

## 延伸阅读

- [../design-language.md](../../design-language.md#桌面启动器)、[桌面启动页](../../design-language.md#桌面启动页)
- [plugin-recovery.md](plugin-recovery.md)、[dsh-home.md](dsh-home.md)
