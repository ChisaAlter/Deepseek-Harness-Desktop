# Decision: Pet rendering returns to the THA4 live engine + Anime4K real-time upscaling (live-first dual engine)

Status: implemented

[中文](2026-09-20-pet-live-first-dual-engine.md) | English

> Supersedes [2026-09-20-pet-part-rig](../../archived/product/2026-09-20-pet-part-rig.en.md)

## Problem

The `pet-part-rig` HD part puppet was rejected in live user acceptance: rigid part transforms (whole-image rotate/scale/translate) are structurally a "paper puppet" — the tail read short, the body never deforms, and it was "less alive than the original blurry locally-trained version". Multiple rounds of seam fixes (feathered backing, fused shells, stem burial) only fixed seam visibility; they cannot change what rigid transforms are. The user explicitly demanded a new approach: liveliness comes from THA4's per-frame deformed rendering, which no composited-art scheme can simulate.

## Decision

**The renderer goes back to a "live-first" dual engine**:

- **Primary engine = THA4 live inference**: `stepPose()`'s 45-dim pose channels (breathing, gaze, blinking, sleepiness, micro-actions, drag squeeze, tap reactions) feed the model every frame, producing a fully deformed frame — the native source of liveliness. Init order is reversed: build the ONNX session first (webgpu→wasm); rig assets load only as a fallback when live init fails.
- **Real-time upscale = Anime4K WebGL shaders** (`pet-live2d/anime4k.js`, MIT, monyone/Anime4K.js 1.1.3, preset `ANIME4KJS_SIMPLE_M_2X`): the THA4 crop 390×492 → 2× to 780×984, measured median **0.6ms/frame**. On the RGB side the crop gets two blur-bleed passes (destination-over) so transparent-black edges can't smear a dark halo through the CNN; alpha takes a plain bilinear upscale composited destination-in afterwards — feathered edges stay clean because alpha is smooth.
- **State layer = pose channels + whole-frame transforms**: `LIVE_STATES[name]` programs write pose-channel targets (sleep=eyes closed+head sag+deep breath, pick-up=wide-eyed surprise→troubled squeeze+wail beats, eat=opening delight→chewing, react-head="huh?"→melt into happy, angry=furrowed brows+fuming shake; celebrate/star/greet/startle/tail-swing/running each have channel recipes) plus whole-frame transforms (`liveFx.rot/dx/dy/sx/sy/pivot`) — sleep rotates about the feet to lie down, pick-up pendulums about the grab point, celebrate bounces. State changes are weighted by the `stillCtl.alpha` envelope: pose space is continuous so the **face morphs instead of crossfading textures**. `star`'s star pupils are the only procedural draw outside the pose vocabulary.
- **Paced inference**: `renderFrame` schedules on a ~50ms gap (110ms in power-saving) — measured WebGPU median 33.8ms / p90 35.9ms, ~18fps effective refresh; pose math and whole-frame transforms still run every rAF, so translation/rotation/expression lerps tween at display rate.
- **VRAM fix**: `session.run()` output tensors are disposed every frame (previously leaked ~1MB per frame); the non-GPU path reuses one pose CPU tensor instead of allocating per frame.
- **Clear**: full-canvas `clearRect` — carried over from the rig era: the dirty-rect union missed old ink during fast throws/state flips (translucent ghosts), and every miss on a transparent layered window is a visible artifact.
- **Fallback chain**: live engine → rig puppet → legacy `states/*.webp` stills, degrading level by level; the `LIVE_ENTRY`/`RIG_ENTRY` marker entries keep `stillCtl` gating, hit-testing, and the throw ballistic box (`liveCharBox`/`rigCharBox`) uniform across all three engines.

## Alternatives considered

- **Keep patching the part rig** — rejected (user veto): seams can be made pixel-clean, but rigid part transforms cannot produce deformation liveliness — an architectural property, not a parameter problem.
- **Per-frame Real-ESRGAN ONNX upscale** — rejected: the exported realesr-animevideov3 measured 1393ms (PReLU build) / 252ms (ReLU re-export) per frame in-browser — an order of magnitude slower than THA4 itself, unusable at frame rate; both exports were removed from `pet-live2d/`.
- **WebNN inference** — rejected: WebNN is unsupported in the runtime environment (probe fails), so no EP exists.
- **Per-pose THA4 distillation** — rejected (recorded earlier): ~20h/pose of dedicated local GPU plus input art in the wrong style that distillation would faithfully reproduce.
- **Re-pasting static stills** — rejected (user veto): three inconsistent art styles and fully static; this decision exists specifically to replace them.

## Consequences

- **Gains**: idle liveliness returns to the user-approved original level (deformed rendering, continuous hair/eyelid/breathing); seams are structurally impossible (one texture per frame); the tail returns to master length; expression changes are true morphs, not crossfades.
- **Costs**: sleep/carry poses remain whole-frame rigid transforms — at the silhouette level it is still "one image rotating", rescued by continuous in-frame deformation (breathing, expression beats); that is the inherent ceiling of THA4 not expressing full-body poses. GPU inference stays resident (~34ms per 50ms scheduling window). Anime4K.js is a vendored 9.4MB UMD (all shader weights inline). The SR output is still downscaled back to 240×260 at draw time — sharpness gains concentrate on interior line art, not the silhouette.
- **Risks**: Anime4K init failure silently degrades to the raw frame (`srReady=false` — usable, just softer); ONNX session failure falls back to the rig. Both paths exit through the same `paint()` outlet — no divergent draw paths.
