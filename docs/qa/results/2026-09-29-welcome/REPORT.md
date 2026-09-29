# 首次安装欢迎页修复

日期：2026-09-29。原候选 `b061501e5b45e09e529e5bd31ccd6647b0af0299` / run `36460702057` 的欢迎页呈现有缺陷，撤回推荐，未正式发布。

用户已授权恢复候选构建并干净重装：清除应用聊天、设置与缓存，保留源码和工作区文件。不正式发布；新候选已安装。代理启动验证曾失败，随后用户手动启动确认已进入桌面，详见下述记录。

## 干净重装进度（2026-09-29）

- 新候选 SHA：`105172b0299d3441817e7a1567276b8d1a0eb38e`；Desktop tests `36511572739` 全部成功，Windows build `36511573586` 成功，打包启动冒烟通过。未运行 `publish.yml`。
- CI artifact `11009432521`，归档 SHA256 `96157ebd36167d10eb50e0566e732c86f663a0d80f7621d88355d4abea723f6d` 与下载文件一致。
- 安装包 `.tmp/ci-candidate-36511573586/Whale-Isle-Setup-0.3.3.exe`，593073356 字节，SHA256 `f351a3b89770b1596e4dc52c5ce1364c7219a58681f3d905fba2bdea3f797bf3`；共享发布资产校验器通过。
- 旧版 `C:\软件\Whale Isle` 已通过注册的卸载器 `/allusers /S` 卸载（退出码 0），应用可执行文件和卸载注册记录均已消失；没有强制结束桌面应用。
- 清理历史：删除命令曾被执行环境安全策略拒绝，代理未执行删除，也未改用其它方式绕过。用户再次要求继续后，只读核实以下四个目录均已不存在，才开始重装：`%APPDATA%\Deepseek-Harness-Desktop`、`%APPDATA%\Deepseek-Harness-Launcher`、`%APPDATA%\Whale Isle Launcher`、`%LOCALAPPDATA%\deepseek-harness-desktop-updater`。未改动源码、外部工作区及无关软件目录。
- 新版以 `/S /allusers /D=C:\软件\Whale Isle` 安装，退出码 0，EXE 版本 `0.3.3.0`。安装后的 `app.asar` 内 `src/main/index.js`、`src/preload/index.js`、`src/renderer/boot.css` 与候选源码一致（仅归一化换行）。首次启动前再次确认主 userData 不存在；未导入旧内容、登录账号或创建测试会话。
- **本机首次启动未通过，不可据 CI 绿灯晋级：** 启动先停在启动器导入页，显示可导入技能 2 项、会话 0 项；`probeImportHold` 将全局 `.agents/skills` 计入来源，即使 `~/.dsh` 不存在也会阻止自动启动。未执行导入，从首页点击启动桌面端后进入启动失败页面。
- 启动失败证据：新生成的 `last-desktop-start.json` 于 `2026-09-29T03:26:04.097Z` 记录 19 个桌面组件无法解析。只读调用 `missingDesktopForkPackages` 在本机解压运行时稳定复现。组件目标目录及 package.json 实际存在，manifest 中链接也存在，但通过这些 junction 的 `stat` / `realpath` / 目录读取返回 ENOENT；系统 Node 26 与随包 Node 22 结果一致。工作区内创建的独立 junction 可访问相同目标。原因尚未确认，不能断言包内文件缺失，也未修改 ACL 或安全设置、未手工修补已安装运行时。
- 使用受保护的 peer `stop-desktop` 正常退出（`ok: true, quit: true`，进程已退出），没有强制结束。随后用户手动启动并明确反馈「进去了」，同时报告 boot 到桌面的短暂闪烁。此反馈确认桌面可进入，但不能单独证明无首次设置引导、普通退出及完整生产验收通过；代理启动的 junction 差异仍保留为未解释的环境限制。

## 复现与修复

后续用户调整入口要求：启动不再显示原版欢迎窗，直接进入桌面工作区。下述资源修复是历史诊断证据，不再代表当前启动路径；当前决策见[桌面直接进入工作区](../../../decisions/implemented/product/2026-09-29-direct-desktop-entry.md)。

真实安装路径 `C:\软件\Whale Isle\resources\app.asar` 加载两张编译样式成功，但缺独立页面 CSS、window-material.css 与品牌 SVG。窗口正文保留浏览器 8px margin、root 高度约 178px，品牌图 naturalWidth=0，与用户截图一致。中文和空格路径不是原因。

原样补入上游三个资源，HTML 补布局引用。渲染回归在原包失败、修复源码通过；中英文/明暗、按钮实际命中与 API Key/稍后设置通过；移除布局或破坏品牌图片会阻断同一门禁。打包冒烟调用该验证后才能点过欢迎页。

## 当前证据

- `.omc/welcome-installed-probe.json`：原包 CSS 已加载、图片损坏、布局缺失。
- `.omc/welcome-installed-red.log`：对已安装 app.asar 的确定性失败。
- `.omc/welcome-regression-green.log`：源码真实 Electron 四组合及故障注入通过。
- 相关定向测试 8/8 通过。替换候选的 CI、哈希与安装后验证待记录，未据此宣称完整生产验收通过。
- 用户要求先修改界面，构建 `36503705620` 已取消；不生成新安装包，待用户恢复打包。

## 直接进入工作区验证

- `welcome-entry.test.js` 覆盖主入口不等凭据、退出/过期不回流、登录授权链接外开及后台初始化去重；smoke 检测到欢迎窗直接失败。相关定向测试 12/12。
- `.omc/release-complete-source.log` / `.result.json`：隔离无凭据源码启动通过，工作区、桥接边界、PTY 与标题栏命中正常，无 pageErrors。
- `.omc/release-complete-desktop22.log` / `.result.json`：全量 2779 通过、2 跳过、0 失败。未构建或更新已安装包。

## 首次设置引导移除

- preload 设置 `dshDesktop.onboarding: false`；账号插件不创建引导 controller/overlay，不写完成标记，普通设置和登录注册不变。缺省壳保持原行为。
- 账号 apply 测试 27/27（含首次与插件重载、不写设置）；preload/smoke 定向 27/27。`.omc/no-onboarding-build.log`：官方客户端重建通过。
- `.omc/release-complete-source.log` / `.result.json` 于 2026-09-29T01:02:32Z 再次验证全新配置启动通过；已移除所有自动点击引导继续/跳过的测试逻辑。以上全量桌面结果属于前一轮入口修复，本轮使用定向回归和重建后的真实冒烟。安装包仍暂停。
