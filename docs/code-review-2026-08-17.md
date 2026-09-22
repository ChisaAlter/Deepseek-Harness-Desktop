# Deepseek-Harness-Desktop 全代码审查报告

- 审查日期：2026-08-17
- 审查对象：main @ 88d028a（package.json 0.2.1）
- 审查方法：4 路并行深审（主进程安全 / 渲染层与设计合规 / 构建发布与 CI / vendor 集成与文档）+ 本地测试实跑验证 + 关键结论抽查复核
- 规模基线：自有代码 140 个跟踪文件、约 19,665 行（js/mjs/css/html）；vendor subtree 7,843 个文件（`@deepseek-ai/dsh-root` 0.1.0-rc.5）；31 个测试文件、259 个测试

---

## 0. 执行摘要

**一句话结论：代码工程质量高于平均水平（生命周期编排、设计语言合规、安全基线都做得认真），但存在一组围绕"preload 全量信任"的结构性安全问题、一条已经连续两次炸掉发布的构建流水线，以及冻结中的中继功能里的一处 Critical 设计债（功能未启用，随后续开发一并修复）。建议在发布 0.2.2 之前先修 P0 清单。**

各维度评分（5 分制）：

| 维度 | 评分 | 一句话 |
|---|---|---|
| 架构与模块划分 | 4.0 | 三条能力主线清晰，单飞/代际守卫质量高 |
| Electron 安全基线 | 4.0 | contextIsolation/sandbox/导航守卫齐全 |
| 信任模型（preload/IPC） | 2.0 | 全量 shell API 挂给所有回环页面，无 sender 校验 |
| 远程/中继安全 | 1.5（功能冻结中） | 中继宿主端点零认证 + 明文 HTTP；默认 `remoteEnabled:false`，入口已隐藏 |
| 渲染层与设计合规 | 4.5 | 平行色板已清零，boot 例外守住边界 |
| 构建与发布工程 | 2.5 | v0.2.0 下架、v0.2.1 流水线死亡 |
| 测试 | 3.0 | 广度好（259 个），跨平台性与隔离性差 |
| vendor 集成与供应链 | 2.5 | subtree 元数据损坏，运行时下载无校验 |
| 文档一致性 | 3.0 | 功能描述属实，版本叙事自相矛盾 |
| 工作区卫生 | 2.5 | ~4GB 构建垃圾，但均已 gitignore |

问题计数：**Critical 1（位于默认关闭、入口已隐藏的中继功能，随该功能后续开发修复）/ High 6 / Medium 13 / Low+Info 20+**（明细见下文各节）。

### P0（发布任何新版本之前必须修）

1. **H-2** API Key 明文下发给渲染进程（`src/main/ipc.js:23`）
2. **B-高1** `workspace-authority.js` 根目录未 realpath 化 → macOS 57 个测试失败 → v0.2.1 发布死亡的直接根因（`src/main/workspace-authority.js:71-125`）
3. **T-1** 测试环境隔离缺失：本地 `npm test` 因主目录游离 `.git` 红灯（设 `GIT_CEILING_DIRECTORIES` 隔离）

> **中继（relay）功能暂未启用、后续再开发**（维护者 2026-08-17 确认）：C-1 不计入当前 P0。但其安全要求（认证握手、强制 TLS、宿主通道分离）是重新启用中继前的硬性前置条件，详见 §1.1。

### P1（尽快修）

4. **H-3** preload 全量 API 挂载到任意回环内容 + IPC 无 sender 校验
5. **H-4** `shell:install-plugin` 不校验 spec，绕过 `github:owner/repo` 白名单
6. **H-5** `shell:save-config` 无字段白名单 + `shell:restart` = 渲染层指定任意可执行文件
7. **H-6** `will-download` 文件名未净化（目录穿越写任意位置）
8. **R-1** CSP `style-src 'self'` 与 theme.js 内联样式写入冲突 → 非默认主题在 marketplace 窗口完全失效
9. **P-高3** release.yml 把 macOS 设为必要阻塞，mac 挂则 Windows 产物全灭（v0.2.1 事故复现路径）

---

## 1. 安全审查（主进程 / IPC / 远程面）

### 1.1 Critical（功能冻结中：中继暂未启用）

