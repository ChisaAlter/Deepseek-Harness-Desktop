# 工作台与五主题严格视觉复刻实施计划

> **面向执行代理：** 使用 `workflow:subagent-driven-development` 或
> `workflow:executing-plans` 按任务执行，所有步骤使用复选框跟踪。

**目标：** 把 Electron 和 Android 的真实产品界面重构为
`design/web3-themes-v2.html` 展示的紧凑工作台，而不是只更换主题颜色。

**架构：** 在现有 LeftSidebar、WorkspaceHeader、SplitContainer、AgentPane、Composer 和
EnvironmentPanel 边界内调整布局与视图，不新建静态壳，不复制业务状态。桌面使用三栏连续布局，
Android 使用紧凑 header、抽屉和原生消息流。

**技术栈：** TypeScript、React Native、Expo 57、Electron、react-native-unistyles、
Reanimated、Vitest、Maestro。

## 全局约束

- 仅支持 Electron 桌面端和 Android，不增加 iOS 工作。
- 默认主题保持 `light`（Blockchain Light）。
- 不使用 Web 预览冒充 Electron 或 Android 验收。
- 不引入静态示例数据；所有面板必须读取现有真实状态。
- 不运行完整测试套件，只运行改动相关 Vitest 文件。
- Reanimated 节点不得直接接收 Unistyles 动态样式。
- 视觉矩阵固定为 5 个主题 x 桌面工作台、桌面设置、移动聊天、移动抽屉、移动设置。
- 桌面验收 viewport 固定为 `1200 x 800`；移动参考 viewport 固定为 `320 x 660`。
- 非动态区域 MAD 必须 `<= 3.0`，任一 RGB 通道误差 `> 12` 的像素比例必须 `<= 3%`，几何误差
  必须 `<= 2px`。
- 只有真实 Electron 和真实 Android 截图可以支持对应平台通过；没有 Android 目标时总结果保持
  `in progress`。
- 当前工作树已有同一任务的未提交改动；不得重置、覆盖或回退这些改动，也不在中途提交部分结果。

---

### Task 0：建立可重复视觉证据链

**文件：**

- 创建：`.qa-tmp/visual-fidelity/capture-reference.cjs`
- 创建：`.qa-tmp/visual-fidelity/capture-electron.mjs`
- 创建：`.qa-tmp/visual-fidelity/compare-images.mjs`
- 创建：`.qa-tmp/visual-fidelity/matrix.json`
- 修改：`design-qa.md`

- [ ] 从 `web3-themes-v2.html` 以 `1200 x 800` 和 `320 x 660` 捕获标准参考画面，文件名固定为
      `<theme>-<surface>-reference.png`。
- [ ] Electron 捕获脚本只连接隔离 QA 包的 CDP，不连接正式 `release/win-unpacked`。
- [ ] 比较脚本输出实现图、并排图、差分图和 JSON 指标；mask 必须写入 `matrix.json`，禁止临时扩大。
- [ ] 先用一对故意不同的图片运行比较脚本并确认阈值失败，再用同图比较确认 MAD 为 `0`。

### Task 1：建立紧凑布局常量与侧栏尺寸迁移

**文件：**

- 修改：`packages/app/src/constants/layout.ts`
- 修改：`packages/app/src/stores/panel-store/state.ts`
- 修改：`packages/app/src/stores/panel-store/state.test.ts`
- 修改：`packages/app/src/components/left-sidebar.tsx`
- 修改：`packages/app/src/components/sidebar-session-list.tsx`

- [ ] 新增桌面 header `42px`、tab row `38px`、环境面板 `240px` 等共享常量。
- [ ] 把默认侧栏宽度改为 `200px`，最大宽度改为 `320px`，迁移旧默认 `320px` 到新默认。
- [ ] 先写 panel store 迁移失败测试，再实现迁移。
- [ ] 收紧桌面侧栏顶部、会话行、分组和 footer；Android 抽屉同步收紧但保留触控面积。
- [ ] 运行 `npx vitest run packages/app/src/stores/panel-store/state.test.ts --bail=1`。

### Task 2：重排桌面工作台与双层顶部栏

**文件：**

- 修改：`packages/app/src/screens/workspace/workspace-center-column.tsx`
- 修改：`packages/app/src/screens/workspace/workspace-header.tsx`
- 修改：`packages/app/src/components/headers/screen-header.tsx`
- 检查：`packages/app/src/screens/workspace/workspace-tab-presentation.tsx`

- [ ] 桌面 center column 去掉大圆角悬浮卡片、外部 gap 和 shadow，改为连续平面。
- [ ] 第一层标题栏固定为 `42px`，第二层真实 tab row 固定为 `38px`。
- [ ] 环境面板按设计稿保留右侧悬浮 inspector，并为消息与 Composer 增加避让空间。
- [ ] Android header 使用独立紧凑高度，不改变桌面窗口控制安全区。

### Task 3：实现真实环境面板标签

