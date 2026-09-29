# 远程工作区选择器布局回归

日期：2026-09-29。范围：`remote-workspace`。对象为源码组件和桌面插件 bundle，不是安装包验收；远程响应使用 fixture，真实 SSH 未运行。

## 修复与证据

原远程 pane 直接铺到无 padding 的弹窗内，缺少独立内容区及底栏；无机器分支直接返回空态，所有远程状态都没有取消按钮。本机专属 Home 消失后，标题行的 space-between 将页签推到右侧。修复前 Chromium 检查在错误、空机器和正常目录的九个组合中均因缺少 Cancel 失败。

远程内容现在保留与本机一致的留白，内容滚动与底栏分开。标题使用稳定列布局，底栏按钮在窄窗可换行。机器加载、目录读取及切换机器失败均可重试；切换机器失败不会继续列出旧机器。新增错误文案进入中英字典。

`probe.cjs` 编译真实 `DirectoryBrowser`、`RemoteFlowPane`、ui-primitives 和主题样式，在 Electron Chromium 中测量边界并操作按钮。只替换机器/目录 IO，不连接 SSH，不修改用户工作区。复跑会把构建、截图及结果写入忽略的 `generated/`。

## 检查结果

- Chromium：18/18 几何组合通过。机器加载失败、无机器、正常列表、加载中、目录失败、机器切换失败，各覆盖 810×560 浅色、810×560 深色、390×360 浅色。断言页签不跳动、内容留白、取消可见、底栏不越界、实际深色主题生效。
- 交互通过：三类失败的重试恢复目录；本机/远程往返不重新拉取、不丢路径；六种状态均可取消；机器切换失败不请求目录。
- `node --test src/main/dsh-remote-client.test.js src/main/dsh-remote-desktop.test.js src/shared/harness-desktop-forks.test.js`：29/29。
- Harness `node node_modules/vitest/vitest.mjs run packages/client/ui-directory-picker-browse/tests`：97/97。
- `node scripts/prepare-dsh-remote-client.mjs --force`：成功；中途一次 Windows 文件写入临时错误，重试成功。
- `npm start`：official host/client/web 全量构建通过，记录 374 个 client artifacts，prestart ready；启动 Electron 时安装版持有相同 appId 单实例锁，因此源码版未接管正在运行的安装版。
- `DSH_SMOKE_KEEP=1 node scripts/run-source-smoke.mjs`：隔离源码应用启动、远程插件装配、Web UI 和 PTY 回显成功，页面错误数组为空；整机冒烟未通过，停在未修改的右侧栏展开命中检查（`surfacesCollapsed=true rightbarWidth=0`）。隔离证据保留在本机临时目录 `dsh-source-smoke-u5ykok`，未覆盖或退出安装版。
- `npm run check:governance`：6/6；本次修改的远程决策、picker README 翻译配对检查通过。
- `npm test`：2809 通过、1 失败、2 跳过。失败是未修改的 `desktop-live2d.test.js:514`，在并行构建负载下等待重试次数得到 7 而非 8；单独重跑该用例通过，未改动相关源码或测试。
- `npm run doc-sync`：最后一次运行 7/8，通过翻译配对和链接检查，设计文档仍为 14497 字、超过 14400 上限。压缩本次新增说明后的较早检查为 14515 字，移除本次说明仍有 14463 字；保留并行工作内容，没有放宽门禁。
- Harness `verify-client-ui-i18n`：未通过，29 个报告项均位于本次未修改的其他组件（品牌、Git、主题、终端等）；本次插件中英字典键一致性测试通过。

## 复跑

在仓库根目录使用 PowerShell，清除当前进程的 `ELECTRON_RUN_AS_NODE`，通过 `Start-Process -Wait -PassThru` 运行 `node_modules/electron/dist/electron.exe docs/qa/results/2026-09-29-remote-picker/probe.cjs`。检查进程退出码及 `generated/results.json`；成功时该文件为空数组。源码应用通过 `npm start` 的 official 构建流程重启，进程启动情况需与构建日志一同确认。
