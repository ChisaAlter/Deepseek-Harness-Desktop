# Decision: Use a Responsive Three-Zone Instrument Canvas for Boot

Status: implemented

[中文](2026-09-25-boot-page-responsive-instrument-canvas.md) | English

## Problem

The boot page absolutely positions its status and log areas while keeping the central content vertically centered. When failure details grow, those regions do not share the available window height; the launcher bridge also checks only the `error` state and appears while an automatic restart is still scheduled or running.

## Decision

Arrange the existing boot content in three grid rows: top status, central boot content, and bottom logs. The central area stays vertically centered when space permits and scrolls on its own when content grows. The four existing recovery actions may wrap. The log area has a viewport-responsive height limit, clips older lines from the top, and keeps the latest lines visible. Short windows use less whitespace and a shorter log area.

Keep the instrument canvas, whale loading assets, brand, authoritative status sources, log format, existing IPC actions, theme isolation, window rounding, and BrowserView cover behavior. Plugin progress shows only states supplied by controller or plugin events. Show the launcher bridge only for `error` when recovery status is neither `scheduled` nor `restarting`; add no controls, panels, or synthetic progress.

## Alternatives considered

Keep the centered flex layout and absolutely positioned status and logs: it has no row-height constraints when short windows and long failure details coincide, and cannot give central diagnostics their own scroll area.

Move diagnostics and recovery actions into a new card or launcher-only panel: this would add a second boot surface and duplicate the existing Recovery Board, contrary to the full-window instrument canvas and established recovery path.

## Consequences

Three CSS Grid rows manage the layout, the central diagnostic area scrolls independently, and recovery actions remain reachable in short windows. Logs keep a bounded height and latest-lines-first behavior. Actions may occupy multiple rows at narrow widths. The source and documentation contracts are aligned; automated tests and runtime rendering were not checked in this change.
