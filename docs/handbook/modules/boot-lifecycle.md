# 模块：启动与 Harness 生命周期

## 职责与非目标

**职责：** 冷启动闸门（只开启动器）、拉起 / 监视 `dsh web`、boot 态机、就绪后露出 BrowserView、崩溃重启。  
**非目标：** 不实现对话业务；不扩散启动页仪器风到启动器或其它页。

## 用户路径

1. 冷启动只见启动器：检查正式版、可选导入、再启桌面端。  
2. 桌面主窗见仪器画布与日志 → 插件进度 → 主界面。  
3. 失败：启动器留下并打开插件问诊；boot 仍可重试、导出日志、跳过用户插件。  
4. 运行中 Harness 挂掉：故障态与可选自动重启。

## 架构要点

- `whenReady` 只 `showLauncher()`；`HarnessController.start()` 由启动器在更新检查之后触发。  
- `HarnessController` 拥有子进程与揭示时机；boot 只消费事件。  
- 恢复与手动重启共享未完成的 boot 导航；新 Harness 揭示前必须等待旧导航完成，避免迟到的启动页覆盖新界面。
- 插件装载进度留在 boot，不切官方加载页。  
- 流程详述：[../flows/boot-to-ready.md](../flows/boot-to-ready.md)

## 实现入口

- `src/main/index.js`、`launcher-gate.js`、`harness-controller.js`、`dsh.js`、`harness-extract.js`、`window.js`、`chrome.js`、`../shared/dsh-home.js`、`../shared/themes.js`
- `src/renderer/launcher.html` / `launcher.js` / `launcher.css`
- `src/renderer/boot.html` / `boot.js` / `boot.css` / `boot-tokens.css`

## 不变量

- Feature card：[../../features/desktop-launcher.md](../../features/desktop-launcher.md)、[../../features/boot-page.md](../../features/boot-page.md)、[../../features/dsh-home.md](../../features/dsh-home.md)
- 启动器走官方 `--dsw-alias-*`；`--boot-*` 不得用于启动器 / 设置 / 官方 UI / 关闭遮罩。
- 启动器浅色/深色跟官方 dsh web 表（`data-ds-dark-theme`），不把 Appearance 壁纸种子写进 token。
- 桌面家目录见 [dsh-home.md](dsh-home.md)：`userData/dsh-home`，不读官方 `~/.dsh`。
- 打包运行时目录 `userData/runtime/<version>` 用 pin+归档戳校验；同版本覆盖安装不得沿用旧 Harness 树。

## 门槛

- QA：`TC-LAUNCH-001` … `TC-LAUNCH-008`、`TC-INST-001` … `TC-INST-008`、`TC-INST-009`、`TC-INST-011`

## 延伸阅读

- [../design-language.md](../../design-language.md#桌面启动器)、[桌面启动页](../../design-language.md#桌面启动页)
- [plugin-recovery.md](plugin-recovery.md)、[dsh-home.md](dsh-home.md)
