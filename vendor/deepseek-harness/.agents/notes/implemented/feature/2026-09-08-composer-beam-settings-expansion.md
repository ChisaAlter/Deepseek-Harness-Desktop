# Agent Note: Composer beam settings expansion

Status: implemented

English | [中文](2026-09-08-composer-beam-settings-expansion.zh.md)

## Problem

The first Composer beam settings pass exposed only direction, period, intensity, bloom, and hue. The reference implementation also demonstrated bounded motion profiles, palette choices, night dimming, and reusable presets, but its state-light system does not belong to DSHD's single thinking-beam contract.

## Decision

Extend the existing `ComposerBeamStyle` and keep `ComposerBeam` as the sole renderer for both the live InputBar and the Settings preview. The first batch adds ping-pong motion, a `0.8-60s` period range, optional breathing, and configurable hue cycling. The second batch adds legacy/lounge/aurora/reactive/custom visual profiles, eight built-in palettes, validated `2-6` color custom palettes, `0.5-4px` track width, `0-12px` bloom blur, local-clock night dimming, whitelisted easing, and up to five named presets.

`legacy` preserves the existing visual baseline: the 1.5px bloom source, 4px shell, 22px corners, masks, intensity windows, and default timing remain unchanged. Track width changes only the stroke ring padding; blur changes only the bloom container. Modes are visual profiles, not business-state machines, and no focus, typing, send, done, or error lights are added.

Active style and presets are persisted together through one `SettingsScope.mutate()` revision fence. JSON exchange uses a versioned `dsh-composer-beam` envelope, rejects invalid core/version, unsafe colors, invalid preset names/counts, and inputs above 64 KiB, while unknown fields are ignored. Import changes only the draft until Save; failed writes keep the draft and report the localized error.

## Consequences

Old five-field style documents remain loadable because Host schema defaults and client normalization fill the new fields. Reduced motion still hides the entire beam. Desktop customization does not alter mobile/web defaults, the InputBar activation condition, pointer hit-testing, composer stack gap, toolbar/Stop behavior, or the static rim.

## Testing

The focused beam/settings suite passes 116/116 tests across seven files, including old-shape Host migration, normalization, night windows, JSON bounds, renderer variables, atomic persistence, and CSS behavior. The ui-conversation TypeScript no-emit, full client build-mode check, package-mode verification, and official profile build pass. The full GUI suite passes 420 files with 5,496 tests passed and one skipped; desktop direct Node tests pass 1,447 with two Windows-specific skips. Fork marker tests pass 10/10. The direct Electron Chromium corner gate passes at the default geometry and configured extrema; all eight palettes remain visible without corner failures or out-of-bounds pixels.

The repository-wide UI i18n scan still reports 25 pre-existing hard-coded strings outside this feature. The repository-wide translation pairing check also reports existing unrelated documentation drift. The planned web replay run was stopped after widespread fixture/connection failures in unrelated chat, settings, image, catalog, and HMR suites; no beam-specific failure was observed.

## Scope boundary

This note supersedes the 2026-09-07 note only for bounded palette customization and night dimming. The external reference's focus/typing/blur/send/working/done/error state-light matrix remains explicitly out of scope.
