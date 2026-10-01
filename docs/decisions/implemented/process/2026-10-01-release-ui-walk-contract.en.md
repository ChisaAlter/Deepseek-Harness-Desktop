# Decision: Follow current entries and accessible names in source release QA

Status: implemented

[中文](2026-10-01-release-ui-walk-contract.md) | English

## Problem

Source release QA still observes the standalone Remote sidebar row, the old signed-out account feedback wording, and visible credential status text. The current product puts Remote in the account menu, uses Contact us while signed out, labels the Session log switch with `aria-labelledby`, and represents configured credentials with an accessible icon. Those outdated observations reject the actual user paths. The Skills probe also returns an object before its target page is ready; the stop wait before the second reasoning ping treats a timeout as success, hiding an unready composer.

## Decision

- `release-ui-walk` resolves standard `aria-labelledby` names and still requires both Sign in and Contact us in the signed-out menu.
- Keep the required `remote.footerPresent` step and interpret it through the current account entry contract: with the account launcher present, the standalone Remote row must be absent and clicking Remote in the account menu must open the existing pairing popup; without the account launcher, the sidebar fallback must open the same popup.
- After creating a custom provider, reopen Models within the existing 12-second save budget and require both its provider row and the configured credential accessible name. Draft fields, names elsewhere, and missing credentials cannot pass.
- Complete the Skills probe only when its navigation is active and both its heading and Add button appear; record navigation and content state on failure. After stopping a model ping, first wait for the empty composer to leave its Stop state, then write back an unsent QA draft and require an editable composer, an enabled Send button, and no active Stop button; timeout explicitly fails. Empty drafts intentionally disable Send, so both phases share the original wait budget. Existing timeouts stay unchanged, and required steps are neither removed nor made optional.

## Alternatives considered

- Keeping the old observations avoids test changes, but would require restoring retired product entries and wording against the current contract.
- Removing failed steps or checking only persisted configuration quickly restores green results, but cannot prove that users can complete the actual UI paths or detect credential and stop-state failures.
- Increasing waits tolerates slow reloads, but cannot fix incorrect selectors or probes that return immediately and would hide a clearly unready state for longer.

## Consequences

VM page tests execute the real injected helpers and click flow, with counterexamples for missing popups, duplicate Remote entries, incorrect Skills navigation, missing credentials, disabled Send, and active turns. The fixture maintains a small DOM interface; the actual source UI must still run independently. These focused tests do not certify installer acceptance.

This record partially overlaps the [Remote account entry decision](../product/2026-09-23-remote-account-menu.en.md) and [repair evidence gates](../process/2026-09-19-audit-repair-evidence-gates.en.md), following their product paths and evidence strength without replacing them. Product behavior stays consistent with the [account entry card](../../../features/account-settings-entry.md).
