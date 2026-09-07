# 远程 Web 与 Android 深度交互改造计划

日期：2026-09-06。状态：**approved / implementing**。用户已于本轮回复“可以，继续”，批准计划与配套文档范围。实现与本地验证进行中；生产部署、覆盖用户安装仍需交付关口授权。

Feature：`mobile-remote`。
设计：[同轮设计提案](../specs/2026-09-06-mobile-web-android-interaction-design.md)。
来源：[插件借鉴矩阵](../research/2026-09-06-mobile-plugin-interaction-review.md)。

## 交付定义

交付同一修订的远程 Web 候选、更新后的 Android APK、分轨验收记录与资源校验清单。改善日常操作层级、返回、弹层、输入和恢复；保留现有会话、模型、审批、Git 能力及安全边界。Android 不是后续附赠步骤，原生承载与打包验收和 Web 并行。

用户本轮明确要求 Android 一起更新，故新一轮 T3 纳入必测。旧版发布报告中的 Android 未测结论仍保留，不把历史 Deferred 改写为 Pass。批准本计划不等于批准生产部署、使用私钥、替换用户安装或改网络配置。

## 现状证据

| 已核对事实 | 源码或文档 |
| --- | --- |
| 多个独立布尔值控制表面；sheet/dialog 由 app.js 集中生成 | `mobile/web/app.js:208`、`:4329`、`:4653`、`:4857`、`:5026` |
| 通用面板没有统一可见关闭头部；内容整体滚动 | `mobile/web/app.js:4329`；`mobile/web/app.css:715` |
| 已有 viewport 高度回退，不能在改造时删掉 | `mobile/web/app.js:118` |
| 当前模型点击关闭面板，思考档位另在列表后面 | `mobile/web/app.js:4576` |
| 草稿已按配对电脑保存；附件有异步归属保护 | `mobile/web/app.js:1994`；`mobile/web/host/attach-guard.js` |
| Android 返回目前仅 canGoBack/goBack，否则离开 | `mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/RemoteWebScreen.kt:141` |
| Android 已向网页发 dshd-resume；WebView 有显式请求代次 | 同上 `:72`、`:157`；`ui/RemoteWebNavigation.kt:6` |
| 文件选择当前统一使用 OpenMultipleDocuments，没有按 capture 分支 | `mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt:39`、`:47` |
| APK 直接把 ../web 作为 assets；版本为 versionCode=1/versionName=0.1.0 | `mobile/android/app/build.gradle.kts:14`、`:39` |
| 当前 QA runner 硬编码 3180，使用 fake host-tunnel client | `tools/mobile-web-qa/run-qa.mjs:33`；`tools/mobile-web-qa/server.mjs:25` |
| 实机验收文档旧轮次明确排除 Android | `docs/qa/mobile-remote-live-acceptance.md:9`、`:23` |
| mobile README 仍残留 ACP/Git 能力降级说明，与 Feature 卡不同 | `mobile/README.md` Web 第 4/5 条；`docs/features/mobile-remote.md` MUST |

环境只读探查：Node 和 JDK 17 在 PATH；发现本机 SDK 下的 adb，但 adb 不在 PATH。尚未验证 SDK platform、设备授权、可用手机、签名密钥或 Gradle 构建。不得由“找到 adb”推断 Android 已可验收。

## 方案选择

采用现有 SPA 内渐进改造：提取小型导航状态与表面原语，逐条迁移真实工作流，再补原生承载。优点是保留协议与业务验证，能按阶段回归；代价是需要短期适配 app.js 中的旧状态。

不采用叠加全部手机插件：它们依赖官方插件树，且有互相覆盖样式、焦点与手势的风险。不重写 React/Compose 聊天：收益无法抵消协议回归和双实现成本。不做单纯 CSS 修补：不能解决 browser/native Back、异步结果归属和任务层级。

## 改动边界

主实现限于 Feature 卡允许范围：`mobile/web/`、`mobile/android/`、`tools/mobile-web-qa/`、`tools/remote-web-qa/`。默认不改 daemon、relay、Electron Git dispatch 或 host 白名单。生成协议 bundle 不手改；只有确有依赖变化才使用现有生成脚本。

配套文档范围须随计划确认：`docs/design-language.md`、对应英文、`docs/motion.md` 及英文、`docs/features/mobile-remote.md`、`docs/handbook/modules/mobile-remote.md`、`mobile/README.md`、现有两份远程 QA 文档及新结果。设计语言是强制先改项；motion 仅补实际使用对照；handbook/README 只修本次路径与既有错误说明。

