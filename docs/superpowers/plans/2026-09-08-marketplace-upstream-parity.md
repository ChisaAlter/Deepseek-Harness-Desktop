# Desktop marketplace parity with dshmarket 1.45.0

Preserve the desktop Settings section, desktop profile, curated catalog-id IPC,
HarnessController restart ownership, and DSHD design-language primitives/tokens.
Do not restore the third-party runtime or its independent HTTP/HMR system.

## Implementation sequence

1. Preserve installed source identity, validate update targets, classify install
   failures, and retain rollback failure information during build approval.
2. Add confirmation, catalog screenshot details, favorites, sorting, and time filters.
3. Add main-process sequential batch updates with one restart and bounded, redacted
   operation history surviving section unmount and Harness restart; expose via IPC.
4. Cover source collisions, malformed input, batch failure/rollback/approval,
   preferences/history bounds, confirmation cancellation, discovery and history UI.
5. Build the market bundle and run desktop/client tests, typecheck, and browser QA.

## Follow-on integrations requiring separate validation

Release-asset installs need archive identity/integrity validation; compatibility
filtering needs authoritative manifest requirements tied to the actual desktop
Harness version. Community comments require service/authentication/privacy review.
Do not present these as implemented without their complete data path and gates.

The existing exclusions (theme store, cloud backup, hot replacement, multiple
registries, trial channels) remain exclusions. Generic destructive pnpm repair and
automatic release-age bypass are not imported.