> 状态说明（维护者 2026-08-17 确认）：中继功能暂未启用、后续再开发。默认 `remoteEnabled: false`（`config.js:21`）、默认 `remoteMode: 'lan'`（`config.js:24`）、README 声明远程入口已隐藏、mobile 端未实现——当前发布版本不存在此攻击面，需手动改配置并切到 relay 模式才会暴露。以下发现转为**重新启用中继前的硬性前置条件**，不计入当前 P0。

**C-1 中继（relay）宿主端点完全无认证，且默认中继走明文 HTTP**
- `src/relay/server.js:170-178` — `handleUpgrade` 只校验路径 `/__dsh__/host` + 升级头 `dsh-relay`，无任何 token。任何能连到中继的人发起同款 upgrade 即可成为"宿主"，并经 `attachHost`（`server.js:71-96`）踢掉真宿主、接管全部流量。
- `src/main/relay-client.js:36-43, 283-321` — 桌面到中继为明文 socket，手机的全部 Harness 会话流量原样经中继转发。
- `src/main/config.js:25` — 默认 `remoteRelayUrl: 'http://125.124.85.212:8411'`（明文 IP+HTTP，已抽查证实）。
- 影响：配对 token（`#offer=`）、会话内容对中继运营者/中间人完全可见；可在中继上冒名抢占宿主做会话劫持/DoS。
- 修复：中继与桌面共享密钥握手；宿主通道与流量通道分离；默认强制 `https:`；中继侧对抢占互踢加仲裁。

### 1.2 High

**H-2 真实 API Key 明文下发到渲染进程**（已抽查证实）
- `src/main/ipc.js:23` — `configPayload` 返回 `apiKey: config.apiKey` 原始值，覆盖了 `config.js:151-164` 的 `'********'` 掩码。任何挂载 preload 的页面（含运行第三方市场插件的 Harness 页面）调用 `shell:get-config` 即可拿走可扣费的 DeepSeek Key。
- 修复：只返回 `hasApiKey` 布尔；生成 commit/PR 消息所需凭据由主进程直接读 config（`git-generate.js` 已具备该能力）。

**H-3 特权 preload 全量 API 挂载到任意回环内容，IPC 处理器不校验 sender**
- `src/main/window.js:246-260` — Harness BrowserView 与主窗口共用同一 preload；`src/preload/index.js:3-127` 暴露 `readFile/writeFile/ptyCreate/ptyWrite/installPlugin/gitPush/gitCommit/installUpdate/saveConfig` 等 40+ 方法。
- 导航守卫只拦到"回环 HTTP"粒度（`local-url.js:16-26` 允许 localhost 任意端口），`ipc.js` 全部 handler 均不校验 `event.senderFrame`。
- 影响：Harness 生态任一插件脚本/XSS 即获得"工作区任意读写 + 起 shell + 以用户 git 凭据提交推送 + 任意 pnpm 安装"的整机能力包。
- 修复：按页面角色拆分 preload（Harness 视图收窄）；敏感 handler 校验 senderFrame URL 必须是当前授权回环 origin 且拒绝子 frame。

**H-4 `shell:install-plugin` 绕过 github spec 白名单**
- `src/main/ipc.js:120-132` → `marketplace-install.js:214-234`：只过滤退役名单，registry 包名/tarball URL/git URL/`file://` 均可直达 `pnpm add`（`marketplace-install.js:151,229`）。对比桌面安装通道 `install-dsh-plugin-client.js:8-19` 有严格 `isValidGithubSpec`，IPC 路径绕开了这道闸。渲染层提供的 `allowBuilds` 数组还直接写入 `pnpm-workspace.yaml`（`ipc.js:124`、`marketplace-install.js:102-121`）。
- 修复：`installPlugin` 入口统一复用 `isValidGithubSpec`；allowBuilds 写入前过 `parseAllowBuilds` 同款白名单。

**H-5 `shell:save-config` 无字段白名单 → 任意可执行文件运行原语**
- `src/main/ipc.js:55-69` 接受任意字段含 `dshBin`/`nodeBin`；`dsh.js:528-583,711-715` 直接以 `config.dshBin` spawn，`.cmd/.bat` 走 `shell:true`（`dsh.js:313-321`）；`shell:restart`（`ipc.js:92-95`）即可触发。
- 修复：patch 字段级白名单 + 类型校验；`dshBin/nodeBin` 不接受渲染层设置。

