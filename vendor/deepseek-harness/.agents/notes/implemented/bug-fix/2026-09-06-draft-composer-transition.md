# Stable first-submission composer geometry

English | [中文](2026-09-06-draft-composer-transition.zh.md)

## Decision

The normal InputBar owns a footer with the statistics line's minimum height. Host admission, running state, and statistics projection publish independently; empty statistics therefore cannot collapse the footer between those publications. The reserved height includes the secondary font-size adjustment.

ConversationRoot retains the editor and measures the Hero card before first submission. The same Session's first prompt animates the stack's relative `top` from that measurement with the shared slow duration and easing. ResizeObserver keeps the starting position current while the Hero is visible. Animation completion and Session/phase changes clear the temporary positioning. Ordinary sends and history loading do not replay the transition.

## Alternatives

Animating without reserving the footer hides neither a late 24px correction nor a later running-to-idle rebound. Delaying admission or statistics couples presentation to Host timing. A transform on the composer creates a containing block for fixed menus and dialogs; relative positioning avoids that change. Reduced motion uses the theme's zero-duration token.

## Verification

The keyless Web scenario samples first submission through real Remote admission and reply, with a controlled 200ms Host delay. Desktop click, Enter, multiline draft, narrow viewport, and reduced motion cases retain editor identity and reject an overshoot beyond the final position. A second submission retains the settled position. Component tests cover measurement, completion, history loading, and phase-change cleanup.
