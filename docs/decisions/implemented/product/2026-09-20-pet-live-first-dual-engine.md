# Decision: 宠物渲染回归 THA4 活体引擎 + Anime4K 实时超分（live-first 双引擎）

Status: implemented

中文 | [English](2026-09-20-pet-live-first-dual-engine.en.md)

> Supersedes [2026-09-20-pet-part-rig](../../archived/product/2026-09-20-pet-part-rig.md)

## Problem

`pet-part-rig` 的高清部件木偶在用户实机验收中被否决：刚性部件变换（整图旋转/缩放/位移）在结构上是「纸片人」——尾巴偏短、身体没有变形感，「还不如最开始那个模糊的本地训练版本灵动」。期间多轮修缝（羽化衬底、壳件融合、茎部埋入）只解决了接缝可见性，改变不了刚性变换的本质；用户明确要求换方案：灵动感的来源是 THA4 模型逐帧变形渲染，不是任何贴图方案能模拟的。

## Decision

**渲染器改回「活体优先」双引擎**：

- **主引擎 = THA4 实时推理**：`stepPose()` 的 45 维姿态通道（呼吸、视线、眨眼、困倦、小动作、拖拽挤压、点触反应）照常进模型，每帧产出整幅变形渲染——灵动感的原生来源。初始化顺序反转：先建 ONNX session（webgpu→wasm），rig 资产只在活体初始化失败时兜底。
- **实时超分 = Anime4K WebGL 着色器**（`pet-live2d/anime4k.js`，MIT，monyone/Anime4K.js 1.1.3，预置 `ANIME4KJS_SIMPLE_M_2X`）：THA4 输出裁剪区 390×492 → 2× 到 780×984，实测中位 **0.6ms/帧**。RGB 侧先把裁剪区做两轮模糊渗透填充（destination-over），避免透明黑边缘被 CNN 涂抹成暗晕；alpha 走普通双线性放大 + destination-in 合成——羽化边缘因 alpha 平滑而保持干净。
- **状态层 = 姿态通道 + 整帧变换**：`LIVE_STATES[name]` 程序往 pose 通道写目标值（sleep=闭眼+垂头+深呼吸、pick-up=宽眼惊讶→委屈挤眼+哭腔节拍、eat=开场惊喜→咀嚼、react-head=「诶？」→融化成开心、angry=竖眉+蒸汽抖、celebrate/star/greet/startle/tail-swing/running 各有通道配方），同时写整帧变换（`liveFx.rot/dx/dy/sx/sy/pivot`）——睡觉绕脚点整转躺倒、拎起绕抓取点摆锤、庆祝弹跳。状态切换由 `stillCtl.alpha` 包络加权：姿态空间连续所以**脸部是渐变 morph 而非贴图跳变**。`star` 星瞳是 pose 词汇表外唯一程序化绘制。
- **推理节流**：`renderFrame` 按 ~50ms 间隔调度（省电模式 110ms）——实测 WebGPU 中位 33.8ms/p90 35.9ms，约 18fps 有效刷新；姿态数学与整帧变换仍每 rAF 跑，位移/旋转/表情渐变按显示帧率插值。
- **显存修复**：`session.run()` 的输出张量逐帧 dispose（此前每帧泄漏 ~1MB）；非 GPU 路径复用同一个 pose CPU 张量而不是每帧新建。
- **清屏**：整幅 `clearRect`——继承自 rig 时代结论：脏矩形联合框在快速抛掷/姿态切换时漏清旧墨迹（半透明残影），透明分层窗上每次漏清都是可见碎片。
- **降级链**：live 引擎 → rig 木偶 → 旧 `states/*.webp` 立绘，逐级 fallback；`LIVE_ENTRY`/`RIG_ENTRY` 标记入口让 `stillCtl` 门控、命中测试、抛掷弹道盒（`liveCharBox`/`rigCharBox`）在三引擎下统一工作。

## Alternatives considered

- **继续修补 part rig** — rejected（用户否决）：接缝可修到像素级干净，但刚性部件变换造不出变形灵动，这是架构属性不是参数问题。
- **每帧 Real-ESRGAN ONNX 超分** — rejected：realesr-animevideov3 导出后实测浏览器内 1393ms（PReLU 版）/ 252ms（ReLU 重导）每帧，推理一次比 THA4 慢一个量级，无法帧级跑；两个导出件已从 `pet-live2d/` 移除。
- **WebNN 推理** — rejected：运行环境不支持 WebNN（实测探测失败），无可用 EP。
- **逐姿势蒸馏 THA4** — rejected（前篇已记）：~20h/姿势本机独占 GPU + 输入图画风不符，蒸馏忠实复刻错误风格。
- **静态立绘回贴** — rejected（用户否决）：三种画风互不统一且静态，是本方案明确取代的对象。

## Consequences

- **收益**：待机灵动性恢复到用户认可的原版水平（变形渲染、发丝/眼皮/呼吸连续）；拼接缝在结构上不存在（整帧单纹理）；尾巴回到主视觉原长；表情切换是真 morph 不是 crossfade。
- **代价**：睡觉/拎起等姿势仍是整帧刚性变换——轮廓层面是"整张图在转"，靠帧内持续变形（呼吸、表情节拍）避免纸片感；这是 THA4 表达不了全身姿势的固有上限。GPU 常驻推理（~34ms/50ms 调度窗）。Anime4K.js vendored 9.4MB UMD（含全部 shader 权重）。超分输出仍要再缩放回 240×260 显示——锐度收益集中在内部线条而非轮廓。
- **风险**：Anime4K 初始化失败静默降级到原始帧（`srReady=false`，画面可用只是偏软）；ONNX session 建不起来回落 rig。两条路径都经 `paint()` 同一出口，无分叉绘制。
