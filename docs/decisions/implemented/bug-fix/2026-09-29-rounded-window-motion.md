# Decision: 同时保留 20px 透明圆角与 Windows 原生动画

Status: implemented

中文 | [English](2026-09-29-rounded-window-motion.en.md)

## Problem

修复最大化/最小化动画时，把 Windows 壳窗改为不透明并移除页面外缘圆角，导致既定 20px 圆角退化为系统小圆角。用户明确指出并否决这一退化。前次验证只证明了动画与原生状态，没有验收外观契约。

透明 Electron 窗口即使传入 `thickFrame: true`，实际 HWND 仍缺少 `WS_CAPTION | WS_THICKFRAME`。本机隔离实验验证：构造后补回这两个样式、刷新非客户区，可以同时保留透明剪影和 DWM 动画；二者并非只能选一个。

用户再次截图暴露了第二处遗漏：补样式让 DWM 在页面 alpha 之外绘制矩形非客户区。前次 `capturePage` 和局部截图没有验收完整桌面合成。桌面四角探针在旧实现稳定失败（角外像素偏离背景，甚至填白），禁用非客户区绘制后恢复透明；仅设置 `DWMWA_BORDER_COLOR=NONE` 无效。150% DPI 下原 1 CSS px 缘线占 1.5 物理像素，收细为一个物理像素以减轻边缘台阶感。

缩放复验还暴露出 Electron 透明窗的 `maximize()`/`isMaximized()` 可以只是工作区几何变化；150% 下 Electron 报 true 但 Windows `IsZoomed` 仍为 false，强制 125% 下还因 1 DIP 舍入差直接报 false。先前录制直接调用系统 ShowWindow，未证明按钮的 IPC 路径。新增 IsZoomed 断言在旧实现失败，改为原生状态请求后通过。

既有记录审计：[原生动画修复](2026-09-29-native-window-motion.md)部分重叠，本篇取代其不透明窗口、系统小圆角和 `nativeFrame` 页面覆盖策略，保留其原生状态与 HWND 门禁；[窗控自愈](2026-09-25-window-chrome-self-heal.md)、[剪影缘线](2026-09-25-window-silhouette-edge-ring.md)、[OS 圆角遮罩](2026-09-27-transparent-window-os-corner-mask.md)和 [20px 圆角](../product/2026-09-27-shell-window-corner-radius-20.md)部分重叠，原有透明剪影和缘线重新生效。没有完全取代的记录。

## Decision

- 主窗口、启动器保留 `transparent: true`、`roundedCorners: false` 和透明底色；启动页、Harness、启动器恢复原有 20px 页面圆角与缘线，最大化时收为 0。
- `native-window-motion.js` 在显示前同步恢复当前 HWND 的 caption/thick-frame 样式，仅 OR 指定位；刷新不改变尺寸、位置、焦点或 Z 序。Windows 使用真实最大化状态，其他平台与桌宠不加载此桥。
- 窗控最大化/还原调用 `ShowWindowAsync(SW_MAXIMIZE / SW_RESTORE)`，用 `IsZoomed` 决定状态与切换方向，不调用 Electron 透明窗的几何最大化。注册 HWND 和其 API 绑定在 WeakMap 内；非桥接窗口保留原路径。录制由真实 IPC 触发，原生状态断言独立读取 Win32。
- 刷新样式后设置 `DWMWA_NCRENDERING_POLICY=DWMNCRP_DISABLED`，只禁用非客户区绘制，保留原生动画样式和系统过渡策略。API 失败必须报错。Harness/启动器以 `--dsh-window-hairline=1/devicePixelRatio px` 绘制一个物理像素的 border-l2 缘线，继续使用浏览器 alpha 抗锯齿，不加硬 region 或模糊。
- 桥通过锁定的生产依赖 `koffi@3.3.2` 调用五个 user32 API 和一个 dwmapi API，不启动外部进程；桌面与 slim 启动器均显式解包 Koffi 和平台原生模块。加载或样式应用失败直接报错，不能静默退回不透明窗口。
- `window-motion` 卡、设计语言、规则、同步约束和 QA 同时约束圆角与动画。自动门禁检查最终工厂参数、20px computed radius、角外 alpha=0/角内实色、转换前后 HWND 样式和授权 IPC；逐帧截图另行证明可见动画，不以状态通过替代视觉验收。
- Windows 门禁同时查询 DWM 非客户区状态；交互桌面加 `--composed`，在洋红背景上检查四角真实像素与内部可见性，覆盖激活、失焦、resize 和还原。隐藏/被遮挡的窗口不能假阳性通过；页面 alpha、桌面合成与可见动画分别验收。

## Alternatives considered

- 不透明窗口与系统圆角：无需原生依赖即可恢复动画，但缩小了既定圆角，用户否决；不得再作为本问题的默认修法。
- 不透明窗口加 `setShape` 圆角 region：可保留形状和动画，但本机实验出现白色边缘，且需维护尺寸/DPI 对应的 region，未采用。
- 每次创建窗口调用 PowerShell/PInvoke：适合独立诊断探针，但引入子进程启动和异步窗口显现时序；产品改用窗口显示前同步执行的窄 N-API 桥。
- 页面缩放或 `setBounds` 插值：可自行绘制过渡，但无法统一任务栏恢复与系统动画偏好，且并不恢复原生窗口行为，未采用。
- 只去掉 DWM 边框颜色：改动小，但实测不消除矩形填充；需要禁用整个非客户区绘制。改成额外 CSS clip-path 的实验没有改善圆弧 alpha 误差，未引入新的裁切层。

## Consequences

圆角和动画成为必须同时通过的契约。代价是新增生产原生依赖，升级 Electron、同步 DSH 或修改打包配置时必须复验 HWND、像素和包内模块加载。系统关闭动画时仍尊重其设置；交互桌面逐帧验证与 CI 状态验证职责不同。

本机验证覆盖两个生产窗口工厂与启动器 ASAR 原生模块加载；多显示器、其他 DPI、系统关闭动画的完整矩阵尚未重跑。结果和可复现脚本见 [QA 证据](../../../qa/results/2026-09-29-corner-motion/README.md)。
