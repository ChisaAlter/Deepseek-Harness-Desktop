# 证据账本（Q / K / O / D / C 矩阵）

计划 §4.2.4。每条只允许：源码证据 / 测试通过输出 / Setup 文件证据 / 实机路径证据；**能力真实可用**。未跑即 `not-run`，不得写「已实现」。

| # | 检查项 | 证据位置 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| Q-1 | 退出/停止/重启前有 Host 任务时提示并取消 | `src/main/task-protection.test.js`（prompt/cancel/commit 序列）；实机确认待 C | partial | 协调器已实现并接入 quit/restart/stop/close/peer；单测覆盖确认与取消路径 |
| Q-2 | 锁定期新请求/新 Task 被拒并回提示 | `src/main/task-control-plugin.test.js`（route 503、upgrade destroy、resolveAgent/jobs.start 拒绝） | partial | webServer 包裹 + `connection/request` 瀑布二闸；实机 HTTP 探测待 C |
| Q-3 | inspect→acquire→drain→inspect 无回归 | `src/main/task-protection.test.js`（drain-timeout fail-closed、复查再确认、commit 异常 release） | partial | pending drain + 代次复查 + TTL 惰性过期已实现 |
| Q-4 | 锁中 Schedule/Bots 保留 due 状态 | 实现：`resolveAgent` 拒绝保留 armed 态 + unlock `requestDrive`；单测覆盖拒绝语义 | partial | 真实到期投递恢复待 C 验收 |
| Q-5 | 无活动任务时干净退出 | `src/main/task-protection.test.js`（clean 直走、hostDown 直走） | partial | 实机延迟测量待 C |
| Q-6 | 更新无活动任务但有 Schedule 任务时先提示 | `task-control-plugin.test.js`（scheduledWork 汇聚）+ `update.js` beforeInstall/coordinate 序列 | partial | 安装器拉起前协调已实现（含 updater 通道）；实机待 C |
| K-1 | 快捷键搜索/修改/重置即时生效 | `src/main/shortcuts.test.js`（edit 落盘 + acceleratorFor 更新 + unbound 无键帽；revision stale 拒绝）；实机 `c-phase/k-shortcuts-row-visible.png`、`c-phase/k-shortcuts-panel.png` | partial | 真机：设置→通用设置→快捷键行→编辑快捷键打开 ShortcutReference 面板，搜索框+官方默认绑定表+「恢复全部默认」在位；修改/重置即时生效与重启持久化未在真机操作 |
| K-2 | 本地优先于页面输入竞争 | `policy.ts` `localFirstProtected` + registry 分支；`shortcuts.test.js`（bound chord 压菜单、overlay 吞输入） | partial | 终端/编辑区实机竞争待验收 |
| K-3 | 冲突显示原绑定；重置后官方默认 | 上游 `effectiveShortcuts`/`overlappingBindings` 未改语义；defaults=官方表；实机 `c-phase/k-shortcuts-panel.png`（默认绑定表+「恢复全部默认」可见） | partial | 面板可达、官方默认绑定表与重置入口真机可见；冲突显示与重置回落未真机触发 |
| K-4 | 旧用户无快捷键迁移自动升级 | `shortcuts.test.js`（无文件→官方默认、web localStorage 一次性迁移+回执、不覆盖既有文件、非法 web 载荷忽略） | partial | 真机首启路径待 C |
| O-1 | DOCX/PPTX 生成、修改、结构校验 | bundled python-docx 生成 DOCX → 打包 Node + kit CLI `convert` → 真实 31KB PDF（backend=native）；损坏输入返回结构化 `invalid-document` 且不写输出 | partial | 引擎层已验；经宿主插件的 in-app 定点编辑/生成待实机 |
| O-2 | 无 LibreOffice 时不系统回退 | `capabilities --json` 报 `backend:"native"`，本机无系统 LibreOffice 仍完成 convert/render/recalculate | pass（引擎层） | kit 自含原生引擎，全程不触 PATH/系统 Office |
| O-3 | XLSX recalc 写入新文件 | openpyxl 造含 `=A1+A2`/`=SUM(A1:A2)*2` 的 xlsx → `recalculate --output` 新文件读回 42/84 正确，源文件缓存值不变 | pass（引擎层） | 写入新文件、不覆盖原文件 |
| O-4 | Files 面板 DOCX/PPTX 只读 PDF 预览 | `desktop-files.ts` 对 doc/docx/ppt/pptx 拒认领 + `apply.ts` openOfficeDocument 移交 sidebarRight（spec 2 例）；documentpreview `office-registration`/`office-cache` vitest 53 例全绿；真实 `dsh web` 已带 `desktop-office.patch.yml` 启动且端口在线 | partial | 路由+激活链路已验；DOCX→PDF 真实渲染待 O-1 依赖的实机验收 |
| O-5 | Files 面板 XLSX SheetJS 预览 | 同上（xls/xlsx→text fallback→excel renderer）；`excel-registration`/`excel-convert` vitest 13 例全绿 | partial | csv/tsv 有意留可编辑文本视图（决策记录 §Consequences） |
| O-6 | CLI 支持指定 range + PDF 导出 | `render --pages 1 --dpi 96` 产出真实 816×1056 PNG + manifest.json（schemaVersion/sourceSha256/missingFonts 字段齐）；`convert` DOCX→PDF 成功 | partial | sheet/range 出图与 PPTX 页选仍待实测 |
| O-7 | 预览无 symlink 逃逸；越权拒绝 | not-run | 待 P3 | realpath+根校验+generation 弃缓存 |
| O-8 | 多格式同时开不互相替换 | not-run | 待 P3 | generation/取消隔离 |
| D-1 | ui-deliverables / ui-diff 共用同一呈现组件 | `ui-primitives/src/ReviewDiff.tsx`；消费方 `ui-diff/src/client/DiffPanel.tsx` + `ui-deliverables/src/client/FileDiff.tsx` | pass | 无跨 feature 直引；两侧仅传纯数据/回调；聚焦测试 55/55 |
| D-2 | 新增/删除/重命名/换行符正确着色 | `review-diff.client.spec.tsx`（eof/截断/note 渲染）；`benchmarks/review-diff` 8 场景实测 binary/renamed/truncated/omitted note kind 全部落 DOM | pass | 末行无换行 eof 行、binary 标记、pure-add/del 各有用例与 fixture |
| D-3 | split/unified 切换不丢选择/滚动语义 | spec 覆盖 split/unified/wrap 双路渲染；bench 每样本 20 次模式切换 `switchStable` 全稳定；实机 `c-phase/c1-evidence.json`（split/wrap 节）+ `c-phase/c1-review-tab-*.png` | pass | 真机 split 切换后 selection 文本保留（selectionAfterToggle=`export const c1 = "acceptance"`）；纯新增对比按设计保持 unified；单行 diff 无滚动位移可测，滚动稳定性由 bench 覆盖 |
| D-4 | 大文件不阻塞主线程；初次 tokenize <50ms | `benchmarks/review-diff`：8 场景 × 5 样本，主线程高亮 slice max 10.2 ms、0 违规；`dsh.reviewDiff.worker` mark 证实 tokenize 在 worker（6000 行侧 ~200 ms off-thread）；首 tokenize 原子调用经 worker 而非 timer 挪移 | pass | 无 Worker 环境回退 15 ms 内联分片；超长行跳高亮纯文本先可读 |
| D-5 | 单行复制不含行号 | `ui-primitives/src/ReviewDiff.module.css`：`.number`/`.sign` `user-select:none`（源码）；实机 `c-phase/c1-evidence.json` `d5` 节 | pass | 真机 `getSelection().toString()`=`export const c1 = "acceptance"` 仅代码文本、无行号/增删号（containsNumber=false，行内 number/sign 文本为空） |
| C-1 | 关闭「更改前查看变更」不出现快照文件 | `c-phase/c1-evidence.json` + `c-phase/stage2.json`（off 态 cardFound:false）+ 截图 `c-card-appeared.png`、`c1-review-tab-*.png`；实现 `ui-deliverables/src/client/Deliverables.tsx`（`announced` 经 `developerTools.enabled` 门控）+ `ReviewTab.tsx` + `workspace-changes/src/recorder.ts` | partial | 前提开关实为 设置→通用设置→代码工作工具：off 态卡片不渲染（符合"关闭不出现"语义）；on 后真实模型轮写 `c1-probe.ts` → `workspace/changes` seq 84 → summary 1 file +1/-0 → 点行开右栏「第 1 轮改动」，split/wrap 在位、高亮经 worker（workerMarks=1，slice max 0.2ms）；「Host 重启不留快照」未验（不重启用户 Host） |
| C-2 | 关联应用打开既有插件/技能 | not-run | 待 C | C2 |
| C-3 | 显式开启 Schedule：到期自动触发、重启重排、历史读写 | not-run | 待 C | C3；不静默启用 |
| C-4 | 进行中的会话即时刷新可用工具 | not-run | 待 C | C4 |
| C-5 | 可选 auto-review 手动确认继续 | not-run | 待 C | C5 |
| C-6 | 任意时刻仅一个右侧面板 | not-run | 待 C | C6 |
| C-7 | 远程/身份不可用不降 UI 可理解性 | not-run | 待 C | C7 |
| C-8 | 正常/跳过用户插件/正常升级路径不衰减 | not-run | 待 C | C8 |