当前设计语言与桌面 ModelSelect 有用户未提交改动，必须合并阅读并保留，不回滚、不整理邻域。不要扩改桌面 ModelSelect、根包版本、CI release workflow 或其他 Feature 卡。需要额外文件时先说明并确认。

## 阶段与依赖

执行顺序：P0 → P1 → P2/P3；P4 的承载验证在 P1 稳定后即可开始，与 P2/P3 同步；P5 汇合所有轨道。阶段划分不要求额外代理，实施时可按不重叠写集安排。

### P0：冻结交互契约与基线

- [x] 批准设计提案，先在设计语言中明确手机页面/短面板/确认层、触控区域、编辑字号、导航控件和动效；不改原有色板。
- [ ] 在 Feature 卡与 QA 文档新建本轮 T1/T2/T3 验收范围，保留旧结果；未验证前不更新 last verified 为通过。
- [ ] 盘点全部现有表面，记录入口、层级、关闭、返回、数据归属、失败路径和协议调用；以设计提案中的表面矩阵为清单。
- [ ] 用现有 fake host 服务建立 320/360/390/430/768/1280 宽度、明暗、长标题/模型、长目录、错误、审批、运行态 fixture。录原始缺陷，而非先换 UI 再描述问题。
- [x] 为 QA 服务选择空闲端口并让根路径及 /dshd/ 前缀可测，不能占用当前桌面的 3180。

文件：上述配套文档、`tools/mobile-web-qa/server.mjs`、`fake-daemon-client.mjs`、`run-qa.mjs`。新增本轮 fixture 和结果置于同一 tools 目录。
出口：表面无遗漏；已确认文档与行为差异；基线记录可以复现，不把 fixture 当实机。

### P1：统一导航与表面基础

- [ ] 先新增纯状态转换测试：打开同级面板互斥、嵌套任务返回、close 清整任务、确认层取消、切设备/会话清旧上下文。
- [x] 提取拟新增 `mobile/web/ui/navigation.js` 与 `surfaces.js`，负责导航转换、标题/返回/关闭、正文滚动、操作区、焦点和遮罩；业务 RPC 留在原 host/Git 层。
- [ ] history 适配只记录安全视图标记。验证 Back/Forward/刷新不重复写操作、不恢复已消费 offer；连续点关闭和系统返回不双退。
- [ ] 消除相互冲突的旧表面布尔值，只保留单一真相；渲染适配逐个迁移，不全量重写 app.js。
- [ ] 背景 inert/不可交互、可访问标题、硬件键盘 Escape/Tab、触发器存在性和不唤起软键盘的焦点恢复均纳入测试。

文件：`mobile/web/app.js:4329`、`:4653`、`:4857`、`:5026`；`app.css:715`；`index.html`；新 `ui/navigation*.js`、`ui/surfaces*.js`；新 tools 交互测试用例。
出口：每种关闭入口一次只退一层，根页可正常离开；无双遮罩、穿透、孤立历史条目或敏感 history.state。

### P2：会话、设置和复杂任务

- [ ] 会话抽屉选中后收起，不误聚焦；保留搜索、分组、排序、归档和只读子会话。切换失败可见，不显示旧会话假成功。
- [ ] 设置使用目录到详情；返回恢复目录位置。只重排当前允许项，不把桌面管理权限带到手机。
- [ ] 新会话、目录浏览、新建目录在同一任务内前进后退；无工作区、已有工作区、预设路径完整保留。新建工作区成功写回桌面，返回不得重建。
- [ ] Git 的分支、创建分支、Commit/Push/PR/Publish 用有固定操作区的任务视图；保留路径选择、新分支提交、默认分支确认及错误可复制。
- [ ] 建分支与提交表单返回保留字段；运行中不重复写，不以关闭页面假装取消。提交成功后 Push 失败不得自动再 Commit，按已完成步骤提供准确恢复。
- [ ] 长目录/分支查询使用原有数据来源；结果绑定请求代次，关闭或换会话后的响应不能重新打开任务。

文件：`mobile/web/app.js:2044`、`:2158`、`:3426`、`:4209`、`:4361`、`:5047`；`ui/settings-hub.js`；`host/catalog.js`；`git/stack.js`、`git/bridge.js` 仅在已有交互契约需要时调整，保留原回归。
出口：所有 MUST 新建会话与 Git 路径保留；每个任务通过成功、返回、失败重试与迟到响应四类检查。

