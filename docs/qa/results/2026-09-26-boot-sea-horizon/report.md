# 启动页海平线画布落地验收 — 源码实例

- 日期：2026-09-26
- 对象：源码运行实例（`npm start` / `electron . --remote-debugging-port=9333`），文件 `src/renderer/boot.html` + `boot.css` + `boot-tokens.css` + `boot.js`
- 驱动：headless Edge（stub `window.shell` 快照注入）截 01–07；CDP 9333 + Playwright `connectOverCDP` 对真实主窗 boot renderer 截 08–09；探针读 `body[data-state]` / `data-harness-covered` / `#ticker-count` / `#logdrawer[hidden]`
- 穷举用例：48 条实机驱动用例（`.tmp-qa/qa-run.mjs` 驱动，结果 `cases.json` / 表 `test-cases.md`）——状态渲染 15 条、ticker/抽屉 13 条、动作路径 8 条、环境契约 7 条、审查回归 5 条
- 像素对比：`px-diff-dark.png` / `px-diff-light.png` + `pixel.json`——原型 `.win`（解除演示条与 max-width 后）↔ 生产 stub 页同视口 1440×920、reduced-motion 冻结下逐像素比

## 结论

海平线画布在源码实例全态成立：62% 交接线分开天空/深海，浅色天空有云团、深色读作深空（星云 + 银河带 + 双层星场），水线是干净的 1px 细线无辉光/反光带，水下调暗 + 表层透光 + 微粒 + 暗角无光束。「Whale Isle」衬线字标 + 周期扫光、副标「鲸屿 · DESKTOP」；启动态「启动中」+ 三点呼吸省略号；底缘单行 ticker 实时滚最新行并记 `L NN`，点击升起毛玻璃抽屉列全部行（带行号、上限 400 行）。异常/恢复态动作面按态出现（重试 / 取消自动重启 / 下载日志常驻，回启动器排查仅 settled error）。控制台 0 错误。

## 穷举用例结果

`test-cases.md` / `cases.json`：**48/48 通过**。覆盖：五状态文案与省略号、runtime 失败、恢复排程/重启中/耗尽/取消、skipUserPlugins 接管、插件进度与失败、未知态回退、ticker 最新行与计数、抽屉三种关闭路径与键盘开启、实时追加、重要行标红、400 行上限、非字符串与 XSS 注入兜底、四动作调用与失败回执、actionNotice 清理、明暗主题、壁纸 seed 免疫、harness 遮盖、最大化去圆角、窗控调用、shell 缺失降级、reduced-motion 冻结，以及审查回归（快照不截断/不重复、快照归并、空快照计数、抽屉层级、真指针窗控命中）。

## 像素对比（原型 ↔ 实现）

`pixel.json`：深色 diffPx=476（0.036%）、浅色 581（0.044%），阈值通道差 >24。差异全部可定位且属**生产 chrome 约定**，非视觉契约缩水：

- 窗控按钮 32×32（原型）→ 30×30（生产共用 `window-controls.css`）
- `.caption` 拖拽区 1320px（原型）→ 右让 120px 的全宽拖区（生产 drag 行为）
- 根字号 16→14px（生产壳基准；所有文案尺寸显式 px，渲染几何实测逐项 0 偏差：`.brand`/`.status`/`.horizon`/`.underwater`/`.abyss` 矩形全等）
- 星场/微粒伪元素亚像素取整差

视觉契约件（构图、水线、字标、省略号、ticker/抽屉形态、明暗自适应、reduced-motion）与原型一致。

## 对抗审查（3 份独立子代理报告）

`review-A-standards.md` / `review-B-adversarial.md` / `review-C-consistency.md`。合计发现 **3 major + 5 中 + 多项 minor/nit**，全部修复或记录：

