# Decision: Use Whale Isle as the application name

Status: implemented

[中文](2026-09-25-whale-isle-application-name.md) | English

## Problem

The sidebar already uses “鲸屿 / Whale Isle”, but the window, installer, launcher, tray, and Web still show Deepseek-Harness-Desktop or DeepSeek Harness. Users can mistake them for different products. Simply changing Electron's `productName` also changes the default userData path and executable name, affecting existing installations and sessions.

## Decision

Use **Whale Isle** as the primary public name and Chinese “鲸屿” as a secondary name. Keep **DeepSeek Harness** only in the brand attribution. Keep the established “鲸屿 / WHALE ISLE” order and sizing in the sidebar wordmark; use the English name for the desktop window, launcher, installer, shortcuts, tray, Web/PWA, and mobile companion.

Keep internal identifiers such as `ai.deepseek.harness.gui`, `ai.deepseek.harness.launcher`, repository and npm package names, protocols, and `DSHD_*` configuration keys. The desktop and separate launcher continue using their original userData paths so the rename does not lose settings, sessions, or single-instance locks. New release assets use the Whale Isle name; update and install detection accept old assets, executables, and registrations for in-place upgrades.

## Alternatives considered

Rename only the sidebar and window title: the installer, operating system listings, and installed Web app would still show the old name.

Rename the repository, appIds, data directories, and every internal protocol: this would break existing installations, updates, and configuration paths without improving the public product name.

## Consequences

Release workflows, asset validation, launcher installation detection, and package tests must follow the new asset names. Existing versions remain discoverable and upgradable; user data stays at its original path. Third-party references to DeepSeek Harness describe the underlying project and are not replaced as product branding.