### P3：模型、输入、审批与触屏

- [ ] 模型搜索与思考强度在一个面板完成；现值高亮，成功原位反馈，失败回滚并留重试。无 reasoning 不显示档位，未配置模型仍不能选。
- [ ] 权限实际走 commands/execute，Plan 芯片与只读审批接管不丢；开发者协议解释从常驻文案移到文档，保留必要错误原因。
- [ ] 常驻 composer 支持阅读/编辑状态；长草稿收展不丢选区、附件、输入法状态。模型/权限/附件动作不触发焦点抖动。
- [ ] 保持手机 Enter 换行，明确运行时发送与停止；不加假队列、不把 slash 发成聊天。长标签不能把操作按钮挤走。
- [ ] 审批正文独立滚动，确认/拒绝可达；跨端解决后清 pending；重复点击只发一次响应，失败可重试。
- [ ] 灯箱与附件取消使用统一返回；文字选择、代码与表格横滑优先。抽屉拖动最后接入，未通过冲突测试时保留按钮入口，不强上手势。
- [ ] 保留 viewport 像素回退，测试偏移、横屏、分屏、缩放和键盘，避免只依赖 100dvh。

文件：`mobile/web/app.js:118`、`:496`、`:1402`、`:4553`、`:4576`、`:5197`；`conversation/draft-switch.js`、`chisacode/controller.js`、`host/models.js`、`host/approval-respond.js`、`host/attach-guard.js`；拟新增 `ui/composer-state.js` 和对应测试，仅在能简化状态时提取。
出口：五轮对话、running 发送/停止、IME、切模型/思考/权限、审批、附件均通过 fixture 集成；选择文本和手势不互相劫持。

### P4：Android 原生承载与 APK 同步

- [x] 接入共享返回协议，先写返回决策单测：网页层消耗、根层离开、JS 未就绪、快速双按、旧 WebView 回调。只对当前可信 asset 页面调用，不新增任意 JS 权限桥。
- [ ] IME 打开时系统返回只收键盘；随后一次返回才退最上层。保留 requestId 导航和 offer 防重放；生命周期恢复不触发第二次配对或重复订阅。
- [ ] 把相册、拍照、取消、拒绝和加载失败分开实现；使用系统 picker/capture 与受控临时 URI。旧文件回调取消一次，新的选择结果不进入旧会话，销毁或旋转不重复回调。
- [ ] 核对 safeDrawing、adjustResize 与网页 viewport 的责任：无双重底部空白、状态栏遮挡、零高画面或键盘盖按钮。验证暗色、横屏、字体放大、系统三键/手势导航。
- [ ] 原生连接与权限页对齐批准的 DSHD 手机规范，纠正“加载桌面提供的手机页”等过时承载文案，保留扫码、粘贴、重试和已保存入口。
- [ ] 在 Android 测试目录补承载集成测试；JVM 测试不冒充 WebView/IME 真机测试。不无关升级 Kotlin、Compose、SDK 或 Harness。
- [x] Gradle 对共享网页采用确定性的运行资源清单，排除测试和开发文件；构建前检查 ESM 依赖完整，构建后解包核验哈希。新增审计脚本限 tools/mobile-web-qa 内。
- [ ] 核对旧 APK 的包名、签名、versionCode 后构建更新包。相同签名才走保留数据的覆盖安装；无原签名时仅交付测试包，不卸载用户正式包来制造“升级成功”。

文件：`mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/RemoteWebScreen.kt`、`RemoteWebNavigation.kt`、`DshScreens.kt`；`MainActivity.kt`；必要时 `DshViewModel.kt`；`AndroidManifest.xml`、`res/`、`app/build.gradle.kts`、`app/src/test/`、拟新增 `app/src/androidTest/`；`tools/mobile-web-qa/` 资源核验脚本。
出口：新 APK 使用本次网页，按真实设备完成返回、媒体选择、冷启动、前后台、重连与保留配对的更新测试；未具备签名或设备时明确未完成对应出口。

### P5：双端联调、交付与回退

