# 首次安装欢迎页修复

日期：2026-09-29。原候选 `b061501e5b45e09e529e5bd31ccd6647b0af0299` / run `36460702057` 的欢迎页呈现有缺陷，撤回推荐，未正式发布。

## 复现与修复

真实安装路径 `C:\软件\Whale Isle\resources\app.asar` 加载两张编译样式成功，但缺独立页面 CSS、window-material.css 与品牌 SVG。窗口正文保留浏览器 8px margin、root 高度约 178px，品牌图 naturalWidth=0，与用户截图一致。中文和空格路径不是原因。

原样补入上游三个资源，HTML 补布局引用。渲染回归在原包失败、修复源码通过；中英文/明暗、按钮实际命中与 API Key/稍后设置通过；移除布局或破坏品牌图片会阻断同一门禁。打包冒烟调用该验证后才能点过欢迎页。

## 当前证据

- `.omc/welcome-probe-result.json`：原包 CSS 已加载、图片损坏、布局缺失。
- `.omc/welcome-installed-red.log`：对已安装 app.asar 的确定性失败。
- `.omc/welcome-regression-green.log`：源码真实 Electron 四组合及故障注入通过。
- 相关定向测试 8/8 通过。替换候选的 CI、哈希与安装后验证待记录，未据此宣称完整生产验收通过。
