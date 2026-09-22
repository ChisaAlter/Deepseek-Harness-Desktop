# Agent Note: Desktop close-window preference

Status: implemented

English | [中文](2026-08-14-desktop-close-to-tray-setting.zh.md)

## Problem

The desktop shell already persisted `closeToTray` and hid the window on close, but Settings had no control for that choice. Users who wanted the close button to quit had to edit `config.json`. Quitting also had to stop the spawned Harness process, or the next launch would fight a leftover listener.

## Decision

`ui-settings-general` registers a General row with id `close-behavior` only when `window.shell` exposes both `getConfig` and `saveConfig`. The row reads and writes Electron `closeToTray` (default `true`: hide to tray). `false` means the title-bar close button quits. A plain browser never sees the row.

The main-process close handler reads the live config through `hideOnClose`. Tray hide still only conceals the window. Quit — title-bar close with `closeToTray: false`, tray Exit, or the app menu — sets the quitting flag, paints a fullscreen “closing” overlay, runs `dsh.stop()`, then `app.quit()`. `before-quit` remains the single service teardown. The overlay covers the window before teardown starts, so a slow `dsh.stop()` does not look like a freeze.

The overlay CSS uses concrete colors from `currentTheme()` for the active light or dark scheme; it does not fall back to a dark canvas. After insert, the overlay script overrides from live `--dsw-alias-*` page tokens when those resolve.

## Alternatives considered

**Store the preference in Host `settings.yaml`.** Rejected because close and quit are Electron window lifetime, not a Web settings namespace, and a remote browser must not change them.

**A separate desktop settings window.** Rejected because Settings is already the official panel, and About plus Marketplace already use `window.shell` there.

**Leave leftover dsh running after quit.** Rejected because the next launch then has to steal or hop ports, and the user asked quit to stop the service.

## Consequences

Changing the selector updates `config.json` immediately; the next close uses the new value without a restart. Tray mode keeps the Harness process alive. Quit always tears that process down before the Electron app exits. Web snapshots do not include the row.

## Testing

`ui-settings-general` client specs pin registration only when `window.shell` exposes `getConfig` and `saveConfig`, persist `closeToTray` from the General row, and keep the tray default when config is missing. Those suites sit under `test:gui` and the per-file 100% coverage gate.

Desktop `npm test` pins `hideOnClose` (tray default, explicit quit, no hide after quit starts), `overlayCss` against supplied light and dark tokens with no dark-canvas fallback, and the Chinese / English overlay copy. Pull requests and the Windows installer workflow run `npm test` before packaging.

There is no Playwright or Electron e2e for the painted overlay or `dsh.stop()` during quit.