- [x] 所有本轮单测、现有 mobile/web 回归与 host/Git 白名单门禁通过；新增交互用例不以静态字符串断言取代真实操作。
- [ ] 自动浏览器走当前 T3 Code preview：先 preview_status，未附加则 preview_open，再用快照定位器操作。复用仓库 fake-host fixture；不得因预览初始关闭就另开浏览器。
- [ ] 现有 Puppeteer CLI 是 CI/独立环境的复跑入口。当前会话只有在 preview 明确不支持或工具缺席时才使用；不要为本任务无关迁移整套 QA 框架。
- [ ] T1 公网实际 origin、适用 T2 LAN、T3 APK 分轨跑完整 MUST 与新增交互清单。fixture、桌面设备模拟、真人手机分别注明证据等级，不能互相顶替。
- [ ] 公网部署前确认权限、目标和回退路径；完整静态资源图原子替换并验证 /dshd/ 前缀，不只更新 app.js。不得带 QA fake client 或调试默认开关。
- [ ] APK 记录包版本、签名指纹和内置资源清单；Web 记录部署修订和资源清单。三条 origin 的入口不同，但核心运行资源应匹配候选清单。
- [ ] 准备静态 Web 旧版本回退；Android 优先同签名、递增 versionCode 的修复包，不能指望任意降级安装，也不能清空 localStorage 规避兼容问题。
- [ ] 更新 Feature 卡 last verified 时逐轨列真实结果；handbook/README 留当前态，长证据放 tools/mobile-web-qa/results/本轮目录。尚未通过的轨道不能写“手机端完成”。

出口：源码、Web 候选、APK、资源哈希、逐轨结果与已知未测项齐全。发布凭证或真机缺失时可交付本地候选，但整体状态保持部分完成。

## 可测试验收清单

| ID | 测试与通过标准 | 轨道 |
| --- | --- | --- |
| NAV-01 | 每个面板/任务打开关闭 20 次，无遗留遮罩、重复监听或历史累积；一次 Back 只退一层 | fixture + T1/T3 |
| NAV-02 | 设置目录到详情再返回保留滚动；Git/目录内返回不重新写数据；根页无退出拦截循环 | 全轨 |
| NAV-03 | Back/Forward/刷新、新 offer、快速双按，不恢复旧密钥、不重复 prompt/respond/Git RPC | fixture + T1/T3 |
| FOCUS-01 | 进入会话、开权限/模型、发送/停止均不额外唤起已收起键盘；点击编辑可正常输入 | 真机 T1/T3 |
| VIEW-01 | 320×568、360×640、390×844、430×932、768×1024、1280×800 及横屏无页面横向溢出大于 1px；代码/表格在自身容器滚动 | fixture |
| VIEW-02 | 键盘开关、200% 缩放/文字、明暗下返回/关闭/确认/发送可达；原生图标命中区至少 48dp，Web 至少 44 CSS px | 自动几何 + 真机 |
| DRAFT-01 | A/B 会话各写不同草稿及附件，切换、返回、重连、后台恢复仍归原会话；IME 选词不发送、不丢字 | 全轨 |
| MODEL-01 | 长模型名不挤走操作；模型与 effort 原位切换、失败回滚，无 reasoning 隐藏思考档；桌面反向变更可同步 | 全轨 |
| CHAT-01 | 已有与新建工作区各五轮对话；running 发送/停止、slash、权限、只读子会话保持契约 | 全轨 |
| APPROVAL-01 | 长审批正文下按钮仍可见；重复点击只发一次 respond；跨端解决清 pending；失败不假成功 | 全轨 |
| GIT-01 | Commit→Push→PR 顺序、分支创建/跟踪、Publish、路径筛选和默认分支确认保持；中间失败不重复已完成写操作 | fixture + 独立测试仓 |
| TOUCH-01 | 选中文字、拖选区、代码/表格横滑不打开抽屉；多指缩放仍有效；减弱动效时无入退场动画 | 真机 T1/T3 |
| AND-01 | 键盘开时一次系统返回只收键盘；后续返回退页面；根层才离开；旋转/旧回调不连退 | T3 |
| AND-02 | 相册和拍照均返回真实图片；取消/拒绝可恢复；中途换会话、重复请求和销毁不会串附件 | T3 |
| AND-03 | 热扫码/新链接仅处理一次；冷启动、前后台、断线恢复不重放 offer，已保存配对不丢 | T3 |
| BUILD-01 | APK 解包后运行资源图完整且哈希匹配；无测试 client；/dshd/ Web 入口全依赖返回正确 MIME，无混版 | Web + APK |
| UPDATE-01 | 同签名覆盖安装后 packageId/asset origin 不变、versionCode 增长；配对和草稿仍可用，无卸载或清数据 | T3 |

