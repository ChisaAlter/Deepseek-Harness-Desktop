# Agent Note: Titlebar crowding density and conversation reserve

Status: implemented

English | [中文](2026-08-17-titlebar-crowding-density.zh.md)

> Scope: AppFrame titlebar trailing cluster vs conversation header when the center column is squeezed. The [desktop surfaces and titlebar note](../architecture/2026-08-14-desktop-surfaces-and-titlebar.md) owns column geometry and window-control padding; this note owns label collapse and the conversation-header reserve.

## Problem

Session log, Git, and the panel toggles sit in the shared titlebar row as `#dshd-shell-titlebar-trailing`, `justify-self: end` over conversation and details. The conversation header (title, `header.actions` preset label) occupies the same row with only 28px right padding. A window wider than 1024px still squeezes the center column when the sidebar and surfaces are open, so `data-compact-header` stays off and the cluster paints over 「标准模式」. Hiding the whole cluster at that width would also hide the surfaces toggle that recovers space.

## Decision

AppFrame measures `#dshd-shell-titlebar-trailing` and publishes `--dshd-titlebar-conversation-reserve` as `max(0, trailingWidth - detailsWidth)` while the cluster is visible (not phone, not compact-header). The conversation header pads `max(28px, reserve + 8px)` so the title ellipsizes instead of colliding.

Label density keys off the solved conversation column width, not the cluster's current width, so shrinking a label cannot oscillate the density. `full` at center ≥ 720px. `cozy` below 720px: Session log is icon-only (aria-label kept), `header.actions` hides. `compact` below 560px: the branch trigger and Initialize Git also drop their text. Commit and the panel toggles stay labeled when those buttons are drawn. Density is `full` whenever details is open or the cluster is hidden. AppFrame writes `data-titlebar-density` and the trailing owner `density` field. Crowding density never removes Git or the panel toggles; those buttons leave the cluster only when their Interface Settings switches are off.

## Alternatives considered

**Hide the whole trailing cluster when the center column is narrow.** Rejected because the panel toggles are how the user closes surfaces and recovers width; the phone/`data-compact-header` hide remains the <1024px path.

**Overflow 「⋯」 menu for Session log and Git.** Rejected for this cut: the official titlebar has no kebab, and the toggles would still have to stay outside that menu. Icon-only collapse reuses the existing capsules.

**Wrap the titlebar onto a second row.** Rejected because the shared titlebar row sizes with the surfaces tab bar.

**Container-query density from remaining header width after reserve.** Rejected because that remaining width depends on the cluster width, which depends on density.

## Consequences

Crowding density never removes Git or the panel toggles from a squeezed desktop conversation. Those buttons leave the cluster only when their Interface Settings switches are off. The preset label and Session log text still go first. Compact density is rare while `data-compact-header` still hides the cluster below 1024px (max sidebar at that width leaves center ≥ 604px); the stage is kept so a later compact-header change does not re-open overlap.

## Testing

`titlebar-density.ts` pins the two functions. AppFrame pins reserve, details-open full density, cozy when surfaces pins center at 640px, and compact-header reserve 0. Session log drops the visible label at cozy. BranchMenu drops the ref name at compact. Conversation header CSS pins the padding formula, the header-actions hide, control no-drag, and a blank caption that still occupies row 1. AppFrame trailing CSS pins the 8px cluster gap, a max-content `no-drag` hole, the `--dshd-wco-controls` inset, the single caption drag band, and the phone-menu `no-drag`. `apps/web/tests/desktop-chrome.e2e.ts` rejects horizontally overlapping Session log / Git / panel-toggle boxes and opens the branch menu while surfaces is open. Desktop `src/main/harness-chrome-inject.test.js` pins a window-control-only inject. Source and packaged Electron smoke click those trailing controls at real coordinates after surfaces opens.

## Related

[Desktop surfaces column, titlebar trailing cluster, and window-control padding](../architecture/2026-08-14-desktop-surfaces-and-titlebar.md). [Phone overlay shell](../feature/2026-08-14-phone-overlay-shell.md) owns the <1024px cluster hide. [Interface Settings chrome visibility](../feature/2026-08-19-interface-settings-chrome-visibility.md) owns the switches that omit Git and the panel toggles from the cluster.
