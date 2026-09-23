# Decision: 宠物渲染改为「高清部件木偶（part rig）」

Status: implemented

Archived: 2026-09-20

中文 | [English](2026-09-20-pet-part-rig.en.md)

> Supersedes [2026-09-20-pet-live-head-states](../../archived/product/2026-09-20-pet-live-head-states.md)

## Problem

同日两条路线被用户连续否决：

1. `pet-states-regen` 的静态立绘——静态贴图，不灵动。
2. `pet-live-head-states` 的「无头身体 + 活体头合成」——身体立绘与 THA4 活头画风断裂（赛璐璐拼软水彩），矩形擦头切掉发饰结构，且用户判定本质是「垃圾贴图糊弄」。

用户最终要求：**待机形态（软水彩、灵动）是目标形象；其他所有动作必须从它出发重新绘制拆分**，而不是任何贴图方案的变体。

## Investigation

- **THA4 蒸馏上限**：模型 I/O 烘焙 512²（角色有效区 ~124×172），喂大图输出 bbox 不变；喂姿势输入图会归一化坍缩回站姿——「换图换姿势」不可行。
- **逐姿势蒸馏**：`C:\Ai\tha4` 管线齐全（8 张姿势输入图 + config + 云打包脚本），但 3060 Laptop 实测 ~20h/姿势，8 个姿势 ≈ 一周独占 GPU；且姿势输入图本身是另一种画风（硬线稿、高饱和），蒸馏会忠实复刻错误风格——重画输入图的工作量和直接做部件相当。
- **imagegen SVG 不可行**：gpt-image-2.5 只产位图；真 SVG 得靠语言模型手写 markup，画不了软水彩角色。等价目标用「高清位图部件」达成（部件源图分辨率 ≥10× 显示尺寸，清晰度等同矢量）。

## Decision

**角色改为一张 2048² 高清主视觉拆出的部件木偶，渲染全部程序化**：

- **资产**：`avatar/character.png`（即待机形象源图）经 Real-ESRGAN anime 4× 超分到 2048² 得 `master`；程序切出 `shell`（**头+颈+身体融合的一整块壳**）与 `tail`，另含十个表情壳变体（neutral、half-closed、eyes-closed、happy、mouth-open、worried、angry，外加组合通道渲出的 wail 哭丧脸、wink 单眼眨与 surprised 惊醒脸——表情壳取自 THA4 模型离线渲染的表情帧再超分，与主视觉同源同画风；half-closed 为眨眼通道三段映射的中间帧）。表情壳由「中性壳 + 该表情渲染的差异矩形（x744-1300,y235-1050）羽化贴入」烘焙而成——**壳与壳之间矩形外逐像素一致**，换脸/眨眼/交叉淡化在结构上不可能产生接缝。落盘 `src/renderer/pet-live2d/rig/`（`manifest.json`：char_bbox + 锚点：颈部 1018,621、尾根 1152,741、脚底 1018,955、抓取点 1018,330）。
- **接缝契约（隐藏式下刀）**：v1 沿可见轮廓撕件（头/身/尾三块），任意运动都会把羽化缝撕开——已废弃。v2 只在物理上藏得住的地方分割：①头身不分家，颈部不存在边界；②尾巴画在壳下，壳持有羽化边、尾巴向裙下垫 18px 不透明余量（旋转时仍被盖住）——opaque-under-feathered，合成恒为全透明度的主图像素；③表情差异全部在壳内部烘平，运行时无第二个可见边界。
- **渲染**：`drawRig` 逐帧组装 tail→shell；`RIG_STATES[name]` 是每状态的运动程序（sleep=绕脚底整转 ~57° 躺倒+闭眼+深呼吸，pick-up=绕抓取点摆锤悬挂+委屈脸+身体拉长垂头，eat=张嘴交替+头倾向饭碗，running=前倾+高频起伏，celebrate=眯笑弹跳，star=张嘴兴奋+程序化金色星瞳叠加等）。表情切换 = 整壳 140ms 交叉淡化（眨眼带内直通瞬切）。`stillCtl` 仍是状态持有器（name/target/alpha 门控语义不变），alpha 兼作新旧状态的参数插值权重。头部倾斜/点头参数折入整壳变换（chibi 全身微倾，等价表现）。
- **灵动不丢**：`stepPose()` 纯数学层照跑（不进模型），45 维 pose 通道映射为表情壳选择与运动偏移——眨眼、视线跟随、微小动作、打哈欠、困倦下垂全部沿用原逻辑；`star` 的星瞳是 pose 词汇表外唯一程序化绘制。表情壳一切切换（状态内交替与跨状态）都走 ~140ms 交叉淡化（`rigShell` 记 prev/cur/swapT，旧壳渐隐新壳渐入）——alpha 包络只插值数值参数，没有它脸部仍会在阈值点跳变；开场节拍用 `setStill` 记的 `rigStateT0` 入场时间戳（startle 惊醒、pick-up/eat/react-head 的 surprised 开场）。
- **清晰度**：部件源分辨率 ~10× 显示尺寸，原生锐利；ONNX 推理仅在 rig 资产加载失败时作为 fallback 运行（旧 webp 立绘路径保留为兜底），常态下 GPU 推理完全关闭。
- **清屏**：rig 路径每帧整幅 `clearRect`——脏矩形联合框在快速抛掷/姿态切换时漏清过旧墨迹（半透明尾影、竖直缝合线），透明分层窗上每次漏清都是可见碎片；整幅清屏在此画布尺寸下零成本且使残影在结构上不可能。旧立绘 fallback 路径保留原脏矩形。hover 命中用紧凑 `rigBodyRect`。
- **主循环韧性**：`loop` 帧体整体 try/catch——单帧异常曾直接杀死 rAF 链（`tickPhysics` 读 `entry.box` 撞上无盒的 `RIG_ENTRY`，抛出后循环永久停摆、画面冻结成半截尸）。rig 状态下的抛掷弹道改用 `rigCharBox()`（manifest `char_bbox` 合成等效墨迹盒）。