| 发现 | 级 | 处置 |
|---|---|---|
| 快照重放把流式缓冲截回 ≤80 行、计数回跳（A-P1/B-1） | major | 主侧 `sendState` 先 `flushLogBatch` 再发快照（批与快照同序）；快照 `logs` 改发全量环形缓冲（封顶 400）；渲染侧重放改为后缀归并——共享前缀取更长侧、保留快照后的流式新行、分叉才重建。TC-43/44/45/48 钉死 |
| 批 flush 与快照重放二次送达 → 重复行（B-2） | major | 同上 flush-before-send 根除时序；TC-48 回归 |
| `.caption` 全宽 z9 压窗控 z5 → 三键死区（B-3） | major | `.caption` 改 `right:120px`（对齐原型/launcher 惯例）；TC-47 真指针命中回归（存量缺陷，非本批引入） |
| `.logdrawer` z6 吞窗控点击（A-P3） | minor | z-index 6→4；TC-46 钉死 |
| 取消失败提示被 250ms 倒计时覆盖（A-P2/B） | minor | 改走 `actionNotice` 持久通道；TC-30 |
| `startupErrorLabel` 死导出 + 文案漂移（A-P5/C-I2） | minor | 接线 error 分支并统一「桌面端启动失败」；断言更新 |
| `showLauncherBridge` recovery 各态无断言（C-I3） | minor | 补 scheduled/restarting→false、monitoring/exhausted/cancelled→true 五断言 |
| `exited?` 不命中 `exit code/with`（A-P6） | nit | `exit(?:ed)?\s+(?:with|code)` |
| `openLauncher {ok:false}` 静默（A-P7/B） | nit | 补 `result.ok===false` → actionNotice |
| `nextRetryAt` NaN 秒（A-P9/B） | nit | `Number.isFinite` 守卫 |
| 回退正则与 LOG_ERROR_PATTERN 漂移（A-P8） | nit | 补齐 plugin-tree 三模式 |
| 空 `logs:[]` 不刷计数 / `#log-count` 初始空（A-P9/B） | nit | `updateLogCount` 无条件调用 + 初始「0 行」 |
| `applyPluginBootCopy(failed)` failureEl 陈旧（B） | nit | 同步写 `failureEl` |
| 重复 `@import` / ease 字面量混用（A-P9） | nit | 删 @import、统一 `var(--ds-ease-in-out)` |
| `.stage` 死引用（A-P4/C-I1） | minor | design-language 双侧改 `.scene`；motion.md 启动页行动效清单重写 |
| 「四件动作直接出现」措辞（B/C-I5） | minor | 卡/design-language 改「动作集按态出现」；Do-not-touch 旧术语更新 |
| report.md 事实错误（B） | minor | 本轮修正：L 25→L 00/L 20 实数、`#log-count`/`#ticker-count` 字段名、`data-ds-dark-theme` 措辞、补 cases/pixel 引用 |

## 探针事实

`probe.json`（stub 七态）/`real-probe.json`（真机两态）记录每帧的 `data-state`、`data-harness-covered`、抽屉 `hidden`、日志计数（stub `count` 字段为 `#log-count`「N 行」、real `count` 为 `#ticker-count`「L NN」）：

- stub：`starting` → `status=启动中`、ticker `L 07`；`error` → `status=桌面端启动失败`、`L 10`；抽屉点击后 `hidden=false`（06/07）
- 真机：starting 时 `covered` 未置位、`L 00`；ready 后 `data-harness-covered` 置位、`L 20`——遮盖行为符合「被 BrowserView 覆盖时文档隐身」契约

## 记录项（非阻断 / 范围外遗留）

- `AGENTS.md` 与 `.cursor/rules/windows-installer-product.mdc`、`docs/handbook/blueprint.md`、`docs/qa/production-acceptance-test-cases.md` 仍有「仪器画布」旧措辞——卡外文件。其中 `production-acceptance-test-cases.md` 的 TC-INST-003 期望（状态章/常驻日志）按字面执行必失败且被 Gates 引用，是最有咬合力的遗留，建议尽快单独修订。
- `docs/prototypes/boot-page/`（旧三方向仪器画布原型）仍在仓且引用现网 `boot-tokens.css`，自述不随产品发布；建议标注归档或删除。
- `applyPluginBootCopy(failed)` 不展开动作面：依赖主进程随后推送 settled error 快照接管（遮盖态下正常不可见）；已补 `failureEl` 文案同步。
- 抽屉 `role="dialog"` 无 `aria-modal` 与焦点移入/归还；`.ticker` 内嵌 `role="button"` 在 `aria-live` 区中逐行播报；`.logdrawer-lines` 超长行横向滚动不折行（与原型一致）；`.core pointer-events:none` 文案不可选中（与原型一致）。
- 浅色主题下 `.stars::before/::after` 对 `background:none` 空层仍挂动画（推断性性能 nit，未实测）；`.underwater` z1 微压 `.horizon` 顶层 1px（装饰级）；CSP `img-src` 死配置；`theme.js` `watchTheme` 对 `onTheme` 同步抛错无 try/catch（共享文件，卡外）。
- `production-acceptance-test-cases.md` 的 TC-INST-003、`prototypes/boot-page/`、`theme.js`、`.core pointer-events` 等属卡外或原型契约件，本批按 Allowed touch 纪律处理如上；`design-language.md L63`、`docs/motion.md` 启动页行为审查发现的事实错误已一并修正（设计文档列与动效清单，超出「启动页段」字面范围一处，随批披露）。

## 关联

- 决策记录：`docs/decisions/implemented/product/2026-09-26-boot-sea-horizon-scene.md`（supersede 已归档的仪器画布与双页制两篇）
- 定稿原型：`docs/superpowers/prototypes/boot-redesign-b2-horizon.html`
- 契约测试：`src/renderer/boot-recovery.test.js`（8，含本轮新增 bridge recovery 态断言）、`src/main/window-harness-cover.test.js`（13）、`src/main/boot-log-dump.test.js`（5）、`src/main/harness-controller.test.js`（52）——相关 78 全绿；全量 `npm test` 2528/0/2
