# Agent Note: Composer beam settings

Status: implemented

English | [中文](2026-09-07-composer-beam-settings.zh.md)

## Problem

The Interface settings page could only turn the running composer beam on or off. Users could not tune the effect's motion or visual weight, while the existing beam geometry is tightly pinned by corner coverage, pointer hit-testing, and composer-stack clearance tests.

## Decision

Keep the existing Switch and add a settings icon that opens the shared `Modal`. The modal edits a draft with clockwise/counterclockwise direction, rotation period, overall intensity, bloom intensity, and global hue offset. A local preview renders the same beam classes and CSS variables as `InputBar`; Save persists the complete value to `ui-conversation.composerBeamStyle`, Cancel discards the draft, and Reset restores the pre-feature rendering.

Customization is deliberately limited to CSS variables. The 2px stroke, 1.5px bloom source, 4px clip shell, 8px blur, 22px circular corners, masks, and conic intensity windows remain fixed. The feature does not introduce focus, typing, completion, or error lighting states from the external reference implementation.

## Alternatives considered

**Port the reference implementation's complete ambient-light state machine.** Rejected because focus, typing, completion, error, night mode, and arbitrary color stops create new product states and a second visual palette beyond the existing thinking beam.

**Build a simplified preview with separate CSS.** Rejected because it could drift from the live composer. The modal and `InputBar` instead render the same `ComposerBeam` component and variable mapping.

## Consequences

Old settings documents remain valid because the style field is optional and adopts the exact historical defaults. The settings row and every mounted composer share one `ComposerSubmissionPolicy` snapshot source, so a saved value updates live without a reload. Reduced motion still hides the entire beam and preview.

## Testing

Component tests cover opening, draft edits, Reset, Cancel, Save, disabled Host state, and accessible labels. Policy and Host tests cover default adoption, normalization, publication-before-persist, schema validation, and slot wiring. The focused suite passed 130/130 tests, the full GUI suite passed 5,361 tests with one skip, the official profile build passed, and the Electron Chromium corner gate passed at the default and configured extrema.