## Alternatives considered

- **逐姿势蒸馏 8 个 THA4 模型** — rejected：成本 ~5-8 天本机独占训练 + 输入图画风本身不源于待机形象，需先重画；且蒸馏产出的姿势仍由输入图决定，等于「会动的贴图」。
- **「无头身体 + 活体头合成」继续修补** — rejected（用户否决）：跨画风拼接的接缝是结构性缺陷，不是参数问题。
- **继续用旧 `states/*.webp` 立绘** — rejected（用户否决）：三种画风互不统一，且静态。
- **SVG 表情部件** — rejected：图像模型不产 SVG，手写 SVG 画不出软水彩；高清位图部件达到同等清晰度目标。

## Consequences

- 待机与全部动作状态**共享同一套像素**——画风漂移在结构上不可能发生；每个状态都是真程序动画（眨眼/视线/呼吸/部件运动），非贴图。
- ONNX/WebGPU 推理常态关闭：GPU 占用、加载耗时、每帧推理成本归零；`model.onnx` 保留作 fallback。
- 状态程序是数据式声明（`RIG_STATES` 表），新增状态 = 写一段运动程序 +（可选）新部件图。
- **已知局限**：没有"源图里不存在的部件"——举起的双臂、蜷缩睡姿躯干目前用整体变换近似（sleep 是整转躺倒+尾巴前卷示意蜷缩、pick-up 是站姿悬挂）；待图像生成服务恢复后补生成专件：manifest 的 `shells` 表兼作状态级整壳覆盖（`RIG_STATES` 里 `P.body='<key>'` 选用，缺件自动回落表情壳）。举臂整壳约定 key 为 `pickup`，代码已预接线——PNG 落进 `rig/` + manifest 加一行即生效，零代码改动。头部不再独立倾斜（头身融合换无缝）——用整壳微倾+表情变化补偿。星星瞳为程序化叠加而非眼部贴图。
- `states/*.webp` + `drawStill`/`loadStill`/`STILL_ANCHOR` 保留为 fallback 渲染路径，不再承担常态显示。
- 取代 `2026-09-20-pet-live-head-states`（合成头方案整路废弃）；`pet-states-regen` 的资产仍作为 fallback 立绘存在。
