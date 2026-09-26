# 鲸屿按需吸收上游能力：官方候选与接入前提

日期：2026-09-25。约束：继续维护鲸屿现有架构、外观、背景特效和动效，只评估可以独立接入的能力。已比对官方一手源码与鲸屿当前工作树的装配、路由和壳接口。未安装官方应用，也未执行本轮 UI 实机验收；“已有”指源码与装配可确认，不代表安装包体验已经验收。未读取用户 profile，模板默认值不代表用户当前配置。

## 最新基线

- 本轮重新请求 GitHub API：`master` 仍为 `477b4f420553e8a52c2fbccc464d7561b239c443`，提交时间 2026-09-24 13:39:59 UTC，**与鲸屿的 vendor pin 完全相同**。不存在一个尚未拉取的更新 master 可直接升级。[提交](https://github.com/deepseek-ai/deepseek-harness/commit/477b4f420553e8a52c2fbccc464d7561b239c443)、[本地 pin](../../vendor/harness-upstream.json)
- API 返回最新 release 为 `dsh-v0.1.7-rc.2`，发布时间 2026-09-24 14:10:21 UTC（北京时间 22:10），标记为 prerelease；前一版为 9 月 23 日的 rc.1，再前为 9 月 22 日的 alpha.2/alpha.1。本报告不把预发布写成稳定版。[rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)、[发布 API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=5)
- rc.1 已汇总逐轮审阅、Office 预览、关联应用打开、侧栏终端和浏览器；rc.2 新增/强化定时任务管理、快捷键自定义、退出影响确认等。**先核对已随 vendor 进入的共享能力，再补当前壳缺失的装配或桥接**，不把 release notes 全部列为待移植。[rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)、[rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)

## 官方装配在哪里分叉

官方通用 Web composition 已装配 `shortcuts`、`ui-shortcuts`、`schedule`、`ui-schedule`、`office-to-pdf`、`open-in-app`、`ui-open-in-app`、`workspace-changes` 和 `ui-deliverables`；这些包在 vendor 中存在，不代表每条鲸屿界面入口都已接好。[固定 SHA 的 Web composition](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/web-app/cordis.patch.yml)

官方 Desktop 则额外由 `apps/desktop-host/src/index.ts` 安装退出任务检查，并挂载 `desktopOffice`；`office.ts` 再挂载依赖工具与 Office 技能。这些不是启动普通 `dsh web` 就自动得到的能力。主进程另接原生快捷键，并把主窗口与 Browser guests 都挂到适配器。[Desktop Host](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/index.ts)、[Office 装配](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/office.ts)、[原生快捷键](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/keyboard.ts)

## 候选一：退出与更新时的任务保护

**用户收益：** 从托盘/菜单退出或重启时，明确告知会中断哪些类别的工作，避免只关闭窗口与真正退出的语义混淆。可保留鲸屿现有窗体与确认样式。

**可取最小单元：** `desktop-host/src/update-tasks.ts` 的 `hasDesktopActiveTasks()` 检查运行中 Agent（含子代理与审批等待）、待处理 inbox，以及 running/stopping jobs；`quit-inspection.ts` 增加 schedule 活动；`desktop/src/quit-confirmation.ts` 将结果转换为三种提示并合并重复退出请求。检查失败按“可能有任务”提示，不静默退出。[任务判定](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/update-tasks.ts)、[退出检查](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/quit-inspection.ts)、[确认控制器](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/quit-confirmation.ts)

**鲸屿接入前提：** 在现有 Host 插件/鉴权通道提供只读 inspection，壳退出流程汇合调用；无需引入官方 Host 启动器。验收必须含运行中回复、等待审批、队列消息、后台命令、取消退出，以及重复退出。

**本地缺口已确认：** [index.js](../../src/main/index.js) 的 `before-quit` 直接清理资源并调用 `harness.shutdown()`，未接这套 Host 工作检查。更新也可借鉴 `installDesktopUpdateTaskControl()` 的 inspect/lock/unlock：阻止新请求、等待已接收请求结束、再次检查工作后安装，避免检查完成后又产生新任务。需适配我们现有鉴权通道和重启流程，不能直接搬官方私有 IPC。

**重要修正：** 官方退出检查只遍历 `agents.list()` 的已加载 Session；但当前 Schedule 已能恢复冷 Session，故不宜原样复制其定时任务检查。鲸屿还要覆盖 Bots routines 等自身调度器，并从持久任务服务获取退出影响。建议第一批做退出保护，更新锁单独验收，不能把读状态等同于已阻止新任务。

## 候选二：Office 依赖自给与可重复的文档工作流

**用户收益：** 用户无需自行装 Python/常见库，Agent 能稳定生成、编辑并检查 Word、Excel、PowerPoint；独立能力不涉及鲸屿视觉变化。

**最小依赖链：** `scripts/primary-runtime/` 的锁定 payload 构建 → `dsh-tool-workspace-dependencies` 的 `source`（`runtime.json` + `dependencies/`）及可选 `root` → `dsh-skill-office` + 已有 skill registry/tool-skill → Agent 执行工具和 present。工具返回绝对解释器/库路径，不改 PATH；可以原地使用或首次复制进鲸屿 home。[依赖工具](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/tool-workspace-dependencies/README.md)、[payload builder](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443/scripts/primary-runtime)

Office provider 注册 `office-docx`、`office-pptx`、`office-xlsx`；`assetRoot` 指向可由 Python 读取的外部技能资源，`node` 必须是独立 Node，`cli` 指向 LibreOffice Kit 或显式为 `false`。可以先接 Python + 结构检查，再接渲染/重算，不必搬官方全部 Desktop runtime。[Office provider](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-office/README.md)、[参考装配](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop-host/src/office.ts)

**渲染要单独界定：** 当前正式技能路径用 LibreOffice Kit CLI 渲染指定页面/表区、导出 PDF 和重算工作簿；Web 的 `office-to-pdf` 服务负责有界转换与预览。源码中未找到已注册的 `render_document` 工具，Desktop README 提及的同名工具是“环境若提供”的可选能力，不能作为开箱工具承诺。[技能行为](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/skill/skill-office/src/index.ts)、[预览转换](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/document/office-to-pdf/README.md)

**本地缺口已确认：** [after-pack.js](../../scripts/after-pack.js) 组装 Node/pnpm 与 vendored Harness，但没有上述 primary-runtime/office-skills 的准备与校验流程；[dsh.js](../../src/main/dsh.js) 启动 Web profile，不经过官方 Desktop Host 的 `desktopOffice` 装配。应由鲸屿自有 overlay 挂载工具和技能，资源放进现有安装包及独立 home。

**前提与验收：** 按目标架构打包解释器/库及外部技能资源，验证首次离线调用、升级 payload、三种文件读写、缺失资源错误；视觉验收需要模型图像输入，结构检查不能代替版式或公式结果检查。收益高，接入量预估中到高；不能只复制三份 SKILL.md 就称已完成。

## 候选三：原生快捷键与现有命令统一

**用户收益：** 快捷键可搜索、修改、恢复，菜单/按钮同步显示；浏览器 guest 或终端拿到焦点后仍按用户配置工作。通用设置 UI 与命令注册大部分已在上游 Web 中。

**最小接入边界：** `packages/client/shortcuts` 的纯 `./protocol` 提供校验、冲突和持久化；官方 `desktop/src/keybindings.ts` 存 `userData/keybindings.json`，`keyboard.ts` 负责 Electron 输入与聚焦 frame/guest，`preload-app.ts` 提供窄 API。保留鲸屿自己的 BrowserView/PTY，需要为它们连接同一命令分发和 focus 身份，不能直接套用官方 webview lease。[共享契约](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/shortcuts/README.md)、[持久化](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/keybindings.ts)、[桥接](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/src/preload-app.ts)

**本地缺口已确认：** 本地 Web composition 已挂载 `shortcuts`/`ui-shortcuts`，因此快捷键设置不是缺失功能。但 [menu.js](../../src/main/menu.js) 仍写固定 accelerators；[PanelToggles.tsx](../../vendor/deepseek-harness/packages/client/ui-titlebar/src/client/PanelToggles.tsx) 自行监听固定键位；当前 `src` 没有官方 `dshDesktop.keyboard`/`dshDesktop.shortcuts` 接口。共享服务按页面平台标记选择原生或 Web adapter，我们当前壳没有该官方标记/桥接，使用 Web 路径。建议统一自有面板命令、菜单键帽、持久化与 BrowserView 焦点分发，不重写设置 UI。

**不宜直接照搬的默认策略：** 官方 Windows/macOS Desktop 的已接受键位优先于编辑器和终端，甚至可覆盖 Ctrl+C；双普通键是重叠按住而非顺序 chord。鲸屿必须明确冲突策略并保护 IME、录制、弹窗和终端惯用键；坏配置不可被“恢复默认”覆盖。接入量预估中等，需要真实焦点场景验收。

## 候选四：给现有 Git Diff 增加双栏、高亮和折行

**已有能力不重复做：** 本地 Web composition 已装配 `workspace-changes` 与 `ui-deliverables`；[交付卡](../../vendor/deepseek-harness/packages/client/ui-deliverables/src/client/index.ts) 调用 `sidebarRight.openResource(changes-review)`，鲸屿也保留原生 sidebar 的特殊资源兼容路径。因此逐轮 review 属于已有代码/装配的验收项，不能说尚未移植。它的快照不承诺 Host 重启后保留。[官方 review](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-deliverables/README.md#the-review-tab)

**真正值得拿的增量：** 自有 [DiffPanel.tsx](../../vendor/deepseek-harness/packages/client/ui-diff/src/client/DiffPanel.tsx) 逐行绘制工作树/分支 diff，没有 split/wrap。官方 [FileDiff.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-deliverables/src/client/FileDiff.tsx) 已有双栏对齐、同步滚动、Shiki 高亮和折行，可抽出渲染能力或做数据适配，继续使用鲸屿现有 Git 范围和 stage/unstage/discard。

**边界：** 该组件是包内实现，不能假定是稳定的跨包 API；先对齐 hunk 数据、纯增删、二进制、超大 diff 和路径语义。仓库差异与逐轮快照不能混用。接入量预估中等，排在办公与快捷键之后。

## 候选五：把 Office/表格预览接进现有 Files 面板

**官方已有：** Word/PPT 可在 Host 转 PDF 预览，表格由专用客户端查看器打开；这些组成已在本地 Web patch 的 `office-to-pdf`/`ui-sidebar-documentpreview` 中。[官方文档预览](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-sidebar-documentpreview/README.md)、[转换服务](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/document/office-to-pdf/README.md)

**本地路由缺口：** [desktop-files.ts](../../vendor/deepseek-harness/packages/client/ui-files/src/client/desktop-files.ts) 以 extension 优先级接管有工作目录的 Session 文件，条件没有按 Office 类型分流；[Surfaces 打开路径](../../vendor/deepseek-harness/packages/client/ui-surfaces/src/client/apply.ts) 也会将工作区文件交给 `live.openFile`。而 [FilePreview.tsx](../../vendor/deepseek-harness/packages/client/ui-files/src/client/FilePreview.tsx) 的常规内容分支只有图片/文本/Markdown，binary 直接显示不可预览说明。这是常用路径的静态证据，不表示所有入口都无法预览 Office；必须用真实文件复现后决定改点。

**最小工作：** 保留现有 Surfaces 页签与布局，为 DOCX/PPTX/XLSX 等选择专用 renderer，保持源码文本编辑、保存与文件送对话；核实打包后转换引擎、字体及资源定位。Excel 预览不等于 Excel 编辑器，也不等于刷新原文件公式缓存。可与候选二组成“生成—检查—预览—交付”的完整路径，接入量预估中等，转换引擎缺失时会上升。

## 已带入：持久定时任务与 Bots 的职责分工

**用户收益：** 一次性、固定间隔、每日/每周、cron 任务可查看、编辑和查投递记录；重启保留，最短周期 60 秒。默认关闭，需要启用。[Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/schedule/schedule/README.md)、[rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)

**最小依赖：** 通用 Web composition 的 `schedule` + `ui-schedule`、storage-domain、Session controller 与持久 backend。投递提交要求 `session/flush` 确认，不能把该服务单独摘到纯 headless/SDK。当前实现会在到期时恢复 cold Session；循环任务仅投递最近一次遗漏。UI 读取共享 catalog，提供原 Session 的规则、状态与投递历史。[装配语义](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/schedule/schedule/src/index.ts)、[任务 UI](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/client/ui-schedule/README.md)

**本地状态已确认：** 当前 [Web patch](../../vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml) 包含 `schedule`、`ui-schedule`、`time-context`，三者模板均 `disabled: true`；用户 profile 可覆盖，未读用户配置。应先验证既有插件入口与按需启用路径，不另建调度器。普通会话提醒与 Bots routines 要明确归属，避免同一提醒投递两次。投递记录不等于 Agent 执行成功，应用退出期间不会自主运行。官方 Desktop README/quit 检查尚有“只看已加载 Session”的旧描述或实现，不作为现行 Schedule 能力的上限。

**其他不列入新移植：** 上游 `open-in-app`/`ui-open-in-app` 已挂载，鲸屿 Files 已接 `listEditors`、`openInEditor`、`showItemInFolder`、`openWithSystemDefault`，交付卡也接官方 native open controller。插件管理与自动审阅作为现有核心/可选 bundle 做兼容验收；`app-boot/src/profile.ts` 已列 auto-review optional bundle。不能从 release notes 再开一份同功能施工单。

## 建议排序与不新增的工作

1. **第一批：** 退出任务保护；更新锁作为独立子项。随后统一原生快捷键及鲸屿自有面板命令。
2. **第二批：** Office runtime + 三个技能 + 结构检查，与现有 Files 的 Office/表格预览接入一起验收。CLI 渲染/重算按资源准备情况分阶段交付。
3. **第三批：** 复用 Diff 渲染能力增强现有工作树/分支面板。
4. **兼容验收项：** 逐轮 review、关联打开、定时任务。源码和装配已经存在，有失败再定点修复。
5. 接入继续遵循鲸屿的设计语言、背景/特效/动效契约、单一右栏与独立数据目录。上述建议都不要求换桌面壳。

本次只写调研文档，未改产品代码。优先级与接入量是基于源码的工程判断，不是已跑通的实施结果；本地当前工作树不等同于已发布安装包。各项开工前按对应 feature 卡约束扩展范围，并以实际用户路径和安装包验收确认完成。
