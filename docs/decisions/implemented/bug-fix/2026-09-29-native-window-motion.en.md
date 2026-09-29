# Decision: Restore native Windows shell composition and guard window motion

Status: implemented

[中文](2026-09-29-native-window-motion.md) | English

## Problem

Maximize and minimize animations repeatedly disappeared. Git stash `3d22cd024d9` on September 15 already noted that transparent windows broke DWM animations; the September 23 pre-sync local snapshot `abe95b0dac3` introduced `transparent: true` again for main and launcher windows. Upstream did not delete an animation implementation. Existing gates checked page radii and geometry, not native window styles, while decisions required transparent silhouettes and made the regression look intentional.

On the local Electron runtime, system animations were enabled but the old shell windows lacked `WS_CAPTION` / `WS_THICKFRAME`. Native maximized-state tests could still pass, proving that dimensions or `isMaximized()` alone are insufficient. Adding HWND style checks made `node scripts/run-window-motion-qa.mjs` fail on the old implementation and pass with opaque windows.

Existing-decision audit: [chrome self-healing](2026-09-25-window-chrome-self-heal.en.md), [silhouette edge ring](2026-09-25-window-silhouette-edge-ring.en.md), [OS corner mask](2026-09-27-transparent-window-os-corner-mask.en.md), and [20px corners](../product/2026-09-27-shell-window-corner-radius-20.en.md) partially overlap. This decision supersedes their requirement for transparent, page-shaped Windows main and launcher windows. Injection self-healing, non-Windows silhouettes, inner content corners and transparent overlays remain valid. No record is fully superseded.

## Decision

- `shellWindowChrome` centralizes main/launcher policy: Windows uses `transparent: false`, `thickFrame: true`, `roundedCorners: true`; transparent pets and overlays retain `windowChrome`. Caller options cannot override the policy; tests also inspect the final factory options to catch later overrides.
- Windows owns the outer edge and transitions, respecting system animation settings. IPC state carries `nativeFrame`; boot, launcher and injected Harness outer layers remove their second radius clip/ring. Inner content corners, wallpaper and transparent themes remain unchanged. Native windows never use geometric maximization; the legacy fallback applies only to registered transparent windows.
- Add the `window-motion` feature card and always-on rule, linked from root AGENTS, design language, motion, handbook, QA and Harness sync. Earlier records explicitly mark their Windows portion superseded.
- Unit tests guard policy, final options from both production factories and edge CSS. Windows CI runs isolated Electron QA through real factories, preload and authorized IPC, reads HWND styles, and checks maximize/unmaximize, minimize/restore and normal bounds. It uses a temporary profile without starting Harness or changing user data/system preferences. Visible interpolation has separate interactive frame-by-frame acceptance; CI state checks must not stand in for it.

## Alternatives considered

- Keep transparency and add only `thickFrame: true`: transparency itself changes native styles, so one option does not guarantee system transitions. Reject prioritizing fixed 20px outer corners over native behavior.
- Interpolate `setBounds` in JavaScript or scale the page: this could mimic motion but would diverge from taskbar restoration, system commands and accessibility settings. Content scaling is not window composition; reject a parallel animation implementation.
- Add only documentation or maximized-state tests: cheap, but the old implementation already passes state checks. Use layered checks of options, HWND styles, actual IPC and visible transitions.

## Consequences

Windows shell windows regain the native styles, state and restoration path required for system transitions. Outer corners follow the installed Windows version and no longer promise a fixed 20px radius. Non-Windows silhouettes and pet transparency remain unchanged. On CI without animations or an interactive desktop, the test certifies structure and state without enabling animations; visible transitions require interactive desktop verification. Results live in the [window-motion card](../../../features/window-motion.md) and its QA sources.
