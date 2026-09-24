# Decision: Hand off Browser preview between the sidebar and chat overlay

Status: implemented

[中文](2026-09-24-browser-preview-surface-handoff.md) | English

## Problem

An HTML delivery card used to open Browser directly in the right panel, so clicking the card never showed the in-chat floating preview first. T3 Code's Browser automation path opens its mini player first and lets the mini player's button open the right panel. Files also called its separate always-on-top native file window a “floating preview,” making the two actions easy to confuse. A live click exposed another problem: after restoring the chat overlay to the right panel, the guest could remain at the overlay's 280×152 viewport because a departing overlay's asynchronous `previewHide` raced with the panel's `previewShow`.

## Decision

Name the Browser overlay action “Floating preview” and the native, read-only Files action “Preview in separate window.” For HTML / HTM / XHTML / PDF, a delivery card first obtains a protected Browser URL and opens the in-chat mini player; its “Open in right panel” button then expands Browser in the right panel. If the URL is unavailable, the card falls back to Files. Other files keep their Files path; ordinary file mentions and tool paths retain their existing right-panel path. When the same guest changes presentation owner, the departing surface no longer issues `previewHide`; the new owner issues `previewShow` and subsequent size updates. The overlay still hides its guest when a menu or picture-in-picture occludes it.

The floating window takes T3 Code's mini player as its visual reference: 12px from the top-right corner, 320×200 by default, with the page occupying the body. A native BrowserView covers renderer controls, so a narrow top action strip remains. Its filename comes from the URL's final path segment; an ordinary URL shows its host. The top uses DSHD semantic colors and ghost icon buttons for opening the right panel and closing, without a decorative status dot. Remove the 20px frame, persistent border, and exposed eight-way resize marks. Transparent hit areas outside the page rectangle support resizing from all four edges and corners, avoiding BrowserView pointer interception.

## Alternatives considered

- **Open a native window directly from the delivery card**: this bypasses the existing in-chat Browser overlay and conflates the separate Files window with Browser preview.
- **Expand the right panel first, then float from its toolbar**: this does not follow the requested mini-player-first Browser flow.
- **Create a second Browser guest for the overlay**: URL, history, and page state would diverge, and resource use would increase.
- **Keep “Floating preview” on both actions**: users cannot distinguish an in-chat overlay from a separate native window.

## Consequences

An HTML delivery card opens the in-chat floating preview; “Open in right panel” moves the same guest to the panel's current bounds without losing the page. The Files window action has a distinct name. Focused tests cover delivery-card intent, mini-first opening, and hide calls during both directions of the handoff.
