# Decision: Appearance switch for the button metallic-paint hover

Status: implemented

[中文](2026-09-17-metallic-paint-toggle.md) | English

> The `true` factory default was flipped to `false` by [2026-09-18-metallic-paint-default-off](2026-09-18-metallic-paint-default-off.en.md); the rest of the switch chain still stands.

## Problem

The metallic-paint sheen shipped always-on across the main Web UI, and the feature card listed "add a settings toggle for the sheen" under Do not touch. The user explicitly asked to be able to turn the hover sheen off — additive motion is personal preference, so the earlier always-on product constraint needed reversing.

## Decision

A persisted boolean setting `metallicPaintEnabled` (`ui-theme` namespace, schema default `true`, preserving the shipped behavior) backs a new Appearance "按钮悬停光泽 / Button sheen" switch row (`MetallicPaintRow`), written through `ThemeRuntime.setMetallicPaint`. `applyAppearanceDocumentExtras` mirrors the flag into the `data-dsh-metallic-paint` attribute on the document root; both `metallic-paint.css` rules now key on `html[data-dsh-metallic-paint]` — the sheet stays injected either way, the switch only flips the attribute, and off leaves each button with only its variant hover fill. Scope is unchanged: still native `button` in the main Web UI only, never `role='button'`, boot/launcher/gallery, or mobile/web.

## Alternatives considered

- **Default off (opt-in)** — rejected: the sheen has been the accepted default visual since it shipped; defaulting off would withdraw it for every existing user, while anyone who dislikes it can flip one switch.
- **CSS variable rewrite instead of attribute gating** — rejected: with variables the rules still match and only the value is overridden, which is semantically weaker than the rules simply not applying; `data-dsh-*` root attributes are the established pattern from transparent theme and cursor fx.
- **Unmount the whole sheet at runtime** — rejected: stylesheets mount with the plugin lifecycle, and runtime add/remove would need a new style-registration mechanism, disproportionate for one switch.
- **Keep it always-on** — rejected: the user asked directly; forcing a non-functional garnish on everyone has no payoff.

## Consequences

The settings surface gains one persisted field, threaded through schema / store / runtime / snapshot / the api-catalog declaration; the Appearance page gains one switch. `data-dsh-metallic-paint` becomes the sheen's sole activation condition, and tests plus docs assert on the attribute's presence. Enabled behavior is identical to before (including the reduced-motion static sheen); disabled loses only the sweep, leaving the rest of the theme layers untouched. The card's "no settings toggle" Do-not-touch entry is superseded by this record and cross-linked from the [feature card](../../../features/metallic-paint.md).
