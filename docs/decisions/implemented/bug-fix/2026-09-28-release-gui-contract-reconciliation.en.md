# Decision: Reconcile GUI and core regression contracts before release

Status: implemented

[中文](2026-09-28-release-gui-contract-reconciliation.md) | English

## Problem

Release checks exposed immediate-unmount assertions against retained exit DOM, modal cleanup overriding an owner's chosen focus, disabled return targets, a missing shortcuts fixture service and desktop styles bypassing tokens. Core tests also read a const enum absent at runtime, required successful assembly for invalid tool calls and inherited package identity from outside their temporary profile.

Record audit: the [focus and retained-exit repair](2026-09-28-modal-focus-and-retained-exit-deactivation.en.md) retains its inactive-layer contract; this change handles valid focus destinations and disabled openers. The [single right panel](../architecture/2026-09-28-single-panel-in-place.en.md) retains container ownership; its layout architecture is unchanged.

## Decision

- Modal closure respects a valid surviving control explicitly focused by the owner. A disabled or retiring opener falls back to the parent autofocus control. A newer foreground layer retains focus ownership.
- Collapse tests assert immediate interaction and accessibility deactivation before waiting for the established exit and asserting removal. Settings fixtures provide the declared shortcuts dependency. Account-menu and sidebar-brand snapshots reflect already confirmed behavior only.
- Update the design language first, then express existing radii through shared tokens. Focus paint uses the shared color variable and pointer suppression while preserving role defaults. Titlebar overflow menus gain the shared material and scrollbar binding and lose duplicate neutral elevation borders. Geometry tests check both token references and resolved fixed values.
- Warning tests use the public exporter interface rather than a compiled-away const enum. Property tests check idempotence of both valid assembly and explicit malformed-call rejection. Plugin identity fixtures establish an anonymous profile root to exclude ancestor repositories.
- The client catalog generator normalizes CRLF before escaping TypeScript strings for platform-independent output. Replay overlays use the current api-key plugin name. Only keyless replay with explicit `DSH_SNAPSHOT_HEADERS=refresh` updates tool-description and prompt sidecars, asserting recorded Session bytes remain unchanged. Default replay still checks strictly and writes no snapshots.
- Smoke waits for the actual Harness WebContents and follows the existing API Key / configure-later controls in the native welcome flow instead of substituting the boot page. Include dsh-platform-session in installer resources and closure assertions so local source availability cannot mask an omitted package.

## Alternatives considered

- Disable exit motion to satisfy old assertions: this breaks approved interaction; rejected.
- Refresh every snapshot or expand style exception lists: this can conceal real defects. Update only the two inspected snapshots and fix token consumers; reject blanket relaxation.
- Generate only valid tool names in the property test: this removes malformed-input coverage. Retain invalid inputs and verify their rejection instead.

## Consequences

Exit motion, role geometry and malformed-response rejection remain intact while tests observe the actual phases and interfaces. New focus cases do not establish every platform's visual behavior. Screenshots, source startup and installer acceptance are recorded separately. Results live in the [release preparation report](../../../qa/results/2026-09-28-release-preflight/RELEASE-STATUS.md).