**H-6 `will-download` 强制保存路径，文件名未净化**
- `src/main/index.js:244-248` — `item.getFilename()` 直接 join Downloads 并 `setSavePath`。恶意 `Content-Disposition`（`..\..\...\payload.exe`）可写任意位置，且剥夺用户确认。
- 修复：`path.basename` + 分隔符替换净化。

### 1.3 Medium

- **M-7 workspace 权威白名单可被 Harness 侧扩充**：`workspace-authority.js:180-231` 的 `storages/workspace.json` 由 Harness 进程可写，注册任意路径（含 `C:\`、`~/.ssh`）即扩张 `readFile/writeFile/ptyCreate` 作用域；`resolveInside`（:87-104）返回词法路径，存在 symlink TOCTOU 窗口。它是防误用纵深而非安全边界——文档/代码应如实定位。
- **M-8 LAN Remote 登录无 Origin/CSRF 校验、无限流；rotateToken 不吊销设备 token**：`remote.js:506-522, 260-283`；设备 cookie 有效期 1 年（`remote-auth.js:5,76`）；默认绑 `0.0.0.0`（`remote.js:454`）。（远程面整体默认关闭，与 C-1 同属冻结项，随功能开发一并处理。）
- **M-9 自更新无签名/哈希校验**：`update.js:195-231` 下载 NSIS 后直接 spawn，重定向最多跟 8 跳。建议校验资产 SHA-256 + 限定重定向域。
- **M-10 allowBuilds 写 YAML 无注入防护**：`marketplace-install.js:102-121`（放大 H-4）。
- **M-11 端口清理可能误杀用户 node 进程**：`dsh.js:283-297, 396-406` 仅按镜像名判定即 `taskkill /T /F`。应结合命令行参数判定归属。
- **M-12**（并入 §4 B-高1）workspace-authority realpath 缺陷。

### 1.4 Low / Info（摘要）

- L-13 PR 正文临时文件可预测（`git.js:618`），改 `mkdtemp`+0600。
- L-14 凭据明文落盘 `userData/credentials.json`（`config.js:141-147`），建议 `safeStorage`。
- L-15 git-generate 把暂存区 diff 发往第三方端点（`git-generate.js:121-206`，baseUrl 可配任意端点）——设计行为但应有 UI 明示。
- L-17 preview 分区放行任意 CDN 子资源（`preview.js:79-85`），建议加 CSP。
- L-19 安装控制通道 token 比较非恒定时间（回环+256bit，实际风险可忽略）。
- L-20 生产包 `Ctrl+Shift+I` 可开 DevTools（产品决策项）。
- L-22 `RemoteGateway.sync/stop/start` 无单飞去重，并发可双 bind（`remote.js:377-481`）。
- L-24 `harness-extract.js:44-63` 解压不校验成员路径（归档来自安装包内，信任上游，建议防御性过滤 `../`）。

### 1.5 安全基线正面项（值得保留的强项）

- 所有窗口/视图 `contextIsolation: true + nodeIntegration: false + sandbox: true`，未用 webview，未加载远程渲染文件。
- 导航守卫三连（will-navigate/will-redirect/setWindowOpenHandler）+ `local-url.js` 纯函数白名单（拒 `127.0.0.1.evil`、userinfo@、任意 file:）。
- shell 调用全走 `spawn(argv)` 数组形式，无字符串拼接 exec；git 参数大量 `--` 分隔 + `safeRefName`；输出 2MB 上限与超时（`git-exec.js:257-265, 33-46`）。
- 凭据比较 `timingSafeEqual`（`remote-auth.js:11-18`）；PTY/预览有统一收尾；boot/marketplace 有 CSP。

---

## 2. 渲染层与设计语言合规

### 2.1 High

**R-1 CSP `style-src 'self'` 与 theme.js 内联样式写入自相矛盾 → 用户主题在 marketplace 窗口完全失效**
- `boot.html:5`、`marketplace/index.html:5` 的 CSP 无 `'unsafe-inline'`；而 `theme.js:17,23-39` 靠 `style.setProperty`/`root.style.colorScheme` 写内联样式。CSP3 下 `style-src 'self'` 会拒绝全部内联 style 写入（Chromium 静默忽略）。
- 影响：选"午夜/青瓷/暮紫"等主题族时 marketplace 窗口全部回落默认色；boot 页 `colorScheme` 失效。
- 修复：两处 CSP `style-src 'self' 'unsafe-inline'`（script-src 保持严格），或改主进程 `insertCSS`；补一条主题切换自动化验证。

### 2.2 Medium

- **R-2 注入 chrome 拖动方案依赖 BrowserView 上 `-webkit-app-region`**（`harness-chrome-inject.js:193-211`）：Electron 对 BrowserView 内容的 drag 支持非官方担保，需实测矩阵回归（v0.2.0 的"标题栏不可点"事故正发生在这条注入线上，虽然根因已修，说明该区域是高脆弱带）。
- **R-3 marketplace innerHTML 转义不一致**（`marketplace.js:79-136`）：`data-id`/`stars`/`data-cat` 未转义，当前靠 GitHub 命名字符集兜底；catalog 字段一旦扩展即成真 XSS。统一过 `escapeAttr/escapeHtml`。
- **R-4 DOM 嗅探式注入对官方重构脆化**（`harness-chrome-inject.js:71-99, 260-372`）：类名启发式 + MutationObserver 高频重测量 + `shell:chrome-metrics` 高频 IPC。优先用官方 data 属性；measure 前先 diff 采样值。
- **R-5 主题实时同步缺口**：官方页内换主题只写 `settings.yaml`，桌面壳无 watcher，boot/marketplace 停留旧主题（`ipc.js:56-62`）。
- **R-6 关闭键 hover 色 `#e81123` 写死**（`window-controls.css:40-41`）：违反 design-language 例外条款"原生控件颜色跟随主题 token"，应改 `--dsw-alias-state-error-primary`。
- **R-7 marketplace 模态不完整**：无焦点 trap/ESC（`marketplace.js:163-181`）。
- **R-8 几何残差**：输入/按钮 10px 圆角、sheet 16px、gap 10px（规范为 8/14-18/24/8 或 12），`marketplace.css:124-147, 268`。

