# Decision: Pet rendering moves to an HD part rig

Status: implemented

Archived: 2026-09-20

[中文](2026-09-20-pet-part-rig.md) | English

> Supersedes [2026-09-20-pet-live-head-states](../../archived/product/2026-09-20-pet-live-head-states.en.md)

## Problem

Two approaches were rejected by the user in the same day:

1. `pet-states-regen` static art — still images, not alive.
2. `pet-live-head-states` "headless body + live THA4 head" compositing — the cel-shaded still bodies visibly clashed with the soft-watercolor live head, the rectangular head erase cut through hair accessories, and the user judged it a pasted-sticker workaround.

The user's final requirement: **the idle form (soft watercolor, lively) is the target; every other action must be redrawn and split FROM it** — not another variation of a sticker pipeline.

## Investigation

- **THA4 distillation ceiling**: model I/O is baked at 512² (effective character area ~124×172); feeding a larger image leaves the output bbox unchanged; feeding a pose image collapses back to the standing pose — "swap input image for pose" does not work.
- **Per-pose distillation**: the `C:\Ai\tha4` pipeline is complete (8 pose input images + configs + cloud packaging script), but a 3060 Laptop measures ~20h per pose — ≈ a week of dedicated GPU for the full set; and the pose input art is itself a different style (hard lineart, saturated), which distillation would faithfully reproduce — redrawing inputs costs the same effort as cutting parts directly.
- **imagegen SVG is impossible**: gpt-image-2.5 emits rasters only; true SVG would require hand-written markup, which cannot reproduce soft watercolor. The equivalent goal is met with high-resolution raster parts (source resolution ≥10× display size — clarity equivalent to vector).

## Decision

**The character is now a part puppet split from one 2048² HD master; all rendering is procedural**:

- **Assets**: `avatar/character.png` (the idle source art itself) upscaled 4× via Real-ESRGAN anime to a 2048² `master`; parts are cut programmatically into `shell` (**head+neck+body fused as ONE opaque piece**) and `tail`, plus ten expression shell variants (neutral, half-closed, eyes-closed, happy, mouth-open, worried, angry, plus composite-channel renders `wail`, `wink`, `surprised` — shell variants come from THA4 offline expression renders upscaled the same way; half-closed is the middle frame of the blink channel's three-band mapping). Each variant is baked as neutral-shell + the render's face-rect (x744-1300, y235-1050) feathered in — **outside that rect every shell is pixel-identical**, so swaps/crossfades can never produce a seam. On disk at `src/renderer/pet-live2d/rig/` (`manifest.json`: char_bbox + anchors: neck 1018,621, tail root 1152,741, feet 1018,955, grab 1018,330).
- **Seam contract (hidden-cut only)**: v1 split along VISIBLE contours (head/body/tail) — any motion tore the feathered seam open. Retired. v2 splits only where the boundary is physically hidden: ① head and body are one piece — no neck boundary exists; ② the tail draws UNDER the shell — the shell owns the feathered edge and the tail underlaps 18px opaque beneath it (still covered mid-rotation) — opaque-under-feathered composites to full alpha with master pixels; ③ all expression differences are baked inside the shell — no second visible boundary at runtime.
- **Rendering**: `drawRig` assembles tail→shell per frame via pivot + rotate/scale/translate; `RIG_STATES[name]` is the per-state motion program (sleep = whole-rig ~57° rotation about the feet + closed eyes + deep breath, pick-up = pendulum about the grab point + worried face + stretched drooping body, eat = alternating open mouth + lean toward the bowl, running = forward lean + fast bob, celebrate = happy bounce, star = excited face + procedural gold star pupils, etc.). `stillCtl` remains the state holder (name/target/alpha gating semantics unchanged); alpha doubles as the lerp weight between idle and state params. Head tilt/bob channels fold into the whole-shell transform (a chibi tilts as one unit — equivalent read).
- **Liveliness preserved**: `stepPose()` still runs as pure math (no model call); the 45-dim pose channels map to expression-shell selection and motion offsets — blink, cursor gaze, micro-acts, yawn and sleepiness all reuse the original logic. Star pupils are the only procedurally drawn overlay the pose vocabulary lacks. Every shell swap — mid-state alternation and state transitions alike — crossfades over ~140ms (`rigShell` tracks prev/cur/swapT; the outgoing shell fades out under the incoming one): the alpha envelope only lerps numeric params, so without it the face would still pop at the discrete flip. Entry beats use the `rigStateT0` timestamp recorded by `setStill` (startle wake beat, surprised openings for pick-up/eat/react-head).
- **Clarity**: part sources are ~10× the display size — natively sharp; ONNX inference only runs as the fallback when rig assets fail to load (the old webp still path is kept as that fallback), so GPU inference is fully off in the normal path.
- **Clearing**: the rig path full-clears the canvas every frame — the dirty-rect union leaked stale ink on fast throws and pose swaps (semi-transparent tail ghosts, vertical splice lines), and on a transparent layered window every miss is a visible artifact; one `clearRect` at this canvas size is ~free and makes ghosts structurally impossible. The legacy stills fallback keeps its dirty-rect path. Hover hit-testing uses the tight `rigBodyRect`.
- **Loop resilience**: the `loop` frame body is wrapped in try/catch — a single frame exception used to kill the rAF chain outright (`tickPhysics` reading `entry.box` hit the box-less `RIG_ENTRY`, leaving the pet frozen mid-pose until reload). Rig-state throws now compute ballistic bounds from `rigCharBox()` (the manifest `char_bbox` as an equivalent ink box).

## Alternatives considered

- **Distill 8 per-pose THA4 models** — rejected: ~5-8 days of dedicated local training, the pose input art is not sourced from the accepted idle look and would need redrawing anyway, and distilled poses remain whatever the input image shows — effectively "animated stickers".
- **Keep patching "headless body + live head" compositing** — rejected (by the user): the cross-style seam is structural, not a tuning problem.
- **Keep the old `states/*.webp` stills** — rejected (by the user): three inconsistent art styles, and static.
- **SVG expression parts** — rejected: image models don't emit SVG and hand-written SVG can't render soft watercolor; HD raster parts achieve the same clarity goal.

## Consequences

- Idle and every action state **share the same pixels** — style drift is structurally impossible; every state is real procedural animation (blink / gaze / breathing / part motion), not a sticker.
- ONNX/WebGPU inference is off in the normal path: GPU usage, model load time, and per-frame inference cost drop to zero; `model.onnx` stays as the fallback.
- State programs are declarative (`RIG_STATES` table); a new state = one motion program + (optionally) a new part image.
- **Known limits**: parts that don't exist in the source art are approximated by whole-rig transforms (sleep is a rotated lie-down with the tail curled forward to suggest curling up, pick-up is a standing hang); dedicated pose shells can be generated once the image service recovers: the manifest `shells` table doubles as the state-level override (`P.body='<key>'` in `RIG_STATES`, auto-fallback to the expression shell when absent). The raised-arms shell is pre-wired under the key `pickup` — dropping the PNG into `rig/` plus one manifest line activates it with zero code change. The head no longer tilts independently (fused for seamlessness) — compensated via whole-shell tilt + expression motion. Star pupils are a procedural overlay, not an eye texture.
- `states/*.webp` + `drawStill`/`loadStill`/`STILL_ANCHOR` remain as the fallback render path only.
- Supersedes `2026-09-20-pet-live-head-states` (the composite-head approach is fully retired); `pet-states-regen`'s assets remain as the fallback stills.
