# 0.2.9 集成候选包验收

日期：2026-09-05。状态：未批准发布。

> 后续进展（2026-09-06 北京时间 / 2026-09-05 UTC）：PR #83 已合并，候选安装包未改变。原生工具已恢复并完成一批真实安装版验收；[完整 Windows 验收表](WINDOWS-ACCEPTANCE.md)现记录 23/66 项 P0 Pass，43 项仍未放行，无新增豁免，仍未批准发布。下文的草稿 PR、工具故障和待测描述保留为对应阶段的历史记录；当前状态以验收表及[发布检查单](../../../../superpowers/plans/2026-09-05-dshd-0.2.9-github-release-checklist.md)为准。

## 候选身份

- 提交：`a6e9271f8724cd27195398fe7c0ea485eb007dfb`。
- 分支：`codex/release-0.2.9-integrated`，草稿 PR #83。
- Desktop tests：run `33969468969`，success。Windows/macOS 单测、vendor GUI、核心契约、畸形工具恢复、目录与声明检查均通过。
- Build installers：run `33969469600`，Windows/macOS 均 success；Windows packaged smoke 通过，release job 按 workflow_dispatch 契约 skipped。
- Windows artifact：`9970688267` / `DeepSeek-Harness-windows-x64`，623802481 字节；CI archive digest `sha256:260b9805d934e4353b83d83f20421b79992dc899060a0e34a5ad5dcf572a0430`。此摘要属于 artifact ZIP，不是 Setup 文件 SHA。
- macOS artifact：`9970599081` / `DeepSeek-Harness-macos-arm64`，构建通过，不代表 macOS 实机验收。

## 范围

包含远程 Web/Android 源码恢复、目录瘦身、输入框边光与宽度联动、dsh-im 消息渠道兼容修复。按用户要求排除本轮未提交的 dshbot 改动，不回退已提交历史中的 dshbot 剥离。原始会话数据、截图和剪贴板不上传。

## 待完成

- 同 SHA CI Setup 已完成覆盖安装；仍需完成生产验收表，不能使用本地 dist 或旧候选报告代替。
- Android 实机仍无连接设备；手机蜂窝网络完整验收未完成。
- 未创建发布标签、未合并草稿 PR、未公开 Release。

## 下载与包内核对

- Setup：`C:/Ai/Deepseek-Harness-Desktop/.tmp/ci-candidate-33969469600/Deepseek-Harness-Desktop-Setup-0.2.9.exe`，624434954 字节。
- Setup SHA256：`ade70b6681bb56265bcc8e549948dae61b502ef21791f2b3796005ba82fca9c9`。
- blockmap SHA256：`306c132eefc0aa0540fef849da1af1497c884549f2e97e32b12b032b623f76a5`。
- 只读解包核对版本为 0.2.9；内置 `node.exe --version` 为 v22.22.2，与 `.nvmrc` 一致。
- 下列包内文件与候选提交逐一比较通过（仅归一 LF/CRLF）：`src/shared/dshd-host-tunnel.js`、`src/main/dshd-daemon-hooks.mjs`、`mobile/web/app.js`、`mobile/web/chisacode/session.js`、`mobile/web/chisacode/controller.js`、`vendor/dsh-im/lib/index.js`、`vendor/harness-upstream.json`。
- CI packaged smoke 日志确认 UI、标题栏点击和 PTY 探针通过；不能代替本机安装后的生产验收。
- 本机旧版 7-Zip 不支持部分 ARM64 二进制压缩方法；缩小为上述目标文件后提取成功。本次不是全部归档内容的完整性测试。
- 本节包内核对阶段尚未运行 Setup；后续安装结果见下文。未修改系统代理或公网部署。

本报告不继承 run 33942243475、33951140932 或本地运行包的实机 Pass。最终 Release 必须使用本报告实际验收的同一份 Setup 文件。

## 安装尝试

用户确认继续安装后检查发现桌面已退出。原安装是 `C:/软件/Deepseek-Harness-Desktop` 的 all-users 安装，当前执行令牌非管理员。

- 已备份关键配置与凭据到本机 `C:/Users/48818/AppData/Local/dshd-qa-backups/ci-33969469600-20260905-223138`，未上传。
- 安装前记录 315 个会话文件 SHA256；取消后复核全部保持原字节。
- 对同 SHA Setup 发起 `/S /allusers /D=C:\软件\Deepseek-Harness-Desktop` 的 RunAs 请求。
- UAC 授权被取消，Start-Process 报告“操作已被用户取消”；安装器未成功启动，未进行覆盖安装，不能将外层 PowerShell 的零退出码当作安装成功。
- 安装验收状态为 Blocked（需要管理员授权），不是安装包功能 Fail。未自动重试授权、未启动旧版冒充候选包。

