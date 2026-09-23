# Decision: Pose stills become headless bodies + per-frame live THA4 head composite

Status: implemented

Archived: 2026-09-20

[中文](2026-09-20-pet-live-head-states.md) | English

## Problem

Earlier the same day, `pet-states-regen` replaced the ten pose images with high-resolution static art. User acceptance rejected it: static stickers diverge from the THA4 live render's style/proportions, and "the other actions should be as lively as the normal state, not a single image". The real requirements: sharper normal live output ("blurry"), and genuinely animated action states.

## Investigation

Three hard facts from live probing decided the design:

1. **Output size is baked in**: the ONNX contract is `[1,4,512,512]`, and feeding a 2.2×-upscaled `character.png` (scaled about the spec head point 256,128) produced an identical output alpha bbox (~124×172) — the model normalizes render scale to its training distribution, so bigger inputs do nothing.
2. **Non-canonical pose inputs collapse**: feeding `greet.webp` (raised arm) as the `image` input collapsed the output back to the canonical standing pose — the distilled model normalizes pose, so "swap input image to swap pose" does not work.
3. **But `image` is a per-frame runtime input**: `session.run({image, pose})` runs every frame, and live inference keeps running while a still is shown — the living head is already sitting in `outCanvas` every frame.

Retraining at higher resolution was ruled out: `C:\Ai\tha4`'s GUIDE states distillation takes ~8-10h on an RTX 4080, and the THA4 teacher chain caps at 512² anyway — cost/benefit doesn't hold.

## Decision

**Upgrade the hybrid layer to "posed body + live head"**:

- `states/*.webp` get their head regions erased offline (alpha-bbox fraction rects + 6px feather; originals backed up at `C:\Ai\pet-states-hd\states-with-heads\`), keeping only body/arms/props/tail.
- Inside the existing transform (physics `fx.rot`/`fx.sx`/strip sway), `drawStill` repaints the head zone every frame from `outCanvas`'s live head region (`HEAD_SRC`, x186-322/y56-196 of the 512 frame — hair through collar) at the `STILL_HEAD[name]` anchor (bbox fractions `[cx,cy,w]`; height follows HEAD_SRC aspect) — every state inherits blinking, gaze tracking, breathing and head micro-motion; drag physics and hang anchoring act on the composite head as before.
- `STILL_POSE[name]` expression programs overlay the 45-dim pose at the end of `stepPose`: sleep pins eyes shut + head droop + deeper breath, eat chews + gazes down at the cookie, pat squeezes eyes + wobbles the head, celebrate closed-eye smile + bounce, angry raises brows + head shake, etc. While a still dominates (alpha>0.4), idle micro-actions, tap reactions and sleepy droop all yield to avoid fighting the state program.
- Sharpness for the normal render: a bounded unsharp mask inside the rendered frame's alpha bbox (k=0.45, only RGB where alpha>96 — the model emits garbage RGB in transparent regions, and the silhouette's soft alpha ramp is untouched so no outer halo). Eyes/contours are measurably crisper.

## Alternatives considered

- **Retrain/re-export THA4 at higher res**: teacher chain caps at 512² + ~10h GPU — rejected.
- **Feed pose art as model input**: collapses to canonical pose (Investigation 2) — rejected.
- **Layered-cutout rig on the stills (mini-Live2D)**: single images can't be reliably segmented (occluded regions need inpainting); effort far exceeds payoff — rejected.
- **Pure pose programs + props/particles, no body art**: running legs, dangling carry, curled sleep — whole-silhouette changes the pose space can't express; too literal a loss. Body art + live head gets both.
- **Second-stage SR model (waifu2x-class ONNX)**: real detail but adds a binary dependency + second inference per frame; the dependency-free unsharp ships first, SR remains an optional follow-up.

## Consequences

- All ten states are alive: the face is always the same model render as the normal state — zero style drift; bodies keep literal poses.
- Regenerating `states/` assets now requires the head-erase step (`decapitate.py`) plus `STILL_HEAD` anchor calibration, or double-face/decapitation artifacts result — recorded as a feature-card invariant.
- Added per-frame cost: one ~24k-px unsharp (<0.5ms) + one head drawImage — negligible.
- Residual gap: bodies are crisp cel-style while heads are soft watercolor; the seam is not noticeable at 1× display size. Soft-style bodies could be regenerated later if wanted (pipeline unchanged).
- The earlier `2026-09-20-pet-states-regen` decision's "static stills" portion is superseded by this decision (its asset pipeline and prompts remain valid; an erase step was added).
