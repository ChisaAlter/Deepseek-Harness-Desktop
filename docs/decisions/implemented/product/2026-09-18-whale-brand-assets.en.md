# Decision: Shared whale brand assets

Status: implemented

[中文](2026-09-18-whale-brand-assets.md) | English

## Problem

The user supplied a transparent head and spinning loader. The pet-art generator owned the application icon, so replacing generated outputs alone would restore the old artwork on regeneration. The existing decision tree has no record owning this asset relationship.

## Decision

`assets/whale-head.png` is the brand source for windows, taskbar, tray, and installer; `icon.svg` wraps it on a white rounded-square background (radius 22% of the side, head inset 4% on each edge), and existing commands generate PNG and ICO; the installer reads that generated PNG to produce BMPs without duplicating composition. The pet generator maintains only its fallback image. The boot center loads the unchanged `assets/whale-spin.svg`, keeping its 112px box and external-image embedding; reduced motion switches to the static head.

## Alternatives considered

Replacing only generated icon.png/ICO minimizes edits but reverts on regeneration. Overwriting pet-head.png reuses old paths but keeps branding coupled to pet fallback art, so the implementation uses an independent source and preserves existing consumers.

## Consequences

Source PNG and loader SVG retain their original bytes for hash comparison; icons have a white background, transparent outer corners, and a fully proportioned head. Brand updates require icon and installer:assets regeneration; installed executable icons still require repackaging. Validation covers generated dimensions, animation frames, reduced motion, and existing installer contracts; this task does not publish an installer.
