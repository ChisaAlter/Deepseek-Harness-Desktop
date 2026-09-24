# Decision: Use the desktop floating model picker in whale quick chat

Status: implemented

[中文](2026-09-24-whale-chat-floating-picker.md) | English

> Supersedes [2026-09-24-whale-chat-model-picker](../../archived/product/2026-09-24-whale-chat-model-picker.en.md)

## Problem

Expanding the model list inside a 248px conversation card pushes the thread and input away and abruptly changes the card height. The desktop composer already has one model trigger and a two-level floating menu; the whale card behaved differently.

## Decision

Keep one compact trigger below the thread that shows both model and reasoning effort. A floating two-level menu, outside the card's layout, has Model and Thinking rows at the root and grouped models or available effort levels in drilled panes. It opens above the trigger and follows the desktop picker's radius, row rhythm, checkmark, hover, and theme tokens, clamped to the display. While open, the menu joins the transparent window's interactive area without changing card height. Escape backs out one level at a time, then closes the card. Catalog ids, session writes, and the current-choice behavior remain the same.

## Alternatives considered

- **Keep two triggers and only float the lists** — rejected: this would stop the height change but still differ from the desktop's single trigger and two-level menu.
- **Keep an in-card list and make it shorter** — rejected: the card and chat content would still jump, while the catalog would be harder to scan.

## Consequences

The card's size stays stable. The floating menu must follow character and card movement and take clicks as a separate region of the transparent window. Placement is clamped when display space is limited.
