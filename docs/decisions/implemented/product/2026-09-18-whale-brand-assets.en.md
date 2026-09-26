# Decision: Shared whale brand assets

Status: implemented

[中文](2026-09-18-whale-brand-assets.md) | English

## Problem

The user supplied a transparent head and spinning loader. The pet-art generator owned the application icon, so replacing generated outputs alone would restore the old artwork on regeneration. The existing decision tree has no record owning this asset relationship.

## Decision

`assets/whale-head.png` is the brand source for windows, taskbar, tray, and installer. `icon.svg` wraps it on a white rounded-square background (radius 22% of the side, head inset 4% on each edge), and existing commands generate PNG and ICO; the installer reads that generated PNG to produce BMPs without duplicating composition. The desktop and Web sidebars share a transparent copy of the source head: the head sits on the left, with the established “鲸屿 / WHALE ISLE” proportions and order on the first line to its right and “BASED ON DEEPSEEK HARNESS” below. The 屿 glyph uses brand blue. The sidebar head has no square badge. The collapsed rail's upper-left expand button shows the same head and swaps to the panel icon on hover or keyboard focus. Theme tokens provide the light/dark difference. The pet generator maintains only its fallback image. The boot center loads the unchanged `assets/whale-spin.svg`, keeping its 112px box and external-image embedding; reduced motion switches to the static head.

## Alternatives considered

Replacing only generated icon.png/ICO minimizes edits but reverts on regeneration. Overwriting pet-head.png reuses old paths but keeps branding coupled to pet fallback art, so the implementation uses an independent source and preserves existing consumers.

## Consequences

Source PNG and loader SVG retain their original bytes for hash comparison; icons have a white background, transparent outer corners, and a fully proportioned head. The sidebar uses a transparent static Web copy of the head while retaining the existing brand slots and interactions. Brand updates require icon and installer:assets regeneration; installed executable icons still require repackaging. Validation covers generated dimensions, animation frames, reduced motion, existing installer contracts, and sidebar wordmark themes; this task does not publish an installer.
