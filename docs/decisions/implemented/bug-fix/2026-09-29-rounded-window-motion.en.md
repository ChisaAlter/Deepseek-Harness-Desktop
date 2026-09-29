# Decision: Preserve both 20px transparent corners and native Windows motion

Status: implemented

[中文](2026-09-29-rounded-window-motion.md) | English

## Problem

The maximize/minimize fix made Windows shell windows opaque and removed the page's outer radius, replacing the established 20px silhouette with smaller system corners. The user explicitly reported and rejected this regression. The previous verification proved motion and native state but missed the appearance contract.

Transparent Electron windows lack `WS_CAPTION | WS_THICKFRAME` on their actual HWND even with `thickFrame: true`. An isolated local experiment proved that restoring these styles after construction and refreshing the non-client frame preserves both the alpha silhouette and DWM motion; the two requirements do not require a tradeoff.

The user's next screenshot exposed a second omission: restoring styles made DWM paint a rectangular non-client surface outside the page alpha. Previous `capturePage` checks and local crops missed full desktop composition. The desktop four-corner probe consistently failed on the old implementation (outside pixels differed from the backdrop, sometimes filled white) and recovered transparency after disabling non-client rendering; `DWMWA_BORDER_COLOR=NONE` alone had no effect. At 150% DPI the original 1 CSS px ring occupied 1.5 physical pixels; it is reduced to one physical pixel to soften the visible staircase.

Scale verification also exposed that Electron transparent-window `maximize()`/`isMaximized()` can represent only work-area geometry: at 150% Electron returned true while Windows `IsZoomed` remained false, and a forced 125% scale returned false due to a one-DIP rounding difference. Earlier recordings called system ShowWindow directly and did not prove the button's IPC path. The new IsZoomed assertion failed before the fix and passed after native state requests replaced that path.

Existing decision audit: the [native motion fix](2026-09-29-native-window-motion.en.md) partially overlaps; this decision replaces its opaque-window, system-corner and `nativeFrame` page overrides while retaining native-state and HWND gates. [Chrome self-healing](2026-09-25-window-chrome-self-heal.en.md), [silhouette edge ring](2026-09-25-window-silhouette-edge-ring.en.md), [OS corner mask](2026-09-27-transparent-window-os-corner-mask.en.md) and [20px corners](../product/2026-09-27-shell-window-corner-radius-20.en.md) partially overlap; their transparent silhouette and edge ring apply again. No record is wholly superseded.

## Decision

- Main and launcher windows retain `transparent: true`, `roundedCorners: false` and a transparent background. Boot, Harness and launcher recover their existing 20px page corners and edge ring, reduced to zero when maximized.
- Before showing a window, `native-window-motion.js` synchronously restores caption/thick-frame styles on its HWND by OR-ing only the required bits. Refreshing does not change size, position, focus or Z order. Windows uses actual maximized state; other platforms and pets do not load the bridge.
- Window-control maximize/restore calls `ShowWindowAsync(SW_MAXIMIZE / SW_RESTORE)` and uses `IsZoomed` for state and toggle direction, bypassing Electron transparent-window geometry maximization. Registered HWNDs and their API bindings live in a WeakMap; other windows retain their existing path. Recordings trigger real IPC, while state assertions independently read Win32.
- After refreshing styles, set `DWMWA_NCRENDERING_POLICY=DWMNCRP_DISABLED` to suppress only non-client drawing while retaining native animation styles and system transition policy. API failure must throw. Harness and launcher draw a one-physical-pixel border-l2 ring using `--dsh-window-hairline=1/devicePixelRatio px`, retaining browser alpha antialiasing without a hard region or blur.
- The bridge uses the pinned production dependency `koffi@3.3.2` to call five user32 APIs and one dwmapi API without a subprocess. Desktop and slim launcher explicitly unpack Koffi and its platform native modules. Loading or applying styles fails visibly instead of silently falling back to opaque windows.
- The `window-motion` card, design language, rules, upstream-sync constraints and QA jointly protect corners and motion. Automated gates inspect final factory options, a 20px computed radius, transparent outside/painted inside corner pixels, HWND styles before and after transitions, and authorized IPC. Frame sequences separately demonstrate visible motion; state checks cannot replace visual acceptance.
- The Windows gate also reads DWM non-client state. On an interactive desktop, `--composed` checks actual pixels at all four corners and visible interiors over a magenta backdrop, covering active, inactive, resized and restored windows. Hidden or occluded windows cannot falsely pass; page alpha, desktop composition and visible motion have separate acceptance checks.

## Alternatives considered

- Opaque windows with system corners: restore motion without a native dependency, but shrink the established radius and were rejected by the user; this must not become the default repair again.
- Opaque windows with a rounded `setShape` region: preserve shape and motion, but the local experiment produced white edges and would require size/DPI region maintenance; not selected.
- PowerShell/PInvoke on every window creation: useful for an isolated diagnostic probe, but adds subprocess startup and asynchronous window-show timing. The product instead uses a narrow synchronous N-API bridge before showing the window.
- Page scaling or `setBounds` interpolation: can draw a transition, but cannot consistently cover taskbar restoration and system animation preferences or restore native window behavior; not selected.
- Removing only the DWM border color: a small change, but it did not remove the rectangular fill in the experiment; the entire non-client surface must be disabled. An additional CSS clip-path experiment did not improve circular-arc alpha error, so no extra clipping layer was introduced.

## Consequences

Corners and motion must pass together. The cost is a new production native dependency; Electron upgrades, DSH synchronization and packaging changes require HWND, pixel and packaged-module checks. Disabled system animations remain respected; interactive frame sequences and CI state checks have distinct responsibilities.

Local validation covers both production window factories and native-module loading from the launcher ASAR. The full multi-monitor, alternative-DPI and system-animation-disabled matrix has not been rerun. Results and reproduction scripts are in the [QA evidence](../../../qa/results/2026-09-29-corner-motion/README.md).
