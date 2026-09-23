---
description: "Desktop Account settings display DeepSeek login state and offer browser authorization and cancellation; the sidebar account menu provides Platform sign-out."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account

English | [中文](README.zh.md)

## Summary

Desktop Account settings display DeepSeek login state and offer browser authorization and cancellation; the sidebar account menu provides Platform sign-out.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The client activates only inside Desktop, identified by its preload bridge. Plain Web clients keep the standard Settings launcher and API-key onboarding without account login, account settings, or an account-state subscription.

The sidebar and Account settings display the profile avatar as a circular image, with the account icon as fallback when the URL is absent or the image fails to load. The collapsed sidebar centers the avatar in a 36 × 36 px button.

The section registers through settings.section and uses the account Remote namespace. The stream survives carrier reconnects through the shared Remote supervisor. The page renders feature-owned English and Chinese copy and keeps API keys separate from account state.

Balances use Platform Web currency formatting: two decimal places and digit grouping, positive amounts truncated to cents, positive sub-cent amounts shown as <0.01, and negative amounts rounded with a minimum displayed magnitude of 0.01. Raw Host balance strings remain unchanged.

Desktop usage and top-up actions open an isolated native Platform view below a 48px return bar. Back destroys the view and preserves the Account settings page. Loading failures retain the return action and show a centered localized error with Retry. Retry reloads the same destination; renderer commands never receive the account token.

The account menu's Feedback entry opens the Feishu questionnaire in the system browser. It supplies the available build version, UI locale and physical screen resolution as prefill_* parameters, with hide_*=1 for every context field; the account UID, tokens and contact details are excluded. Configure contactFormUrl on the ui-settings-account plugin to select another HTTPS form. contactSource defaults to empty until the questionnaire supports a Harness source option; OS and device fields remain unfilled, matching the Web implementation.

The sidebar account menu uses the shared Menu surface, backdrop blur, spacing, and row typography; feature styles only size its launcher.

The account card’s More account information link opens `https://platform.deepseek.com` in the system browser.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Account section appears first in Settings only while signed in; it is hidden before account state loads and after sign-out. The plugin owns one Host snapshot stream shared through framework hooks by settings.section and settings.launcher. The launcher opens Settings and offers Sign out only while an account credential is stored. Platform failures leave the menu available for retry. It maintains no independent credential state, so no invariant companion is published.

<a id="further-exploration"></a>
## Further Exploration

The [credentials subsystem](../../../docs/subsystems/credentials.md) owns storage APIs; the [architecture](../../../docs/architecture.md) explains application composition.

Account login uses a dismissible dialog before the model onboarding credential editor. The dialog uses a compact, right-aligned action row with the primary action last. The sidebar displays the profile name, falling back to the server-masked phone number or email when the name is absent; it stays blank while the profile is loading. Dialog copy and the sidebar account label are not text-selectable; the copy-link button remains available and restores its label two seconds after each successful copy. Clipboard failures show Copy failed on the link for two seconds without interrupting sign-in. Waiting shows a copyable authorization link and a loading indicator; timeout and failure require an explicit retry. The dialog's Copy sign-in link and the Settings Open link append the resolved Desktop palette as `theme=light` or `theme=dark` from the live theme snapshot, so both routes reach the Platform page in the current application theme without changing the theme preference Platform has saved. Sign-in failures render in that dialog; the launcher's inline failure line reports only a failed sign-out. Closing a waiting dialog cancels its Host attempt. The sidebar can reopen the same API-key editor through the settings coordinator.

A terminal account-state stream failure appears in the sign-in dialog or Account settings. Plugin unload suppresses late failure reports.

The balance card shows recharge funds and positive bonus credit in separate rows. Empty or nonpositive bonus wallets hide the bonus row and its divider; currencies retain their own amounts.

<a id="model-experience"></a>
## Model Experience

None, as account credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Profile and recharge-wallet balances use the existing Platform Web endpoints through Host getProfile / getBalance. The page refreshes when opened and after login or reconnect, preserves server-masked contact data, and shows query failures independently without manufacturing a zero balance. Usage and top-up use Host-provided links derived from platformOrigin and the browser’s own login; the links never carry a DSH token.

<a id="dev-note"></a>
### Dev Note

The [desktop login decision](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.md) records cancellation and storage ownership.

Usage and top-up show a centered 24px loading indicator without visible loading text until the native document loads; the return action remains available. The loading SVG is embedded locally from Figma node 2957:72553.
