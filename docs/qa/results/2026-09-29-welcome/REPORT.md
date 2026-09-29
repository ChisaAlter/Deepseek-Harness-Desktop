# 首次安装欢迎页修复

日期：2026-09-29。原候选 `b061501e5b45e09e529e5bd31ccd6647b0af0299` / run `36460702057` 的欢迎页呈现有缺陷，撤回推荐，未正式发布。

用户已授权恢复候选构建并干净重装：清除应用聊天、设置与缓存，保留源码和工作区文件。不正式发布；新候选 SHA、CI、资产摘要及实际安装结果待补。

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
