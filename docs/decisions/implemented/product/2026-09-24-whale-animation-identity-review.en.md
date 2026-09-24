# Decision: Gate whale animation expansion on idle-master identity

Status: implemented

[中文](2026-09-24-whale-animation-identity-review.md) | English

## Problem

The companion had few actions and expressions. Key-pose candidates generated for 24 actions and 12 expressions from `avatar/character.png` still showed larger heads and eyes, sharper linework, and changed clothing or tail shapes at roughly 130px desktop height. Some eating atlases had clipping or frame drift. Switching to them would visibly change the character.

## Decision

- Keep the idle master as the sole identity source. Extend THA4 live deformation to 24 action semantics and 12 pose-space expression mappings. Drag and throw continue to use actual pointer velocity and ballistic physics; playback is not a fixed four-frame loop. Common paths now cover entering sleep, waking, four feeding stages, poking, patting, swimming, and ambient gestures.
- After 3 minutes 45 seconds of inactivity, show drowsiness before the four-minute sleep transition; interaction interrupts dozing. Gate autonomous shyness and sadness on affection and mood so expressions fit her state.
- On 2026-09-25, revert the floating-bowl and extra airborne-expression trials. The bowl covered the apron without any hand-held eating pose; the airborne change was only a small facial variation. Neither met the requested readable full-body performance, so neither counts as a completed action.
- Keep ImageGen candidates in `docs/qa/whale-animation-review/candidates/` and mark their manifest entries as failing identity review; they do not enter production drawing. `review.html`, `review-screen.png`, and the Electron capture `review-live/contact.png` record comparisons. A single key pose or whole-image sway is not a complete frame animation.
- A whole-body 360° foot-pivot rotation clipped the character at the screen bottom. After visual review, replace it with model head/body turning and a small planted sway. Approve any later atlas only after desktop-size identity, silhouette, boundary, and playback review.

## Alternatives considered

- Directly use ImageGen key poses — rejected: identity drift remains visible at desktop size, and one image cannot express a complete action.
- A strictly limited retry that only closed the eyes, lowered the head, and relaxed the tail kept roughly the same normalized character bounds, but redrew the face and soft pixel brushwork and produced widespread low-alpha edge noise, so it too was rejected.
- Use a fixed four-frame atlas — rejected: fast throws and slow breathing need different sampling, and it would lose the original model's ongoing blinking and gaze.

## Consequences

- Idle, sleep, feeding, and interactions continue to come from one model, so the face, costume, and tail do not switch art styles. Effective frame rate follows device inference capacity and display scheduling; motion interpolation is not locked to four frames.
- THA4 cannot reshape arms and skirts into an entirely new composition. Sleep still relies largely on closed eyes and a whole-body side turn, while feeding relies largely on facial motion and the bowl scene. Some of the 24 semantics are callable programs without a separate user trigger; these are not 24 approved frame-art sets. Later redraws must pass per-frame identity and playback review.

## Validation

- After the rollback, `node --test src/main/desktop-live2d.test.js src/renderer/pet-live2d.test.js` passes 84/84. These tests check the state machine and renderer interfaces, not visual art quality; the earlier 86/86 count was wrongly used to support a visual-delivery claim.
- Electron/CDP capture: `docs/qa/whale-animation-review/review-live/contact.png` compares all 24 actions and 12 expressions, confirms master identity, and exposed the turn clipping that was then fixed; all 36 transparent animated WebP previews have nonempty frames and at least 42px of edge clearance.
- The feeding and throwing recordings in `review-live/choreography/` have no blank or clipped frames, but still failed visual review. Retain them as rejected evidence, not production animation; technical frame checks cannot replace art judgment.