### 2.3 Low

- R-9 `font-weight: 650` 违反规则 8（`marketplace.css:208`）。
- R-10 图标 12px 低于密集标题栏下限 14px（`window-controls.css:29-33`、`harness-chrome-inject.js:13-16`）。
- R-11 closing-overlay 阴影少一层（对齐 `--dsw-shadow-lv3` 完整三层，`closing-overlay.js:31`）。
- R-12 marketplace 残留未用 `--danger` 变量；`--bg/--fg/--accent` 等通用命名宜注释认领或直引 `--dsw-alias-*`（`marketplace.css:9-14`）。
- R-15 boot/marketplace 的 onState/onLog 订阅未保存 unsubscribe 函数（单例页面可接受）。

### 2.4 设计合规总体评价

- **boot 页是干净的 instrument 画布**：只引用 `--boot-*` + 官方字体/动效 token，零 hex 字面量，`--boot-*` 全仓零扩散；boot.js 全程 `textContent/replaceChildren`。
- **marketplace 平行色板已清零**：0 个 hex/rgb 字面量，8 个别名 100% 映射 `--dsw-alias-*`（commit 2d988f5 完成迁移）。**但 AGENTS.md:14 与 design-language.md:76、motion.md:141 仍声称其携带平行色板——文档已滞后于代码**。
- **注入 chrome 全程 token 化**，主题跟随官方页面变量，未发明第二皮肤。
- **themes.js 与官方七族种子逐项一致**，语义上是复用官方 Appearance 系统而非平行主题。
- 未发现可利用的高危 XSS 注入点。

---

## 3. 构建与发布工程

### 3.1 事故分析：v0.2.0 / v0.2.1 为什么被撤回

**v0.2.0（真发布 → 下架）**：安装包确实上过 Releases。两个真实运行时缺陷：① 注入拖拽条（56px 整条 drag）吞掉 Web UI 标题栏点击，除最小化/关闭外全部点不了；② 单个 MCP 子进程失败拖垮整个 Host。修复见 fffc93f；8eccd92 把 README 下载指引改回 v0.1.3，GitHub Release 已删但 tag 保留。

