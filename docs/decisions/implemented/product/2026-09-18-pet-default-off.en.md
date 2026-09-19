# Decision: Default the desktop pet to off

Status: implemented

[中文](2026-09-18-pet-default-off.md) | English

## Problem

The user reports stuttering after desktop startup. The pet starts a transparent window and neural animation by default, but rendering headroom cannot be assumed on every computer. It has not been measured as the sole cause of all stuttering.

## Decision

Both configuration defaults and manager normalization require enabled=true to opt in. Missing or malformed values stay off; explicit saved choices, settings and tray controls remain available. Hiding clears the growth scan interval and retains existing window, cursor polling and log watcher cleanup. An in-flight scan may finish.

## Alternatives considered

- Disabling the feature flag would remove all access, including deliberate opt-in, so it is rejected.
- Overwriting all saved true values would disable every existing installation but discard explicit choices, so saved values remain.
- Lowering frame rates or replacing the renderer could reduce load but exceeds this default-setting change.

## Consequences

Default startup creates no pet window, loads no pet animation page and starts no periodic pet scans. Manual opt-in restores the existing behavior; previously enabled installations must turn it off once. An existing scan worker is not forcibly terminated on hide and in-flight requests may finish. This does not claim to fix other visual effects or overall frame rates.

The earlier [background scan worker](../bug-fix/2026-09-17-pet-growth-scan-off-main-thread.en.md) and [tray checkbox synchronization](../bug-fix/2026-09-18-tray-pet-checkbox-resync.en.md) decisions remain valid. This decision only changes the default state and stops periodic scanning; it does not supersede either.
