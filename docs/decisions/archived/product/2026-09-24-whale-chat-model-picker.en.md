# Decision: Expand model and thinking choices inside whale quick chat

Status: implemented

Archived: 2026-09-24

[中文](2026-09-24-whale-chat-model-picker.md) | English

## Problem

The 248px quick-chat card previously squeezed the model name and reasoning effort into a thin text row backed by native selects. The current values had little hierarchy, provider groups appeared only in the operating-system menu, English effort names felt out of place in the Chinese interface, and long model names were hard to read.

## Decision

Keep a hairline below the thread and add two compact selection triggers. A small label identifies Model or Thinking above the current value, with the full model name available on hover. Each trigger expands an in-card list: models are grouped by provider, reasoning choices retain catalog ids but display Chinese names, the current choice has a checkmark, and long lists scroll within a height limit. A new choice writes to the same persistent session; choosing the current item again only closes the list without rewriting the choice or resetting reasoning. Catalog and model semantics stay the same. Escape closes the list first and the card on the next press. The card continues to follow the character using its actual height.

## Alternatives considered

- **Keep native dropdowns and only add borders and spacing** — rejected: the option popup would still look separate from the card, and provider groups and Chinese effort names could not be presented consistently.
- **Open the main session's full model settings panel** — rejected: quick chat is for sending a short message from the desktop, and navigation would interrupt the current input; the existing ↗ action already opens the full session.

## Consequences

Model and thinking choices are easier to scan and remain keyboard accessible. Expanding a list increases card height, so it must re-anchor from the character and cap list height. Catalog ids, the save channel, and chat history stay the same.
