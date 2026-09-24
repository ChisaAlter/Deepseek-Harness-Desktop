# Decision: Mobile remote switches to a Claude-style page structure

Status: implemented

[中文](2026-09-24-mobile-remote-claude-structure.md) | English

## Problem

Mobile remote Web and the Android bundled SPA were previously specified as a
narrow-screen reflow of the desktop Harness: the top bar, drawer, InputBar and
popover menus copied desktop geometry, and attached large-radius panels and
grouped cards were explicitly banned. The result read like a squeezed desktop
page on a phone: the drawer carried navigation, search and the full directory
at once, the input area was the desktop tool row, and model/permission pickers
were small menus hovering over the composer. The user asked for the Web and
Android pages to be redone after the Claude mobile app while keeping DSHD's
light/dark colors.

## Decision

- [Design language「Mobile remote interaction」](../../../design-language.en.md#mobile-remote-interaction)
  now reads: the **page structure** follows the Claude mobile app, while
  **colors, font stack and light/dark** still come only from the
  `--dsw-alias-*` / `--dsw-specific-*` same-value tables. The desktop is
  unaffected.
- Structural points: a 48px top bar (menu / Git pill or title / new chat); the
  blank draft centers the whale mark and a greeting; the resident composer is a
  floating card with 20px radius, 32px round buttons and pills; the drawer
  holds only primary navigation (sessions / workspace / settings),「Recent」
  single-line sessions, the computer avatar and the「New session」primary
  pill; the full session list becomes a full-screen task entered from
  「Sessions」; settings is grouped cards topped by the computer card and the
  workspace card.
- Choices triggered from the composer (attachment source, model, thinking
  effort, permission) move to a bottom panel, whose first page lists the
  current provider's models with drill-downs; menus triggered from the top bar
  and list rows remain Menus anchored near the trigger, and destructive
  confirmation remains a centered Modal.
- Sizes take the Claude screenshot measurements tightened one step further
  (regular buttons 32px, full-row buttons 40px, list rows 40–54px); touch
  targets are made up with transparent expansion to 44px on Web / 48dp on
  Android.
- Android native code only re-lays out the connect, camera-permission and
  scan screens; chat remains the same `mobile/web` sources, and protocol,
  pairing, navigation hierarchy and sticky behavior are unchanged.

## Alternatives considered

- **Copy Claude wholesale (warm paper, serif headings and body, terracotta
  mark)**: closest to the screenshots, but it starts a second palette and font
  stack that reads like a different product next to the desktop; CJK serifs
  also fall back to Song on some Android WebViews. The user explicitly asked
  to keep our own colors in the prototype review, so this was rejected.
- **Workbench structure (home = recent-session cards, no drawer, a full-bleed
  docked composer, model and permission inline on their own pages)**: better
  status visibility for coding tasks, but it departs from both Claude and the
  desktop, and the interaction paths have to be relearned; the prototype
  review chose the Claude structure, so this was rejected.
- **Keep the desktop narrow reflow and only retune sizes**: the smallest
  change, but it keeps the overloaded drawer and desktop-style menus and does
  not reach the mobile feel the user asked for, so this was rejected.

## Consequences

- Gains: shallower hierarchy on the phone — the drawer only navigates; model,
  thinking effort and permission are all handled inside one bottom panel;
  control sizes are unified and tighter.
- Costs: the phone no longer maps one-to-one to desktop components, so future
  desktop primitive redesigns will not transfer automatically; mobile-specific
  geometry is maintained by this design-language section. The old
  「desktop geometry」test assertions are rewritten to the new contract.
- The full session list moved from the drawer to a full-screen task, adding
  one layer to the back hierarchy that unified-Back handling must cover.
- The reviewed prototype (fake data, including the rejected workbench variant)
  is kept as [mobile-claude-redesign.html](../../../superpowers/prototypes/mobile-claude-redesign.html);
  it does not ship in the APK and is not served by the phone server; the
  [mobile remote card](../../../features/mobile-remote.md) records the current
  contract.
