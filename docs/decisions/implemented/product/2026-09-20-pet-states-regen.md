# Decision: 桌宠静息立绘全套重绘（AI 生成管线）

Status: implemented

中文 | [English](2026-09-20-pet-states-regen.en.md)

> 更新（2026-09-20）：主渲染已由部件木偶接管（见 [2026-09-20-pet-part-rig](../../archived/product/2026-09-20-pet-part-rig.md)），本文所述 states 立绘降级为 ONNX fallback 路径的渲染资产，管线记录仍然有效。

## Problem

`src/renderer/pet-live2d/states/` 的十张静息立绘来自社区 dsh-whale-musume 素材集（512×512）。`tail-swing.webp` 与 `react-head.webp` 右侧带整幅绿色矩形残块（chroma 底未清干净），其余八张虽造型完整但分辨率偏低，用户判定「不够高清、非默认姿势变形」。

## Decision

不再沿用外部素材集，改为以 `avatar/character.png`（THA4 底图、身份基准）为唯一参考图，用 `imagegen25.py` 的 `edit` 模式（gpt-image-2.5）逐姿势重绘全部十张：pick-up / running / eat / sleep / react-head / angry / celebrate / star / greet / tail-swing。产物 1254² RGBA，经 PIL 校验 alpha 直方图后转 webp q90 落盘原位。姿势语义沿用各状态既有构图；`running` 从「抱笔记本工作」改为真实奔跑（代码语义本来就是跑去投喂点/光标）。`character.png` 不换——THA4 模型输入分辨率固定，换高清底图不提升动画质量。渲染侧注释里的素材出处同步改为新管线。

## Alternatives considered

只重画两张坏图、其余八张原图放大：分辨率仍是补出来的伪高清，且混合两代素材的笔触一致性差；放弃。内置 `image_gen` 工具/官方 `image_gen.py`：本会话第三方 provider 未注册内置工具，官方脚本白名单只认 gpt-image-2，均被本机 AGENTS 规则指向 `imagegen25.py`。

## Consequences

十张图同一参考源，身份一致性显著好于旧集；总体积 ~2.0MB（原 ~0.8MB），懒加载+按需缓存，开销可接受。旧姿势语义全部保留（锚定仍走 alpha bbox）。以后改姿势直接改 `C:\Ai\pet-states-hd\prompts\*.txt` 重跑即可，管线参数记录在提示词与本文档。素材不再是第三方 MIT 授权资产，去掉了再分发署名的必要。
