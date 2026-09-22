# Workbench Electron Design QA

## Scope

**Status:** passed. The packaged Electron app now clears the five-theme desktop page matrix and
the final typography, sizing, sidebar hierarchy, overflow, and runtime checks.

- Source visual truth: `C:\Ai\ChisaCode\design\web3-themes-v2.html`
- Normalized source capture: `C:\Ai\ChisaCode\.qa-tmp\web3-themes-v2-reference-normalized-1200x800.png`
- Implementation: packaged Electron at `C:\Ai\ChisaCode\packages\desktop\release-visual-qa\win-unpacked\ChisaCode.exe`
- Final implementation screenshot: `C:\Ai\ChisaCode\.qa-tmp\workbench-electron-pass4.png`
- Viewport: 1200 x 800 CSS pixels, device scale factor 1.5, 1800 x 1200 PNG
- State: light theme, populated workspace, Git environment tab open, real session/workspace data

## Evidence

- Full-view comparison: `C:\Ai\ChisaCode\.qa-tmp\workbench-reference-vs-electron-pass4.png`
- Header comparison: `C:\Ai\ChisaCode\.qa-tmp\workbench-focus-header-pass4.png`
- Environment comparison: `C:\Ai\ChisaCode\.qa-tmp\workbench-focus-environment-pass4.png`
- Composer comparison: `C:\Ai\ChisaCode\.qa-tmp\workbench-focus-composer-pass4.png`
- Post-interaction restored state: `C:\Ai\ChisaCode\.qa-tmp\workbench-electron-after-interactions.png`

## Findings

The final Electron captures contain no actionable P0/P1/P2 desktop differences.

- Fonts and typography: system font family, 13 px workbench body scale, compact metadata scale, line height, weight hierarchy, wrapping, and code typography are visually consistent with the source.
- Spacing and layout: the 200 px sidebar, 42 px title row, 38 px tab row, flat workspace canvas, bottom composer, and 240 px inspector with 8 px inset match the source composition. Real session and message content changes vertical density without changing the layout structure.
- Colors and tokens: rail, canvas, surface, border, muted text, blue accent, success, and danger colors map closely to the source light theme.
- Image and icon fidelity: this screen has no raster product imagery. Existing icon-library glyphs remain consistent and aligned; no placeholder or CSS-drawn image assets were introduced.
- Copy and content: source sample text is replaced by real localized application state. Labels are coherent and preserve the intended hierarchy.
- Responsiveness: no overlap, clipping, horizontal page overflow, or hidden persistent controls were visible at 1200 x 800.
- Accessibility and behavior: environment tabs expose tab roles, close/reopen controls expose button labels and expanded state, and the composer remains keyboard-focusable.

## Interaction Verification

- Switched the environment inspector from Git to Tasks and back to Git.
- Closed the environment inspector and reopened it from the workspace header.
- Activated `查看变更` and confirmed the real diff surface rendered 29 changed files and the current diff summary.
- Restored the environment inspector state after the interaction checks.
- Browser page errors checked: none.
- Browser console checked: no output.

## Comparison History

1. Pass 1: `C:\Ai\ChisaCode\.qa-tmp\workbench-reference-vs-electron-pass1.png`
   - Blocking issue: the ready workspace route could render an empty shell because a non-null React element wrapped a null gate.
   - Fix: added explicit route-content selection and a regression test, restoring the real workspace.
2. Pass 2: `C:\Ai\ChisaCode\.qa-tmp\workbench-reference-vs-electron-pass2.png`
   - P1/P2 issues: titlebar spacer, oversized sidebar/header/tab density, card-like assistant messages, wide composer, and environment inspector proportions differed from the source.
   - Fixes: removed the spacer, established 200/42/38/240 layout constants, flattened message/workspace surfaces, tightened typography and composer controls, and overlaid the inspector with the correct inset.
3. Pass 3: `C:\Ai\ChisaCode\.qa-tmp\workbench-reference-vs-electron-pass3.png`
   - P2 issue: a standalone resume row pushed recent activity too far down and the completion callout lacked its source status cue.
   - Fixes: moved resume into the callout title row, added success/interruption icons, and restored the activity divider and vertical rhythm.
4. Pass 4: `C:\Ai\ChisaCode\.qa-tmp\workbench-reference-vs-electron-pass4.png`
   - Post-fix result: no actionable P0/P1/P2 differences remain.

## Accepted Non-Blocking Differences

- P3: the primary environment action uses the product's solid blue button instead of the source's blue-violet gradient.
- P3: source tab glyphs and the app's Lucide/provider icons are not pixel-identical, but they preserve meaning, scale, and alignment.
- P3: sidebar scrollbar visibility and tab count reflect the real persisted QA dataset rather than the source mock data.

