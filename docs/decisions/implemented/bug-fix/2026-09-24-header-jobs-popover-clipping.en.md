# Decision: Keep the Session header jobs menu outside titlebar clipping

Status: implemented

[中文](2026-09-24-header-jobs-popover-clipping.md) | English

## Problem

The background jobs trigger sits in the Session header, and its menu was rendered as a descendant. The header actions container uses `overflow: hidden` to contain narrow layouts, so it clipped the menu and made the trigger appear unresponsive.

## Decision

Render the jobs menu in `document.body` and use the shared anchored positioning rule to track the trigger within viewport margins. The trigger stays in the header; both trigger and menu count as inside for outside click dismissal, and the menu excludes itself from the window drag region.

## Alternatives considered

- **Remove clipping from the header actions container**: other actions could spill into narrow layouts, and clipping higher in the tree would remain.
- **Raise the menu stacking level**: `z-index` cannot escape an ancestor's `overflow: hidden` clip.

## Consequences

The jobs menu remains visible and clickable beneath the titlebar and follows resize and scroll. Focused component tests cover its portal placement, viewport edge, and dismissal behavior.