**文件：**

- 修改：`packages/app/src/screens/workspace/workspace-environment-panel.tsx`
- 修改：`packages/app/src/screens/workspace/workspace-environment-dock-model.ts`
- 修改：`packages/app/src/screens/workspace/workspace-environment-panel-model.test.ts`

- [ ] 使用现有 `dockState.activeTab` 渲染 Git、PR、Tasks、Subagents、Browser 标签。
- [ ] Git 标签展示真实分支、diff stat、查看变更和 commit/push 入口。
- [ ] PR、Tasks、Subagents、Browser 分别消费现有 `githubRuntime`、todo、subagents、browserContext。
- [ ] 保留 branch switch、open changes、open subagent 和 resume command 行为。

### Task 4：收紧 Composer 与新工作区草稿态

**文件：**

- 修改：`packages/app/src/composer/index.tsx`
- 修改：`packages/app/src/composer/input/input.tsx`
- 修改：`packages/app/src/screens/new-workspace-screen.tsx`

- [ ] 桌面 Composer 贴底并降低 padding、圆角和最小高度；Android 保持可触控尺寸。
- [ ] 保留附件、Agent controls、voice、send、queue 和快捷键行为。
- [ ] 新工作区移除超大居中标题，改为工作台内的紧凑草稿提示与 Composer。
- [ ] 导入会话入口改为低权重紧凑动作，不再占据大卡片区域。

### Task 5：同步 Android 设置密度

**文件：**

- 修改：`packages/app/src/screens/settings-screen.tsx`
- 修改：`packages/app/src/styles/settings.ts`

- [ ] Android root/detail header、列表项和卡片间距按设计稿收紧。
- [ ] 桌面设置侧栏改为 `240px` 左右，并保持现有 list/detail 导航。
- [ ] 不改变设置数据、主题目录或平台可见性规则。

### Task 6：验证、真实端验收和快捷方式

- [x] 对改动文件运行 `npm run format:files -- <paths>`。
- [x] 对改动文件运行 `npm run lint -- <paths>`。
- [x] 运行 `npm run typecheck --workspace=@chisacode/app`。
- [x] 运行所有改动相关 Vitest 文件。
- [x] 启动真实 Electron，截图对照当前图与设计图并检查控制台错误。
- [ ] 检查 Android 设备/模拟器；本轮未验证，不以 Web 代替，待可用设备补做。
- [ ] 重建 `packages/desktop/release/win-unpacked`，运行 packaged smoke。
- [ ] 刷新 `C:\Users\48818\Desktop\ChisaCode.lnk` 和 `C:\Ai\ChisaCode\ChisaCode.lnk`。

### Task 7：桌面五主题严格复核

- [x] 重建隔离 `release-visual-qa`，使最新 Liquid Glass 和 compact segmented control 进入运行态。
- [x] 捕获桌面设置五主题，逐项校正 sidebar、header、card、row、control 和 glass 背景。
- [ ] 使用隔离 QA home 固定真实 workspace、会话、tab、消息和 Git 状态，不向生产组件写入演示数据。
- [ ] 分别度量 sidebar、header/tabs、message stream、composer 和 inspector，再跑工作台五主题全图。
- [ ] 十个桌面画面全部达到全局视觉阈值，并烟测主题切换、Git/Tasks、inspector 和 composer。

### Task 8：移动聊天与 Composer 严格复刻

- [ ] 按 `320 x 660` 参考锁定 52px header、消息左右间距、工具行密度和贴底 Composer。
- [ ] 所有移动专属行为使用 native/compact 分支，不以 DOM API 或 hover 实现。
- [ ] 在真实 Android 设备或模拟器捕获五主题并逐项达到视觉阈值。

### Task 9：移动抽屉严格复刻

- [ ] 锁定约三分之二 drawer 宽度、40px 关闭行、2 x 2 快捷动作、42px 会话行和紧凑 footer。
- [ ] 保持 edge swipe、session 选择、host/action 按钮和 native 可触控面积。
- [ ] 在真实 Android 捕获五主题并逐项达到视觉阈值。

### Task 10：移动设置严格复刻

- [ ] 锁定 52px header、44px root/detail rows、16px 水平 padding、12px gap 和参考控件尺寸。
- [ ] 五主题 root/detail 都在真实 Android 捕获并逐项达到视觉阈值。

### Task 11：最终证据与正式构建

- [ ] 对改动文件运行 targeted format、lint、typecheck、Vitest 和 `git diff --check`。
- [ ] `design-qa.md` 逐项列出视觉矩阵指标和证据路径；任一缺失时保持 `in progress`。
- [ ] 全矩阵通过后才将 `final result` 改为 `passed`。
- [ ] 重建正式 `packages/desktop/release/win-unpacked`，运行 packaged smoke 并刷新两个快捷方式。
- [ ] 对最终工作树做需求逐项审计，不以测试通过替代视觉矩阵。