## 继续推进后的实际结果

用户再次明确要求连续推进后，重新执行同一 SHA Setup 的标准 RunAs 安装；本次安装器正常运行，退出码为 0。前一次取消保留作历史记录，管理员授权已不再是当前阻塞。

- 安装位置：`C:/软件/Deepseek-Harness-Desktop`，已有 all-users 自定义路径覆盖，不冒充干净机默认路径安装。
- 安装后的 `resources/app.asar` 与该 CI Setup 提取件 SHA256 完全一致：`7aaffd00cd7c7f6149de2b1e599dd5b9ca573cd6dd863b8ab78610a4a22aca8d`。
- 安装完成、首次启动前复核 315 个既有会话文件，0 个变化或缺失。
- 安装目录内 `resources/node.exe --version` 输出 `v22.22.2`。
- 从真实开始菜单快捷方式启动，进程路径为上述安装目录，不是源码或 dist。`last-desktop-start.json` 记录 `ok: true`、`error: ""`，时间 `2026-09-05T14:51:13.613Z`（北京时间 22:51:13）。
- Harness 在 3080 端口监听；不带认证访问返回认证要求，这是访问保护，不计为启动故障，也不单凭此判定 UI Pass。
- 再次启动同一快捷方式后，主窗口 PID 仍为 30616，未出现第二个主窗口；焦点行为未取得界面证据。

### 当前验收阻塞

- 原生桌面工具两次初始化及重置后重试均报 `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`；浏览器工具同样报错。不能进行可靠的截图、界面观察和交互验收。
- 备用 Puppeteer 公网检查在浏览器启动阶段失败，默认浏览器和显式 Edge 均报 `Failed to launch the browser process: Code: 0`，stderr 为空；尚未进入配对阶段。这不是新的公网连接 Fail，也不是候选公网 Pass。
- 已结束失败的测试进程，没有重复启动安装器、改动安全设置或用旧包结果填充新候选报告。
- `adb devices` 仍为空。Android 源码与构建结果不代替 Android 实机验收。

安装、文件同一性、数据保留和启动日志检查已完成；生产用例表、候选公网浏览器复测与设备实测尚未完成。无新增豁免，仍未批准公开发布，PR 保持草稿，未推发布标签。

## 浏览器故障修复与候选公网复测

上述浏览器启动阻塞已解决。定位到 Puppeteer 报退出码 0 后，Edge 测试进程仍在运行，并带有兼容层重启参数。对同一浏览器最小启动用例，仅增加 `--edge-skip-compat-layer-relaunch` 后即输出 `PASS qa-ready`。已将仅针对 `msedge.exe` 的兼容参数固化到 `tools/mobile-web-qa/run-connect-public-qa.mjs`，不关闭沙箱，不修改系统代理，不修改候选包内容。

对象仍为已安装的 CI a6e9271 候选桌面，真实用户目录；前端为现有公网 SPA，只有 bundle 计时插桩，没有本地资源替换或公网追加部署。

| 路径 | 新配对耗时 ms | 五次重连耗时 ms | 结果 |
| --- | --- | --- | --- |
| 公网直连 | 5044 | 4960 / 5172 / 4978 / 6193 / 5241 | 6/6 |
| 继承系统代理 | 5834 | 4656 / 5114 / 7696 / 5285 / 8641 | 6/6 |

- 两组撤销设备拒绝测试均恢复已保存电脑控件，显示明确错误，不再静默等待。
- 12/12 次加载均进入 chat，无错误横幅；每次返回 217 条会话和 2 个工作区；目录大小 62589-62590 字节；未出现 30 秒目录超时。
- 固化脚本后，不再使用临时 launch 包装，额外独立执行新配对 + 一次重连，耗时 9017 / 10105 ms，2/2 通过。日志：`public-post-launch-fix.log`。
- 所有这些测试创建的临时 QA 设备均在 finally 中撤销。未上传配对密钥或会话内容。
- 总计本轮候选桌面公网连接检查 14/14；这是桌面浏览器公网检查，不是 Android 设备或蜂窝实机验收，也不是全部生产验收表通过。

原生桌面工具的 kernel assets 目录错误仍独立存在。尝试开启安装版临时调试端口时，执行策略明确拒绝，未绕过。此前关闭信号验证了关闭到托盘；临时将 closeToTray 改为 false 后应用正常退出、3080 监听消失，随后恢复 true 并从原开始菜单快捷方式普通启动。无强制结束桌面进程，无调试端口遗留。

当前状态：公网浏览器启动与连接复测阻塞已解除；原生交互验收仍未完成，不能批准 Release。验收脚本本地修改不属于 a6e9271 安装包，不把脚本改动伪称为候选二进制变更。
