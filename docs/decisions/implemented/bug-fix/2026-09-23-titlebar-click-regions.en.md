# Decision: Subtract titlebar controls from the window drag region

Status: implemented

[中文](2026-09-23-titlebar-click-regions.md) | English

## Problem

`AppFrame` declares a drag region over the top 48px of the window. On Windows, Session header controls overlapping it without `no-drag` become part of the draggable area: Agent Team, the directory opener, and its more-options button look clickable but do not receive native mouse clicks. The previous interactive-element exclusion applied only on macOS.

## Decision

The Session header's hierarchy navigation, action, utility, and corner seats declare `-webkit-app-region: no-drag` on every platform. The Web base style excludes native buttons and custom interactive elements on every platform too. Fixed layers covering the band declare their own `no-drag` regions. Only space between controls remains draggable. The current Session title and Agent preset name retain their read-only semantics.

## Alternatives considered

- **Exclude only the three reported buttons** — rejected: plugins can add more navigation and actions to the same header; per-button patches would leave new controls exposed. Header seats and generic interactive elements are more stable boundaries.
- **Remove the top drag band** — rejected: the window would lose its existing blank-space dragging behavior, contrary to the desktop titlebar interaction.

## Consequences

Actual buttons in the top row receive native clicks while blank space can still drag the window. Style regression tests check the Session header seats, generic interactive elements, and fixed layers; the source app must also check that button centers fall in `no-drag` regions.
