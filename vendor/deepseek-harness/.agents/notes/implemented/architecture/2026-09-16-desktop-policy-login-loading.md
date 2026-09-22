# Agent Note: Show a local document while the policy login page loads

Status: implemented

English | [中文](2026-09-16-desktop-policy-login-loading.zh.md)

## Problem

The test-deployment login window ([mandatory-update client](../feature/2026-09-11-desktop-mandatory-update-client.md)) navigated straight to the policy origin. Until that document committed and painted, the window was blank, and the remote page can take seconds to appear. A user pressed "Sign in with Feishu" and saw an empty window with no sign that anything was happening — while the window had to stay closable and must never cover a page that had become interactive.

## Decision

[policy-test-auth.ts](../../../../apps/desktop/src/policy-test-auth.ts) loads [renderer/policy-login-loading.html](../../../../apps/desktop/renderer/policy-login-loading.html) as the window's first document and requests the policy origin only after that document has committed. The placeholder is a packaged, self-contained file whose only text is the label the main process passes through `loadFile`'s query, so the copy stays in the shell locale dictionary (`policyLoginLoading`). The first committed remote document replaces it.

The placeholder never coexists with the remote page, so there is no removal step and no timer: Chromium keeps the placeholder frame until the remote document's first frame is ready, and from then on the third-party page owns the window. A redirect chain keeps the placeholder until the last document commits. The window is created visible and closable as before.

Two places recognize the placeholder's own load by file name and nothing else: the Session's `onBeforeRequest` filter, which cancels document requests outside the policy and Feishu origins, and the `did-fail-load` handler, which fails the login on a main-frame error. The `will-navigate` and `will-redirect` guards still require an allowed HTTPS origin, so the remote page cannot steer the window back to a local file. A placeholder that cannot load is not a login failure: the login request starts anyway and the window is blank exactly as it was before this change.

## Alternatives considered

**Overlay the window with a `WebContentsView` (or `BrowserView`) and remove it when the page is ready.** It would show feedback even earlier and can be removed at any chosen signal, but it needs a second renderer, a position that follows window resizes, and an explicit removal point. Every available removal signal is either late (`did-finish-load` still waits for subresources) or a guess (`dom-ready` can precede the first paint), and a view left in place covers an interactive page.

**Inject an overlay element into the login page with a preload script.** The one approach the decision has to keep out: it puts a shell-owned DOM layer inside a third-party page, and it would give that page a preload bridge the isolated Session deliberately withholds (`webPreferences.preload` is unset).

**Keep the window hidden until the remote page finishes loading.** It removes the blank flash by removing the feedback, and it delays the user's first view of the page until every subresource completes.

**Show a native splash window, or the loading text in the window title.** A second window adds a focus and lifetime problem for a two-second wait, and a title is not visible feedback inside the window.

**Reveal the page with a fixed delay.** A timer cannot distinguish a slow origin from a fast one, and it either covers a ready page or uncovers a blank one.

## Consequences

The login window gives immediate local feedback that cannot depend on the network: the placeholder's CSP sets `default-src 'none'`, so the document has no origin, font, image, or connection to reach. Because the placeholder is the window's document rather than a layer, nothing about it can survive into the third-party page, and a slow subresource on the login page cannot extend it.

The placeholder shares the login Session, so its request passes through the same document filter; the filter's exemption is name-scoped and does not widen the allowed-origin check for navigation. The window title remains the shell-owned login title (the renderer prevents `page-title-updated`), so the placeholder contributes no copy of its own.

[policy-test-auth.spec.ts](../../../../apps/desktop/tests/policy-test-auth.spec.ts) covers the order (placeholder first, remote page only after it settles), the filter's acceptance of the placeholder, a failed placeholder load that must not fail the login, and a window closed while the placeholder is loading that never starts the remote page. [policy-login-loading.spec.ts](../../../../apps/desktop/tests/policy-login-loading.spec.ts) loads the packaged document under jsdom and checks that it renders the label it is given, leaves the label empty without one, and forbids every network source. The placeholder's rendered frames and the first-paint timing of the substituted login page remain unverified against a real login window.
