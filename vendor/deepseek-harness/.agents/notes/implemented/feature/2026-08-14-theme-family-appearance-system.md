# Agent Note: Theme-family Appearance system

Status: implemented

English | [中文](2026-08-14-theme-family-appearance-system.zh.md)

## Problem

The Web UI exposed only Light / Dark / System. Those three cubes lived in General, the durable document stored a single `ui-theme.preference`, and any other palette was an in-process `register()` id that vanished on reload. The desktop shell already shipped six boot palettes, but they painted only the Electron chrome and never reached `--dsw-alias-*`. Users could not keep a non-default look across restarts, could not author a custom family, and could not tune overlay solidity or type independently of the token sheets.

## Decision

**Keep ThemeRuntime and the alias-layer contract.** The presenter still paints `body` from `ThemeSnapshot.active`. New work adds a `ThemeFamily` document (one card, light and dark seed halves), a derive step that writes `--dsw-alias-*`, and durable half ids. The DeepSeek family ships empty derived tokens so existing CSS sheets remain the look for profiles that only store `preference`. Derived families keep the canvas at the seed background and map the accent onto the colorful chrome tokens the sheets otherwise pin to DeepSeek blue (`--dsw-alias-state-business-primary`, `--dsw-alias-button-info-fill`, `--dsw-specific-bubble`, sidebar selection) so a custom color is visible in chat, not only on Appearance sliders.

**Split color scheme from family.** `preference` still chooses which half is live (`light` / `dark` / `system`). `activeLightThemeId` and `activeDarkThemeId` choose which family paints that half. Clicking a light ball writes only the light id; clicking a dark ball writes only the dark id. `setTheme` continues to write color scheme (or select an in-process extension id).

**Persist custom families in the same Host section.** `customThemes` is an array of `ThemeFamily` documents on `ui-theme`. Import validates the schema and rewrites colliding ids. Deleting a family that a half is using falls back to DeepSeek. Third-party `register()` ids stay in-process.

**Give Appearance its own settings section.** `ui-theme` registers `settings.section` id `appearance` at order 5. General no longer hosts the three cubes, so there is one entry. The page owns color-scheme tiles, the two-ball library, create / duplicate / edit / import / export, an optional wallpaper with frost and pixelate sliders, glass opacity, and typography. The typography Advanced disclosure is browser-instance state in `localStorage` (`dsh:typography-advanced`). A wallpaper data URL stays out of the boot script so the index stays small; ThemeRuntime applies the layer after the plugin tree starts and mixes the main chrome fills so the image can show through.

**Bootstrap the active half before React.** Host `tapIndex` embeds preference, both derived token maps, font size, and glass opacity. The inline script resolves only `system` and writes the live half onto `body` so a non-DeepSeek family does not flash the sheet default.

**Glass and type are extras, not per-theme documents.** `--dsw-alias-glass-opacity` mixes menu, dialog, settings panel, and composer fills. Session column surfaces stay solid. Font stacks land on `documentElement` (`--dsw-font-family`, `--ds-font-family-code`, composer / terminal extras) rather than inside a family document.

**Desktop chrome follows the resolved half.** Electron boot `--bg` / `--fg` / `--accent` come from the same family seeds (Host `settings.yaml` plus `system` via `nativeTheme`). After the harness document loads, the existing DOM sampler still retints the window frame.

## Alternatives considered

**Import a parallel `--background` / `--primary` sheet.** Rejected because every shipped sheet and presenter already speak `--dsw-alias-*`. Derivation writes our names.

**Replace ThemeRuntime with a new store.** Rejected because register / overrideTokens / `theme/change` already exist; the missing piece was family + half persistence.

**A desktop-only overlay over `config.json` `theme`.** Rejected because that palette never reached the Web UI. The product surface is the vendored Appearance page.

**Store typography Advanced in `settings.yaml`.** Rejected because it is a disclosure, not a user preference, matching the existing Host-backed vs browser-instance split.

## Consequences

Old `settings.yaml` files that only contain `preference` keep the DeepSeek light and dark sheets. Choosing 青瓷's dark half survives reload. `system` plus an OS flip uses the half that matches the new scheme. Custom families are durable; VS Code theme conversion remains deferred. Overlay solidity defaults to 80%. Desktop boot chrome and the Web UI now share one family vocabulary.
