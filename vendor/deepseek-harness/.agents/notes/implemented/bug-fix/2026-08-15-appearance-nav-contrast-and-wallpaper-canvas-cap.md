# Agent Note: Appearance nav contrast and wallpaper canvas cap

Status: implemented

English | [中文](2026-08-15-appearance-nav-contrast-and-wallpaper-canvas-cap.zh.md)

## Problem

The Appearance page stacks a custom family, glass opacity, and an optional wallpaper. Two of those layers made selected chrome and the wallpaper itself disappear.

`--dsw-specific-sidebar-nav-item-active` for a non-DeepSeek family was an accent wash of about 10% on the canvas. Settings nav sits on `--dsw-alias-bg-layer-2`, not the canvas, so a cream family such as 宣纸 produced a mint wash indistinguishable from the dialog. The same token paints the chat sidebar selected row.

`wallpaperCanvasSolidity` mapped glass 100% to a fully opaque `--dsw-alias-bg-base`. Frost and pixelate only filter the wallpaper layer; they cannot show an image through an opaque canvas. A chosen wallpaper therefore appeared in the Appearance preview and vanished from the main UI.

A third defect was local to the theme library card: `.half` was reused for the editor fieldset, so the preview halves inherited `border-radius: 12px` while `.halfActive::after` stayed square and missed the card's 14px corners.

## Decision

`deriveThemeTokens` mixes accent into the canvas until `--dsw-specific-sidebar-nav-item-active` meets a 1.25 contrast floor against `--dsw-alias-bg-layer-2`, and `--dsw-specific-sidebar-nav-item-active-accent` meets 1.4. Settings `.navCell.active` uses the accent token because the row sits on layer-2. Chat sidebar selected rows use the same stronger wash.

With a wallpaper mixed in, canvas fill never exceeds `MAX_WALLPAPER_CANVAS_SOLIDITY` (45%, the same value the glass slider already uses at its default 80). Nested column roots (conversation, details, surfaces) do not re-paint `--dsw-alias-bg-base`; AppFrame paints that fill on the frame. The sidebar mix sits halfway between the uncapped canvas curve and glass, so glass 100% fully opaques the rail while the chat canvas stays capped. Both the sidebar column and SidebarRoot paint `--dsw-specific-sidebar-fill` over that canvas so the rail stays thicker than the chat at mid glass. A 100% mix stores the solid color rather than `color-mix`. The sidebar column has no right hairline; fill contrast separates it from the chat so an opaque 1px rule does not cut the image. Raised surfaces still follow the glass slider, including 100%. The phone Remote popup paints `--dsw-alias-bg-layer-2`, not the capped canvas. Appearance copy states that higher glass hides more of the image, and a hint appears when an image is set and glass is at least 90%. Frost and pixelate only filter the wallpaper bitmap; they do not change chrome solidity.

Library preview halves keep independent radii (`14px 0 0 0` / `0 14px 0 0`); the editor fieldset uses `.editorHalf`. `.halfActive::after` inherits `border-radius`.

Font fields remain CSS `font-family` names. Empty means the product default stack. Copy states that, and does not add a system font picker.

This amends the mixing curve in the [theme-family Appearance system](../feature/2026-08-14-theme-family-appearance-system.md); the family document, Host section, and wallpaper layer are unchanged.

## Alternatives considered

**Paint settings nav with a dedicated token.** Rejected because the existing accent wash is the selected-row token; raising its contrast floor also repairs the chat sidebar, which has the same layer-2 problem on cream canvases.

**Drop glass to a lower default instead of capping canvas fill.** Rejected because the user's glass value is a real preference for menus and dialogs; the defect is only the canvas going fully opaque over a wallpaper.

**Let frost/pixelate punch through an opaque canvas.** Rejected because those sliders filter the wallpaper layer, not the chrome fills that cover it.

**Replace font name inputs with a system font picker.** Rejected: the stored value is a CSS family name, empty means the default stack, and a picker would invent a second control the Host schema does not own.

## Consequences

Custom-family settings nav and sidebar selected rows stay distinguishable from layer-2. A wallpaper remains visible in the chat at glass 100%, at the cost of never letting the main canvas go fully solid while an image is set. The sidebar and raised chrome, including the phone Remote popup, go fully opaque at glass 100%. Font inputs stay free text.

## Verification

`derive.client.spec.ts` asserts 宣纸 seeds (`#0f766e` / `#f3efe6` / `#1c1915`) keep both nav-item fills at or above the layer-2 contrast floors. `wallpaper.client.spec.ts` pins canvas solidity at 45% for glass 80, 100, and 140, mixed `--dsw-alias-bg-base` at that percent, sidebar fill at the halfway mix (63% at glass 80) and a solid raised color at glass 100, and raised layer-1 solid at glass 100. `appearance-section.client.spec.tsx` pins the wallpaper glass hint at glass 100% with an image, its absence at 80%, and the font-name hints.