## 构建/安装证据（§4.2.5）

| 证据类 | 位置 | 状态 |
| --- | --- | --- |
| 源码运行证据 | `p0-baseline.md`（npm test 基线） | 已记录（6 项既有失败） |
| 打包产物（dist 目录树摘要） | not-run | 待最终验收 |
| 安装后实体（exe/资源目录列表） | not-run | 待最终验收 |
| 手动升级与回滚 drill | not-run | 待最终验收 |
| 已知缺陷表（真机暴露但修复推迟项） | 待记录 | 随最终验收维护 |

## 门禁复跑记录

- 2026-09-25 `npm run check:governance` → 6/6 passed（decision-tree / decision-format / archived / feature-cards / rules-sync / remote flag guard）
- 2026-09-25 `npm run doc-sync` → 8/8 passed（含 verify-feature-cards、verify-doc-budgets、verify-translation-pairing）
- 2026-09-25 `node --test`（P1 受影响面 + 全量）→ 352 passed / 0 failed；task-protection 协调器 + dsh-task-control 插件定向测试 20 例全过
- 2026-09-25 P2：`node --test src/main/shortcuts.test.js` → 11/11；`npm test` 全量 → 2460 pass / 6 fail（全部为 p0-baseline 记录的既有失败：dshbot-client ×4、ui-agents-panel 版本、ImageLightbox 路径）；vendored 包 `tsc -b` + tsdown 重打包通过；决策记录 `2026-09-25-local-first-shortcut-bridge`；`doc-sync` 8/8、`check:governance` 6/6 复跑通过
- 2026-09-25 P3（实施轮）：`office-runtime.test.js` 13/13；`harness-controller.test.js` 47/47（+3 Office 用例）；`dsh.test.js`/skip-compose 契约全过；`ui-files`/`ui-surfaces` vitest 32/32（新增 Office 拒认领/移交用例）；fork markers +3；dev 解析链实测 skill-office→kit@0.1.1→win32-x64 引擎（exe+prebuilds 在位）通过；决策记录 `2026-09-25-desktop-office-runtime`（zh/en）。win-x64 payload（primary-runtime/office-skills）生成进行中，O-1~O-3/O-6~O-8 待实机验收
- 2026-09-25 P3（payload+实机轮）：`npm run prepare:office-runtime -- --smoke` 全过——node 24.21.0 / python 3.12.14 / pnpm 11.7.0，win32-x64，payloadDigest `a7dddb0d…14e`，python-docx 1.2.0 / python-pptx 1.0.2 / openpyxl 3.1.5 等 13 个锁版包就位，document round-trips + `pip check` 通过，`build/office-runtime/evidence.json` 落盘；payload 体积 primary-runtime 287 MB / office-skills 1 MB。真实 `npm start` 后 `dsh web` 子进程以 `--patch desktop-office.patch.yml` 启动（第 3 位，契约序），127.0.0.1:3080 在线；`--dump-config` 证实两行 insert（source/root/assetRoot/node/cli 全显式）被 CLI 接受。documentpreview 侧 `office-registration`/`office-cache`/`excel-registration`/`excel-convert` vitest 共 66 例 + ui-surfaces/ui-files 41 例全绿。`extraResources` 的 office 项下沉 `win.extraResources`（mac 包不再夹带 win-x64 payload）。O-1~O-3/O-6~O-9/O-12 实机矩阵仍待验收
- 2026-09-25 P3（打包轮）：`npm run pack` 全绿——afterPack 302.4s、运行时归档 2241.3MB、签名完成。打包期依赖修复五连：`resolvePackageFrom` 先 realpath importer（semver 7.7.4/7.8.5 双版本共存正确性）；内容相同的 pnpm peer 变体允许共享 target（send@1.2.1 vs +sc）；共享源实例收拢到公共祖先（cross-spawn、@smithy/* ×9、path-expression-matcher 等），收拢前置 `graphMatches`+遮蔽检查防震荡，槽位被异版本占据或依赖图变化时判强制重复保留副本；公共祖先已是 `node_modules` 时不再叠加层级；孤儿副本仅零解析者时清理。Office 闭包：`libreoffice-kit@0.0.1` 与 `win32-x64@0.1.1` 顶层孤儿清理（零解析者），assert 锚点改为与 `resolveOfficeKit` 一致的 skill-office 解析链 → kit@0.1.1 + 引擎 181.7MB 通过；skip/full 契约双轮通过
- 2026-09-25 P3（打包态实机轮）：win-unpacked `Whale Isle.exe` 启动——修复 `shortcuts.js` 引用 vendored lib（打进 tar 不可达）致 `ERR_MODULE_NOT_FOUND`，协议快照内联为 `src/main/shortcuts-protocol.mjs`（asar 侧，assertNever/randomUUID 就地等价实现），11/11 单测复过；打包版 6 进程在线、127.0.0.1:3080 → HTTP 401；`desktop-office.patch.yml` 打包态重新生成，`cli` 指向解包树 `runtime/0.3.3/node_modules/@deepseek-ai/node_modules/.../libreoffice-kit/lib/cli.js`（kit@0.1.1），引擎 exe 在位，顶层 0.0.1 孤儿已不入包。O-4/O-5 链路、O-7~O-12 的 in-app 交互项归 C 验收
- 2026-09-26 P4：共享 Diff `ReviewDiff` 抽至 `ui-primitives`（ui-deliverables/ui-diff 双适配，无跨 feature 直引）；语法高亮经 `highlight-engine` + `highlight.worker`（?raw 内嵌 iife，607KB/91KB gzip 懒 chunk）+ `highlight-jobs` 协议（ready/job/missing→langs→repost/drop）上 Worker；无 Worker 回退 15ms 内联分片。`benchmarks/review-diff`（scaffold 驱动 apps/web 正式组合，`window.shell` 桩喂确定性 fixture）8 场景 × 5 样本全绿：主线程高亮 slice max 10.2 ms <50 ms、0 违规；worker 完成数按场景断言（single-6000 200 jobs、files-100x200 100 jobs、binary 0 jobs 符合预期）。Node worker_threads 冒烟验证协议（握手/TS tokenize/missing 注册/drop 抑制）。受影响定向测试 55/55（review-diff + review-tab）；全量 client 1553 pass / 7 fail（5 例 modal-layer 焦点计时为既有基线失败，diff 侧已无超时）。cold/warm readable 与 input 候选预算按候选口径上报未断言。决策记录 `2026-09-26-review-diff-highlight-worker`；bench 归口 Agent Note `testing/2026-09-26-review-diff-performance-gate`（含边界/校准/排除项），`verify-agent-note-format`/`verify-agent-note-classification` 对本 note 无违规（存量 26 例 grandfather 格式违例为既有基线）。`check:governance` 6/6、`doc-sync` 8/8 复跑通过

- 2026-09-26 C 轮（源码应用实机验收）：源码启动（full 模式， 子进程 argv 证实 8 个 desktop overlay 全挂：task-control/install/office/usage-panel/session-search/dsh-im/dsh-market/dsh-remote）；真实模型轮（grok-4.7）经页面内目录浏览器添加隔离工作区后写 c1-probe.ts → Host recorder 发 `workspace/changes` seq 84 → summary API 1 file +1/-0；设置→通用设置→代码工作工具 off 时卡片不渲染（符合关闭语义）、on 后卡片→右栏 changes-review tab 打开成功，split/wrap 在位、高亮走 worker（workerMarks=1、主线程 slice 0.2ms）；真机选择保留（split 切换后 selection 不丢）、复制串不含行号；Diff 工作面（ui-diff 业务路径）同挂共享 ReviewDiff 并高亮，工作区/暂存 scope 与暂存/还原操作在位；快捷键面板经 通用设置→快捷键行 打开，搜索+官方默认表+恢复默认在位。验收后已移除测试工作区条目并恢复 代码工作工具=off。C-2/C-5/C-7 与 C-8 升级演练、Q 实机项仍待手动验收
