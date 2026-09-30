# 项目审查修复验证（2026-09-30）

对应[决策记录](../../../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)。上轮十一项缺陷已修复；全量验证另发现并修复 Windows 插件市场 junction 快照阻断。所有变更保留在工作区，未提交或发布。

## 修复范围

| 审查项 | 修复与回归 |
| --- | --- |
| 文件草稿丢失 | 每次编辑持久化草稿；文件 tab 保持挂载；共享保存/丢弃确认；失败、异步旧结果和跨会话同号 tab 均有回归。 |
| LAN 畸形请求 | 请求边界返回 400，缺失资产返回 404，后续正常 HTTP 仍可处理。 |
| updater 安装失败假成功 | 差量只下载；版本与 SHA512 验证后在协调器 commit 内观察 spawn。失败释放接纳锁、保留服务与清理钩子，重试重新检查。显式取消令牌传入真实下载 API。 |
| 回环监听扩大 | bind 实参、快照与配对 URL 一致，仅本机配置保持 loopback。 |
| 端口/TLS 控件无效 | remotePort 连接真实 daemon；移除未实现的 TLS 控件并说明实际加密范围；静态页独立使用 3180。 |
| 选区被当成路径 | 原文追加到所属会话，路径提及仍走独立回调。 |
| 文件树绕过统一路由 | 树与搜索使用 Workspace openPath，保留 HTML/PDF Browser 路径和所属 Session。 |
| 编码预览路径 404 | 路径段单次解码，中文、空格、百分号可访问，编码分隔符/穿越/NUL 仍拒绝。 |
| 等长归档错误复用 | 提取戳记录实际 SHA256；同版本等长内容变化刷新；旧戳迁移一次。 |
| 构建输入遗漏 | helper/vendor/manifest/native 平台输入与产物纳入凭据，生成目录排除。 |
| macOS 选择 EXE | 按平台/架构选择 DMG，校验后打开并显示手动安装提示，不宣告安装成功或退出应用。 |
| 追加：Windows junction 快照 | 目录链接使用既有 junction helper，保存原字节和目标身份，不遍历外部 overlay，拒绝覆盖未知目录。 |

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 根 Node 全量 | 2886 项：2863 pass、14 fail、9 skip；失败详情见下文。 |
| Files / Sidebar / Surfaces 定向 | 268/268；最终机械清理后生命周期 17/17、apply adapter 9/9 再通过。 |
| 远程设置 UI | 51/51；变更文件 lint 与本包 i18n 扫描通过。 |
| 更新设置 UI | 16/16；四源码窄 lint 通过。 |
| 归档 / after-pack / shared identity | 73/73。 |
| 构建凭据 | 15/15。 |
| 远程 / 移动 / 预览 / daemon / stdio | 构建后 74 项：71 pass、3 skip；真实 daemon HTTP、配置端口与 broken stderr 子进程均通过。 |
| Marketplace / plugin gates | 113/113；快照/插件定向 85/85。 |
| Workspace lock | frozen、offline、ignore-scripts 安装验证通过，无依赖版本漂移。 |
| 治理 / 文档 | governance 6/6；doc-sync 7/7；diff whitespace 检查通过。 |
| Windows 窗口 | 两个 production factory 的 native styles、maximize/restore/minimize 与页面 alpha 通过；composed 模式两个窗口的 active/inactive/resized/restored 四角及内区全部通过。 |
| 源码冒烟 | 官方 UI、标题栏点击、PTY echo 通过，pageErrors 为空。 |
| 应用重启 | 最终 prestart 完成并重新启动源码 Electron；未提交或发布。 |

环境为 Windows、Node 24.19.0、Electron 43.4.0；仓库 Node pin 为 24.21.0，本次未更改 pin。首次安装使用 frozen lock 并单独准备 Electron；运行时构建已完成 Harness 和 ChisaCode 产物。

## 未完成的环境验收

全量的十四项失败均发生于本机不能创建文件符号链接的夹具：Setup 校验 1 项、MCP/settings/credentials 导入 12 项、Git large-file 1 项。错误为 EPERM 或其后续夹具断言；没有将这些用例改成跳过以宣称全量通过。九项 skip 包含链接权限、Windows 的 POSIX SIGTERM 差异及 dist 已存在时不可达的缺失产物分支。

没有执行真实 Windows NSIS 安装、macOS DMG 挂载安装、公网 relay / Android 真机配对。窗口命令的 native/composed 检查通过，但不把状态与截图检查宣称为可见 DWM 插值动画的人工验收。vendor 全量旧 note 格式与全仓 UI 文案扫描仍有既有违规，本次变更范围的 note、配对和 UI lint/i18n 检查通过。

## 复跑入口

- 根测试：`node --test --test-concurrency=4 "src/**/*.test.js" "mobile/web/**/*.test.js" "scripts/**/*.test.mjs"`。
- 构建与启动：`npm start`，先移除继承的 `ELECTRON_RUN_AS_NODE`；本次验证环境仅在进程中跳过 pnpm 自动版本下载并使用锁文件安装。
- 文档：`npm run check:governance`、`npm run doc-sync`。
- 源码：`node scripts/run-source-smoke.mjs`。
- 窗口：`node scripts/run-window-motion-qa.mjs`、同命令加 `--composed`；本机 Restricted PowerShell 在 QA 子进程使用临时 Process 级 Bypass，没有修改系统执行策略。