共享的 UI 验收不要求三轨的配对凭证互通。真实轨道至少记录 Android Chrome、Android WebView 的实际版本；iOS Safari 的 Web 验证单列，设备未具备就保留未测，不推断跨浏览器全兼容。API 26 与 API 36 作为原生支持边界的代表构建/设备检查；模拟器只能补充，不能替代真机键盘与手势证据。

## 验证入口

执行时先核对环境与授权，以下是已有命令，不代表本次已运行：

```powershell
node --test "mobile/web/**/*.test.js"
node --test src/shared/dshd-host-tunnel.test.js src/main/dshd-git-dispatch.test.js
```

Android 工作目录 mobile/android：

```powershell
.\gradlew.bat :protocol:test :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug
```

配置本轮 instrumentation 后运行 :app:connectedDebugAndroidTest；需授权设备。release 仅在签名配置得到确认后构建并验证，不把未签名 APK 当可覆盖升级交付。

现有浏览器复跑命令：`node tools/mobile-web-qa/run-qa.mjs`、`node tools/mobile-web-qa/run-connect-qa.mjs`、`node tools/mobile-web-qa/run-catalog-parity-qa.mjs`、`node tools/remote-web-qa/run-e2e.mjs --relay <endpoint>`。前两者端口/前缀需 P0 参数化；真实 relay 测试只能使用批准的测试设备与独立测试工作区，结束撤销专用配对，不打断用户 daemon。

## 风险与控制

| 风险 | 控制 |
| --- | --- |
| UI 重构偷偷丢失已实现功能 | 先表面清单与 MUST 映射，逐工作流迁移，每阶段回归 |
| 双导航状态造成连退或旧 offer 重放 | 单一转换模型、无敏感 history 标记、requestId 归属、Back/Forward 单测 |
| 焦点修补损坏 IME 或可访问性 | 不改 HTMLElement.prototype.focus、不全局吞键；真机测试补合成事件盲点 |
| 异步审批/模型/附件结果串会话 | 复用归属 guard，捕获请求上下文，切换后拒绝迟到结果 |
| 关闭 Git 页面被误认为取消 | 操作状态独立于视图、显示已完成步骤、禁重复写、无假取消 |
| APK 与公网混版 | 同一修订的依赖图清单、完整发布、APK 解包校验 |
| 旧 APK 签名或设备不可得 | 不清用户数据，不制造覆盖安装 Pass；明确保留未测轨道 |
| 手势与系统返回冲突 | 先无手势也完整可用，再做局部渐进增强；选区/横滚优先 |
| 不相关用户修改被覆盖 | 执行前复读 dirty diff，只修改批准范围，不 reset/revert |

## 交付物与进度

- [x] 插件调研与取舍记录。
- [x] 本轮设计提案与实施计划。
- [x] 计划与配套文档范围确认。
- [ ] P0 契约、表面清单、fixture 基线。
- [ ] P1 统一导航与表面。
- [ ] P2 工作流迁移。
- [ ] P3 输入与触屏。
- [ ] P4 Android 承载、资源与更新包。
- [ ] P5 双端实机验收与交付。

### 实施记录（2026-09-06）

本地候选已经实现，不是“仅计划”。上述阶段复合出口仍保留未勾选，不能用代码落盘替代真机与公网验收。

| 阶段 | 本地进度 | 仍待完成 |
| --- | --- | --- |
| P0 | 设计语言先行、表面矩阵、动态端口及前缀服务已落地 | 改造前完整明暗/长内容视觉基线未补齐，不事后伪造 |
| P1 | 统一 Back、短面板/全屏任务原语、inert、焦点约束；保留业务对象作为导航投影来源 | 全入口真机与刷新/新 offer 联调 |
| P2 | 抽屉、设置、目录、Git 迁移；已完成步骤重试；创建会话与目录缓存归属修复 | 最终修订的成功/失败/迟到响应完整浏览器矩阵 |
| P3 | 模型原位选择、长草稿收展、运行时发送、审批防重复及触控尺寸 | IME、缩放、长审批、真实附件与五轮对话；未加入抽屉拖动 |
| P4 | 原生 Back 恢复、capture/picker、原生连接页、共享资源 staging 与 debug APK | 真机、旧正式签名核对、同签名覆盖更新 |
| P5 | 本地回归、分轨证据、候选资源审计 | 公网部署授权、T1/T2/T3 实机；当前不签整体完成 |

本轮证据：[本地候选验证记录](../../../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)。草稿文字持久化与附件内存保存仍是不同承诺，未声称附件跨进程/升级持久化。没有部署公网、安装/卸载 APK、清数据或更改生产配置。
