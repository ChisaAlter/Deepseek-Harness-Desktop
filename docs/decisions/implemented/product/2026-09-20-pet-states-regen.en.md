# Decision: Regenerate the full pet still-pose set (AI pipeline)

Status: implemented

[中文](2026-09-20-pet-states-regen.md) | English

> Update (2026-09-20): the primary renderer is now the part rig (see [2026-09-20-pet-part-rig](../../archived/product/2026-09-20-pet-part-rig.en.md)); the still poses described here are demoted to render assets for the ONNX fallback path. The pipeline record stays valid.

## Problem

The ten still poses in `src/renderer/pet-live2d/states/` came from the community dsh-whale-musume asset set at 512×512. `tail-swing.webp` and `react-head.webp` carried whole-frame green chroma residue blocks, and the remaining eight were intact but low resolution — the user judged the set "not HD, non-default poses deformed".

## Decision

Drop the external asset set. Regenerate all ten poses with `imagegen25.py` in `edit` mode (gpt-image-2.5) using `avatar/character.png` (the THA4 base and identity reference) as the sole input image: pick-up / running / eat / sleep / react-head / angry / celebrate / star / greet / tail-swing. Outputs are 1254² RGBA, alpha-histogram-checked in PIL, then written in place as webp q90. Pose semantics keep the existing compositions; `running` changes from "typing on a laptop" to an actual run (its code semantics were always run-to-bowl / run-to-cursor). `character.png` stays — the THA4 model's input resolution is fixed, so a larger source would not improve animation quality. The renderer comment's asset provenance note was updated to the new pipeline.

## Alternatives considered

Regenerating only the two corrupted images and upscaling the rest: upscaling is fake HD and mixing two asset generations hurts stroke consistency — rejected. Built-in `image_gen` / official `image_gen.py`: the session's third-party provider does not register the built-in tool, and the official script's whitelist only accepts gpt-image-2 — local AGENTS rules already point at `imagegen25.py`.

## Consequences

One shared reference gives far better identity consistency than the old set. Total ~2.0MB (was ~0.8MB); stills are lazy-loaded and cached on demand, so the cost is acceptable. Anchoring still runs on the alpha bbox, so all pose semantics are preserved. To change a pose later, edit `C:\Ai\pet-states-hd\prompts\*.txt` and rerun; the pipeline parameters live in those prompts and this note. The art is no longer third-party MIT-licensed, so no redistribution attribution is needed.
