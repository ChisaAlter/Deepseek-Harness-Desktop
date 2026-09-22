# Decision: Tray pet checkbox rebuilt against the real toggle state

Status: implemented

[中文](2026-09-18-tray-pet-checkbox-resync.md) | English

## Problem

The tray「桌面宠物」checkbox evaluates `checked: petEnabled()` once when `createTray` calls `Menu.buildFromTemplate` — a build-time snapshot. The pet panel's「🌙 隐藏」(`shell:live2d-hide` → `setEnabled(false)`) and the main-window settings toggle both bypass the tray menu, leaving the check stale: right-clicking the tray shows a still-checked item, so the user must click once to clear it (a redundant disable) and click again to actually re-summon the pet.

## Decision

`setEnabled` is the single funnel every toggle surface (pet panel, settings page, the tray checkbox itself) converges on: the manager gains an `options.onEnabledChange` callback fired with the new value on each flip; `index.js` wires it to the new `refreshTrayMenu()` in `tray.js` — `createTray` stores the template params as `trayMenuParams`, and each callback rebuilds `buildFromTemplate` + `setContextMenu` against the latest `petEnabled()`, silently no-opping before the tray exists.

## Alternatives considered

- **Invert `petEnabled()` inside the click handler, keep the stale menu** — rejected: it fixes the "two clicks" semantics but the check keeps lying (still shown checked while the pet is hidden) — display-vs-truth drift is the bug itself.
- **Rebuild on `tray.on('right-click')` before popup** — rejected: on Windows `setContextMenu` owns the right-click and the event is not reliably emitted; rebuilding mid-popup has no controllable timing.
- **Call refresh from each IPC entry point** — rejected: `shell:live2d-hide`, the settings page, and every future toggle surface would each have to remember; one callback inside the `setEnabled` funnel covers all current and future paths.

## Consequences

Cost: a new manager→shell callback contract (`onEnabledChange(enabled)`); the tray menu object is rebuilt wholesale on each flip (the menu is tiny and flips are rare, so the cost is negligible); callback exceptions are swallowed inside the funnel's try/catch so they cannot poison `setEnabled`. Gain: the check always reflects `live2dPet.enabled` — after hiding from the pet panel, the tray shows an unchecked item and a single click re-summons her; the settings toggle behaves the same. `node --test` desktop-live2d 34 pass (+1: `onEnabledChange` flip sequence), pet-live2d 33 pass.