**v0.2.1（从未上线 → 流水线死亡）**：fffc93f 重组 release.yml 为 windows/macos/release 三 job 后推 tag，macos job 的 `npm test` **202 pass / 57 fail**（workspace-authority/git/pty/dsh 系列全挂），windows 与 release job 被连带 cancel——没有任何产物发布。根因即 B-高1 的 realpath 缺陷（macOS `/var→/private/var` 符号链接使 `containedIn` 判否）。随后删 tag、README 再退回 v0.1.3。

### 3.2 High

- **P-高1 桌面单测不跨平台**（= §4 B-高1，发布死亡的直接根因；对生产亦潜在：工作区位于符号链接前缀下时 Git/PTY/文件能力失效）。
- **P-高2 CI 平台盲区**：`test.yml` 两个 job 全是 windows-latest，mac 可移植性直到发布门禁才暴露。
- **P-高3 macOS 是必要发布阻塞**：`release.yml:100` `needs: [windows, macos]`，mac 挂则 Windows 产物全灭。改软依赖或 continue-on-error。
- **P-高4 无代码签名**：mac `identity:null` + Windows 无证书。README 已写 `xattr -cr` 属实，但应进 release-notes 已知风险。

### 3.3 Medium

- **P-中1 版本叙事三方矛盾**：package.json=0.2.1、无 v0.2.1 tag、GitHub latest=v0.1.3、`release-notes.md` 仍写"当前请用 0.2.1"（而它正是下次发版要用的 `--notes-file`）；README:7 写"当前请用 v0.1.3"。**自动更新在 0.2.x 源码上永远不会触发**（latest 0.1.3 < current 0.2.1，`update.js:82-116` 判定"已是最新"）。发布文案模板化 + 加 tag==package.json 校验。
- **P-中2 pnpm 三方版本不一致**：CI 钉 11.7.0、vendor packageManager 11.8.0、桌面 dependencies 11.8.0。统一到 11.8.0。
- **P-中3 setup-harness 无校验不可复现**：`git clone --depth 1 --branch master` 不锁 SHA、`pnpm install` 无 `--frozen-lockfile`。
- **P-中4 测试文件混入 asar**：`files: ["src/**/*"]` 把 42 个 `*.test.js` 打进产物；`pnpm` 在 dependencies 里同时进 asar 与 resources（实为构建期用途，应降 devDependency）。
- **P-中5 DSH_SMOKE 冒烟探针未接入门禁**：`index.js:112-174` 已实现完整探针（含真实 pty round-trip），但 run-final-gates/release.yml 都不跑它——v0.2.0 那种"标题栏不可点"正是一条冒烟就能拦住的缺陷。

### 3.4 Low / 卫生

- node-pty 打包风险可控（N-API prebuild 三平台齐全 + 加载失败有兜底不崩应用）。
- 打包路径双轨（CI 全量复制 vs 本机 `.pack-v2/v3/v4` 精简目录）行为不一致，精简路径无 CI 兜底。
- 工作区遗留约 4GB 构建垃圾：`dist/` 1.8GB、`release2..17` 约 929MB、`.pack-*` 约 806MB（均已 gitignore，`git status` 干净）；`.tmp/` 未列入 .gitignore（当前为空，建议补一行）；一次性调试脚本（patch-deploy/align-deploy/live-git-titlebar/render-icon）建议移 `scripts/dev/`。
- `release.yml` 两个纯构建 job 也拿了 `contents: write` 权限（应收敛到 release job）。

---

## 4. vendor 集成与供应链

- **V-高1 subtree split 元数据损坏，上游同步工作流实际不可用**：全历史只有 d2df50d 一处 squash footer，其 split hash 47f9438 不在本仓库对象库，实测 `git subtree split --prefix=vendor/deepseek-harness` 失败；README 承诺的"每次快照带 git-subtree-split"不存在。`sync-upstream.js` 首次 pull 即会受阻。需重建 subtree 元数据或改三方 merge + 显式记录上游 SHA 文件。
- **V-高2 运行时下载兜底无校验无版本锁定**：`dsh.js:574-582` npx `@deepseek-ai/dsh@latest`（无 pin、无 checksum）；`setup-harness.js:24` clone master 不锁 SHA。
- **V-中1 打包运行时只有结构检查无校验和**：`harness-extract.js:65-90` 只查两个文件存在；after-pack 生成的 tar 无 sha256 manifest。
- **V-中2 无本地定制清单**：二次开发直接写 vendor 树，无 `vendor-patches/` 或 diff 清单（.gitignore 还残留旧工作流痕迹），冲突时难清点定制面。
- **V-中3 版本漂移脆弱**：after-pack 的 feature 断言锚在业务特性字符串上，上游 pre-release 一动即断言失败（是护栏也是脆点）。
- **正面项**：插件安装控制通道（`install-dsh-plugin-client.js` + `desktop-install-control.js`）是整个集成面安全设计最好的部分——github spec 白名单、64KB body 上限、Bearer token、限权明确。三重启动链/端口抢占/进程清理与 README 语义一致。

