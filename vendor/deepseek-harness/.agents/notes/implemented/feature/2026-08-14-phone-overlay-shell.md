# Agent Note: Phone overlay shell for the official web UI

Status: implemented

English | [中文](2026-08-14-phone-overlay-shell.zh.md)

## Problem

The official web shell treated every viewport below 1024px as a squeezed desktop: the sidebar collapsed to a 56px rail and the concession chain still reserved that rail plus a 640px center floor. A phone-width browser or Android WebView therefore showed a rail over a crushed conversation, with no safe-area padding and no way to recover the full session list without overlapping the composer. Phone remote clients wrap this same page, so a desktop-narrow layout is the product defect, not a missing native chat UI.

## Decision

`AppFrame` introduces a stricter band under `PHONE_MAX` (768px) when the device is in portrait. Landscape is device rotation: `screen.orientation.type`, then physical `screen.availWidth`/`availHeight` when that type is stale or `orientation.change` does not fire, then matchMedia. A phone keyboard shrinks height below width and would otherwise leave the overlay band, re-paint the titlebar trailing cluster over the session title, and flash a desktop chrome after a session switch (the composer focuses the textarea). AppFrame re-reads landscape on window resize, visualViewport resize, matchMedia, and `orientation.change`. Compact header (`data-compact-header`) is any viewport below 1024px, including landscape, so a rotate cannot re-show the trailing cluster. That band still uses the existing narrow-store toggle (`narrowExpanded` / `toggleSidebar`) so tablet auto-collapse at 1024px in portrait is unchanged. On phone portrait the grid tracks are `0px minmax(0, 1fr) 0px`: conversation owns the frame, the sidebar paints as a left overlay drawer (`PHONE_DRAWER`, 320px, clamped to leave a backdrop strip), and an open details preference paints as a full-frame overlay. Drag handles do not mount. A floating menu button in AppFrame opens the drawer; tapping the backdrop closes it. Switching the current Session also closes the overlay drawer. The center column isolates conversation z-index (sticky composer, occupancy ring) so those layers cannot paint over the drawer; phone backdrop / sidebar / menu / details sit at 10–13, below `shell.overlay` (20). The phone drawer composites `--dsw-specific-sidebar-fill` over `--dsw-alias-bg-base` so wallpaper glass cannot mix the scrim; the backdrop uses the Modal mask (`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`). The titlebar trailing cluster (Session log, Git, panel toggles) is not shown on `data-phone` / `data-compact-header` — it is absolutely positioned over the session title on a phone-width frame. The sidebar owner share still carries only `collapsed` and `width`; a closed phone drawer reports `width: 0` because there is no rail. Conversation header, composer, details header, and the settings panel add `max-width: 767px` safe-area and full-bleed rules; the composer tool row wraps and the model chip shortens so permission and model controls do not collide. `apps/web/index.html` sets `viewport-fit=cover`.

Landscape skips both the overlay band and `SIDEBAR_AUTO_COLLAPSE`: the sidebar stays in the grid at its width preference (or `SIDEBAR_DEFAULT`). A phone rotate must not fall into the 56px rail.

The web-app bundle pins the browse directory-picker pair (`dsh-host-directory-picker-browse` + `dsh-client-ui-directory-picker-browse`) instead of the auto/native chooser. Phone remote shares this Host; a native OS dialog would open on the desktop display while the phone add-workspace control stays disabled (`flowBusy`) with no in-app UI. `host.listDirectory` is not a loopback-only privileged method, so the in-app dialog works from the remote client. The dialog is a full filesystem navigator: Home is the default landing and a shortcut, crumbs keep ancestors above it, and Win32 lists accessible drive roots at the volume picker.

## Alternatives considered

**Rebuild a native Android / Expo chat UI.** Rejected: the product wraps the official page; a second conversation stack would drift from tools, approvals, and theme immediately.

**Treat phone as the existing 1024px rail.** Rejected: a 56px rail on a 390px frame leaves the conversation unusable and still hides session titles.

**Widen the sidebar slot contract with `toggleSidebar` / `phone`.** Rejected: phone chrome is a shell concern; AppFrame already owns collapse. Conversation and sidebar plugins do not need a new owner field to recover a drawer.

**Bind `dsh web` to `0.0.0.0` for phone access.** Rejected: the Host fence and missing auth make an unauthenticated LAN bind unsafe. The desktop reverse proxy keeps dsh on loopback.

## Consequences

Portrait phone, portrait tablet, and landscape are three bands: tests must pin 390px portrait (overlay, no handles), 980px portrait (rail), and ~844px landscape (sidebar in the grid, no menu button, trailing cluster still hidden), plus a portrait device with a landscape matchMedia (keyboard) staying in overlay, and a rotate that skips `orientation.change` entering landscape from resize / the physical screen. Overlay CSS lives in ui-layout; conversation and settings only add media-query insets, so a later drawer redesign does not retouch slot contracts. Authors must not collapse `PHONE_MAX` back into `SIDEBAR_AUTO_COLLAPSE`, must not apply the rail to landscape, and must not key phone chrome off CSS `orientation`. A Host that serves phone remote must keep the browse directory-picker pair; auto/native opens an OS dialog on the host display and leaves the phone add-workspace control disabled.
