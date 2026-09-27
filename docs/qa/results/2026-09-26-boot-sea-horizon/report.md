# 启动页海平线画布落地验收 — 源码实例

- 日期：2026-09-26
- 对象：源码运行实例（`npm start` / `electron . --remote-debugging-port=9333`），文件 `src/renderer/boot.html` + `boot.css` + `boot-tokens.css` + `boot.js`
- 驱动：headless Edge（stub `window.shell` 快照注入）截 01–07；CDP 9333 + Playwright `connectOverCDP` 对真实主窗 boot renderer 截 08–09；探针读 `body[data-state]` / `data-harness-covered` / `#ticker-count` / `#logdrawer[hidden]`
- 覆盖：明/暗 × 启动中/异常、640 短窗、日志抽屉开合、真机 starting 与 covered 两态

## 结论

海平线画布在源码实例全态成立：62% 交接线分开天空/深海，浅色天空有云团、深色读作深空（星云 + 银河带 + 双层星场），水线是干净的 1px 细线无辉光/反光带，水下调暗 + 表层透光 + 微粒 + 暗角无光束。「Whale Isle」衬线字标 + 周期扫光、副标「鲸屿 · DESKTOP」；启动态「启动中」+ 三点呼吸省略号；底缘单行 ticker 实时滚最新行并记 `L NN`，点击升起毛玻璃抽屉列全部行。异常态四件动作（重试 / 取消自动重启 / 回启动器排查 / 下载日志）直接出现在场景中央。控制台 0 错误。

## 探针事实

`probe.json`（stub 七态）/`real-probe.json`（真机两态）记录每帧的 `data-state`、`data-harness-covered`、抽屉 `hidden`、ticker 计数：

- stub：`starting` → `status=启动中`、ticker=`L 7`；`error` → `status=桌面端启动失败`、`L 10`；抽屉点击后 `hidden=false`（06/07）
- 真机：starting 时 `covered` 未置位、ticker 实计 `L 25`；ready 后 `data-harness-covered` 置位（08 有画面、09 文档按契约隐藏为空白）——遮盖行为符合「被 BrowserView 覆盖时文档隐身」的既有契约

## 记录项（非阻断）

- `AGENTS.md` 与 `.cursor/rules/windows-installer-product.mdc`、`docs/handbook/blueprint.md`、`docs/qa/production-acceptance-test-cases.md` 中仍有「instrument canvas / 仪器画布」旧措辞——属卡外文件，本批按 Allowed touch 纪律未动，待后续统一修正
- 抽屉在 `ready` 态不可点开是预期：covered 契约下文档整体 `visibility:hidden`，此时启动画面本身不再可见
- 深色真机态未单独实拍（用户主题为浅色）；深色已由 stub 01/02 覆盖，色表经 `data-boot-theme` 切换无分支差异

## 关联

- 决策记录：`docs/decisions/implemented/product/2026-09-26-boot-sea-horizon-scene.md`（supersede 已归档的仪器画布与双页制两篇）
- 定稿原型：`docs/superpowers/prototypes/boot-redesign-b2-horizon.html`
- 契约测试：`src/renderer/boot-recovery.test.js`、`src/main/window-harness-cover.test.js`
