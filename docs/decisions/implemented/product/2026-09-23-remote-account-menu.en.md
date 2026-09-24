# Decision: Move Remote into the account menu

Status: implemented

[中文](2026-09-23-remote-account-menu.md) | English

## Problem

After the official account menu took over the Settings entry, Desktop still showed Remote as a separate row at the bottom of the sidebar. Settings and Remote are infrequent Desktop configuration actions; keeping them in separate rows lengthens bottom navigation. The Remote row already owns pairing, device management, and QR gating. Moving its entry must preserve that popup and the pairing protocol.

## Decision

- `ui-settings-account` declares an optional `settings.launcher.action` child slot inside the account menu. `ui-settings-remote` contributes the Remote menu item only when the Desktop preload provides the complete Remote API. The item uses the existing Menu primitive and phone icon and opens the Remote plugin's existing pairing popup.
- When the account launcher exists, hide the standalone Remote row. When it is absent, retain the original sidebar Remote row. Both paths reuse the same Remote component and Desktop API, so activation order or a missing account plugin cannot remove access to pairing.
- Closing the Remote popup returns focus to the account button. Pairing state, QR display conditions, device actions, and advanced Settings options keep their existing sources.

## Alternatives considered

- Linking Remote in the account menu directly to the Settings page would require fewer component changes, but would make users search there for the QR code and change the original one step pairing path; rejected.
- Calling the Remote preload API and copying the popup into the account plugin would bypass a slot, but would make the account plugin own Remote behavior and allow the two pairing views to diverge; rejected.
- Keeping the standalone Remote row regardless of account menu availability is simplest, but does not consolidate the entry; rejected.

## Consequences

The account menu must observe child slot entries, and the Remote plugin must switch registrations between menu and sidebar fallback. Focused tests must cover both activation orders, missing account launcher, missing Remote API, and focus after closing the popup. The [account entry card](../../../features/account-settings-entry.md) and [mobile Remote card](../../../features/mobile-remote.md) record the current paths.