## Desktop Settings Five-Theme Matrix (2026-07-16)

Source and implementation were captured at the same 1200 x 800 CSS viewport and 1.5 device
pixel ratio. The comparison configuration is recorded in
`C:\Ai\ChisaCode\.qa-tmp\visual-fidelity\matrix.json`.

Only narrow text rectangles are masked for source sample values that intentionally differ from real
QA state: the selected theme label, terminal scrollback value, and host labels. Control borders,
icons, surfaces, dividers, background layers, and geometry remain compared.

| Theme            |    MAD | Pixels over channel delta 12 | Result |
| ---------------- | -----: | ---------------------------: | ------ |
| Blockchain Light | 1.5260 |                      2.2953% | passed |
| Cyber Dark       | 1.5580 |                      2.4313% | passed |
| Liquid Glass     | 1.9637 |                      2.7076% | passed |
| Chisaki          | 1.6806 |                      2.4053% | passed |
| Aemeath          | 1.3401 |                      2.3355% | passed |

Liquid Glass comparison evidence:

- Side by side: `C:\Ai\ChisaCode\.qa-tmp\visual-fidelity\output\liquid-glass-settings-final-side-by-side.png`
- Difference: `C:\Ai\ChisaCode\.qa-tmp\visual-fidelity\output\liquid-glass-settings-final-diff.png`
- Metrics: `C:\Ai\ChisaCode\.qa-tmp\visual-fidelity\output\liquid-glass-settings-final-metrics.json`

The Liquid Glass repair removed the Expo Router default background, moved the gradient through the
runtime inline-style path, restored the source shell/content/sidebar compositing layers, removed the
extra settings-card blur, and restored the source frame border. Desktop settings are complete; the
desktop workbench five-theme matrix is complete. Android-native matrices remain open.

## Full Desktop Page Matrix (2026-07-16)

- Final connected-state evidence: `C:\Ai\ChisaCode\.qa-tmp\ui-polish-2026-07-16-final2`
- Forced-offline welcome evidence: `C:\Ai\ChisaCode\.qa-tmp\ui-polish-2026-07-16-onboarding`
- Coverage: 5 themes x 21 Electron-accessible pages = 105 validated combinations
- Connected-state runtime errors: 0
- Body horizontal overflow: 0
- Text below 11 px: 0
- Low line-height findings: 0
- Visual review: no incoherent overlap, clipped persistent controls, or unstable layout shifts

The route list includes workspace, new workspace, open project, sessions, the legacy agent redirect,
settings root, every desktop settings section, host settings, project list/detail, and welcome. The
native camera scan route is not an Electron product surface and remains outside this desktop result.

## Desktop Follow-up Regression QA (2026-07-17)

- Workspace tab widths were raised to a 160-220 px responsive range. The packaged Electron capture
  shows the complete `新项目入口` and `修复 dock 状态` titles without the previous premature
  truncation.
- The Windows controls overlay reports `{ x: 0, y: 0, width: 1064, height: 29 }` inside a dedicated
  30 px titlebar row at the validated 1200 x 800 viewport. The final row pixel remains renderer-owned,
  so the divider is continuous below minimize, maximize, and close.
- Clicking a different sidebar session changed the active title but preserved the complete ordered
  session ID array. A pointer drag changed only the two dragged rows, and a second drag restored the
  original order. Activity timestamps no longer reorder project groups or sessions.
- Focused verification: 3 Vitest files / 28 assertions passed, targeted lint reported 0 warnings and
  0 errors, App and Desktop typechecks passed, and `git diff --check` passed.
- Evidence: `C:\Ai\ChisaCode\.qa-tmp\topbar-session-order-followup.png`,
  `C:\Ai\ChisaCode\.qa-tmp\topbar-desktop-fixed-full-dpi.png`, and
  `C:\Ai\ChisaCode\.qa-tmp\topbar-desktop-fixed-crop-dpi.png`.
- The shared topbar regression was repeated across all five product themes. Both target tabs measured
  160 px in every theme with `scrollWidth <= clientWidth`, and the native-control divider remained
  continuous. Contact sheet:
  `C:\Ai\ChisaCode\.qa-tmp\topbar-five-themes-contact-sheet.png`.

## Android Follow-up Status (2026-07-17)

- A current release APK was built successfully from the present worktree:
  `C:\Ai\ChisaCode\packages\app\android\app\build\outputs\apk\release\app-release.apk`.
- A physical Xiaomi `23124RN87C` device running Android 15 is connected over ADB.
- Installation is currently waiting on the device's MIUI USB-install authorization. The package
  manager returned `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`, so no Android visual
  result is claimed yet.

## Platform Boundary

Android native visual QA was not performed in this pass. No Android/device validation is claimed, and browser rendering is not used as a substitute.

final result: passed
