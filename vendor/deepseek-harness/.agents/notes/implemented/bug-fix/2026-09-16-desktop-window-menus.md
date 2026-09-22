# Agent Note: Desktop standard macOS window menus

Status: implemented

English | [中文](2026-09-16-desktop-window-menus.zh.md)

## Problem

The Desktop shell replaces Electron's default application menu with a custom template that listed only the application and Edit menus. Electron builds only the roles a template declares, so macOS lost the File and Window menus and the application hide commands the default template supplies, including Close Window (⌘W), Minimize (⌘M), and Hide (⌘H). None of those shortcuts did anything in the Desktop application while every comparable macOS application responds to them (issue #4374).

## Decision

On macOS the template declares `{ role: 'fileMenu' }` before the Edit menu and `{ role: 'windowMenu' }` after it, and a separator-delimited run of `hide`, `hideOthers`, and `unhide` before Quit in the application submenu. Those roles contribute only the standard items; no Services submenu, window list, or other macOS default is declared. Windows and Linux keep the application and Edit menus.

Electron's role labels are English string literals inside Electron (`lib/browser/api/menu-item-roles.ts`, `filemenu`, `windowmenu`, `close`, `minimize`, `hide`) with no locale lookup, and Electron re-applies them to the native menu items before the menu is shown, so a non-English Desktop shows them in English; the existing Edit menu behaves the same way. No custom close, minimize, or hide code is added: ⌘W destroys the window through Electron's own role.

## Alternatives considered

**Bind ⌘W to minimizing or hiding the window.** macOS reserves Minimize for ⌘M and Hide for ⌘H, and comparable applications close the front window with ⌘W. Binding another command to the reported shortcut would contradict the platform convention the change follows.

**Declare only the Window menu.** That menu supplies Minimize and Zoom but no Close, leaving ⌘W unbound.

**Add a bare `{ role: 'close' }` item to the application submenu.** It avoids a File menu containing a single command, but places a window command among the app-wide Plugins, Updates, Hide, and Quit items where no macOS application puts it.

**Declare the File and Window menus on every platform.** The same template declares Ctrl+W there; with one window, closing it invokes `window-all-closed` and quits the application, turning a window shortcut into an unrequested quit path.

**Recreate the main window on Dock activation regardless of other windows.** The plugin window can outlive the main window, so gating `activate` on `mainWindow` instead of `BrowserWindow.getAllWindows()` would let a Dock click always restore the main window. That changes window lifecycle beyond restoring the suppressed platform commands, so the existing `activate` condition stays.

## Consequences

macOS regains the window and application commands the custom menu suppressed, at the cost of four menu roles. The labels stay English on a non-English Desktop.

## Testing

A `apps/desktop/tests/main-startup.spec.ts` case pins the declared menu roles per platform, including the macOS hide commands. Role-based menu items execute natively, so a programmatic `click()` and the vitest Electron mock cannot exercise the shortcuts; a real Electron 44 run of the same template showed the standard File, Window, and application items present only after this change, with the same English labels while `app.getLocale()`, `getSystemLocale()`, and `getPreferredSystemLanguages()` all reported `zh-CN`.