---

## 5. 文档与承诺一致性

- **D-高1 版本号体系错位**（= P-中1 的文档面）：README 功能列表描述的是 0.2.1 源码功能，下载指引却指向 v0.1.3——两者相差整整一个功能代际（surfaces/Git 标题栏/终端都是 v0.1.3 tag 之后合入的）。建议功能列表锚定版本或分区标注。
- **D-中1 "平行色板"声明过期**：AGENTS.md:14、design-language.md:76、motion.md:141 三处仍在警告 marketplace.css 平行色板，实际已清零。
- **D-中2 "Empty-state cards are not done" 与代码矛盾**：AGENTS.md:20 声称空态五卡未做，但 vendor `ui-surfaces/EmptyState.tsx` 存在、`SurfacesRoot.tsx:350` 在无 surface 时渲染空态卡、且有专门测试断言。agent/开发者会基于错误前提决策。
- **D-中3 第二份 superpowers plan 无状态标记**：`2026-08-15-surfaces-workbench-depth.md` 无集成状态 blockquote（第一份有），完成度证据只存在于 vendor note。
- **D-低1** `dsh.js:571` npx 兜底文案"Node.js 18+"与 engines `^22.19.0||>=24` 不符。
- **D-低2 mobile/**：诚实标注"原生 App 还没做"，属薄 WebView 壳 + 手动粘贴配对 URL；app.json 配了 `dsh:` scheme 但无 Linking 代码、无二维码扫描。是半成品但文档说得清；建议补 roadmap 并把"扫码"表述改为"系统相机扫 URL，本 App 只负责打开"。
- **抽查属实的承诺**：MCP 写 `~/.dsh/mcp-servers.yaml`、技能写 `~/.dsh/skills`、市场只认 GitHub `dsh-plugin` 话题、工作区自动注册、API Key 经 `DEEPSEEK_API_KEY` 注入——均在代码中核实。

---

## 6. 测试与质量（本次实跑结果）

本地（Windows，git 2.55）：**259 tests / 256 pass / 2 fail / 1 skipped，exit 1**。

- 两个失败：`gitStatus reports isRepo false…`、`gitDiff returns null when the directory is not a git repository`（`git.test.js:40,87`）。
- **根因（已实证）**：本机 `C:\Users\48818\.git` 存在一个游离 git 仓库（2026-08-17 02:20 创建）。git 从临时目录向上发现它，把整个用户主目录当成仓库，`git status --porcelain` exit 0 返回空 → "非仓库"断言失败。
- 两个含义：① **本机环境需处理**——home 下的游离 `.git` 会污染主目录下一切 git 操作（不止本测试）；② **测试自身脆弱**——依赖"os.tmpdir() 不在仓库内"这一环境假设。建议测试里设 `GIT_CEILING_DIRECTORIES=<tmp根>` 或 `GIT_DIR=/dev/null` 隔离；应用侧的 git 探测同理可考虑 ceiling 语义，避免用户 home 有游离 `.git` 时误判工作区。
- macOS CI：57 fail（realpath 符号链接问题，见 B-高1），已实际炸掉 v0.2.1 发布。
- 覆盖缺口：vendor 侧仅 `test.yml` 的 `vendor-gui` job 覆盖，本地 `npm test` 不 gate vendor；渲染层（boot/marketplace/theme）无自动化测试；`DSH_SMOKE` 未接入。

---

## 7. 修复路线图（建议顺序）

**第零批（中继重新启用前，随该功能后续开发一并交付——当前冻结）**
0. 中继加认证握手、宿主通道与流量通道分离、强制 https、relay URL 未配置时禁用中继模式（即 §1.1 C-1 与 M-8 的中继部分）。

**第一批（P0，发布前置）**
1. `workspace-authority.js` 根与候选统一 realpath 化 + test.yml 加 macOS job（否则下次发布 mac 必再挂）。
2. `ipc.js:23` 停止下发 apiKey，改 `hasApiKey`。
3. 修两个本地测试的环境隔离（`GIT_CEILING_DIRECTORIES`），让本地 `npm test` 回绿。

**第二批（P1，0.2.2 目标）**
5. preload 按窗口角色拆分 + IPC senderFrame 校验（H-3）。
6. `install-plugin` 复用 `isValidGithubSpec`；`save-config` 字段白名单；`will-download` 净化（H-4/5/6）。
7. CSP 放行内联 style（或 insertCSS），修主题失效（R-1）。
8. release.yml 改"windows 必需、mac 软依赖"；DSH_SMOKE 接入门禁；release-notes 模板化 + tag 校验；pnpm 统一 11.8.0。
9. asar 排除 `**/*.test.js`；pnpm 降 devDependency。

**第三批（P2，常规打磨）**
10. 重建 vendor subtree 元数据或改显式 SHA 记录；npx 兜底 pin 版本。
11. 文档三处过期声明修正（平行色板、空态卡、版本锚定）；第二份 plan 补状态头。
12. M-7/M-8/M-9/M-11 与渲染层 P2/P3 清单逐项消化；清理 ~4GB 工作区垃圾；`.tmp` 入 .gitignore。

---

## 8. 总体评价

这个代码库呈现出清晰的"高工程质量 + 快速迭代留下的系统性缺口"双重面貌。做得最好的三块：**生命周期编排**（dsh.js 的单飞/代际守卫在 Electron 应用里属上乘）、**设计语言纪律**（平行色板清零、boot 例外零扩散、注入 chrome 全 token 化）、**本地安全基线**（沙箱/隔离/导航守卫/参数化子进程全套）。最危险的三块：**preload 信任模型**（把整机能力打包给一切回环内容，随插件生态扩大而放大）、**发布工程**（版本叙事三向矛盾、macOS 阻塞链、发布文案与产物脱节，已经连续两次翻车）、**冻结中的远程面**（中继零认证 + 明文——当前未启用不构成现实攻击面，但重新开发时须把认证与 TLS 作为设计输入，而非事后补丁）。修完 P0 三项后，这个项目就具备了重新发布 0.2.2 的基本条件。

---

## 9. 修复记录（2026-08-17，P0 三项已落地）

| 项 | 修复 | 文件 | 验证 |
|---|---|---|---|
| H-2 API Key 明文下发 | 删除 `configPayload` 对 `publicConfig` 掩码的覆盖；渲染层本就零处消费原始值，掩码 + `hasApiKey` 语义不变 | `src/main/ipc.js`（删 1 行） | 新增 `config.test.js` 回归：`publicConfig` 掩码 apiKey/githubToken、remoteToken 置空、只暴露布尔标记 |
| B-高1 realpath 根因 | `collectRoots` 对每个接受根做 `realpathSync` 归一（含去重键），与候选的 realpath 比较落在同一平面，修复 macOS `/var→/private/var` 及一切链接前缀下的全量拒绝 | `src/main/workspace-authority.js` | 新增回归：workspace 经目录链接（Windows junction / unix symlink）配置时 `resolveAuthorizedCwd` 接受真实子目录（修复前该用例必红） |
| T-1 测试环境隔离 | "非仓库"夹具改为封闭式：夹具内放无效 `.git` 文件阻断 git 向上发现，不受机器上游离仓库（如 `~/.git`）影响；产品代码的 `gitChildEnv` 刻意剥离 `GIT_CEILING_DIRECTORIES` 的语义保持不变 | `src/main/git.test.js` | 本地套件 261 测试 / 260 通过 / 0 失败 / 1 条件跳过，`npm test` exit 0 |

附带处理：修复过程中发现工作区 `package.json` 被外部操作误删（与主目录游离 `~/.git` 同一时段出现，亦是本次审查中首次 `npm test` ENOENT 的原因），已从 git 索引恢复，未引入其他变化。

后续批次（P1/P2）见 §7 路线图，尚未动工。

