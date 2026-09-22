# Changelog

All notable changes to ChisaCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- DeepSeek Harness is available as a built-in provider (`dsh`), riding its official ACP transport with a managed composition, its own icon, and gateway support — `supplyScope: "all"` gateways that enable an OpenAI or matched upstream now grow a `<gateway>-dsh` face
- ACP initialize timeouts name the child's exit state and stderr tail instead of reporting a bare deadline

### Notes

- Existing gateways with `supplyScope: "all"` automatically gain a `*-dsh` face after upgrading; disable the built-in `dsh` provider in Settings if you don't want DeepSeek Harness sessions

## 1.0.3 - 2026-08-13

### Added

- Grok Build is available as a built-in provider
- The sidebar can group sessions by project or by status
- Learn, goal, and team workflows are available alongside ordinary agent sessions
- New chats keep the folder you picked instead of creating a hidden worktree by default

### Improved

- The git control shows your current branch as soon as local git is ready, without waiting on GitHub
- The desktop top bar stays one strip when the right panel is open
- Desktop starts its built-in daemon on launch and no longer drops you on a welcome screen
- Sending the first message leaves the draft and selects the new session immediately
- Providers that fail a probe stay selectable instead of disappearing from the list
- Relay remote access requires authenticated connections
- Binding the daemon to all network interfaces without a password is refused
- GitHub project docs now match the shipped providers and Windows/Android release artifacts

### Fixed

- File explorer no longer crashes when it first opens
- Packaged Windows desktop can launch Pi
- Provider lists no longer hammer availability checks every time the selector opens
- Codex image attachments on disk are private and cleaned up when a session closes
- Temporary files and Windows socket paths are handled more safely on mixed-case drives

### Removed

- MiMoCode provider and management surfaces

## 1.0.2 - 2026-06-28

### Added

- Local usage statistics make recent agent activity and usage history easier to review
- Agent and workspace lists now show running, finished, error, and permission-needed states at a glance

### Changed

- Message, markdown, shortcut, and diff views are easier to scan with clearer spacing and themed colors
- User and assistant messages can be copied from the message context menu
- Windows development startup handles occupied daemon ports more smoothly
- Agent sessions are more reliable across checkout, provider, terminal, schedule, and workspace actions
- Release checks now cover more publishable packages before a version is shipped

### Fixed

- Windows CLI installs handle special characters in npm command shims correctly
- Desktop security checks now reject unsafe Electron flags, untrusted IPC senders, and transport paths outside `CHISACODE_HOME`
- Daemons bound to `0.0.0.0` now warn when access is exposed without a password
- Android uploads use stable version codes to avoid Google Play conflicts
- Voice and audio cleanup is more reliable on iOS and Android
- Desktop drag-and-drop, auto-updates, and local transport cleanup are safer
- Skills sync preserves user-created files in the target directory
- Native resize handles no longer crash non-web app surfaces
- macOS builds include the entitlements needed for notarization

## [1.0.1] - 2026-06-18

### Added

- **Agent delegation P0/P1 foundations**: Scoped companion MCP tools for agent delegation, status tracking, cancellation, and result collection.
- **Synthetic model gateway**: Configuration and lifecycle support for model-of-agents gateways (Claude, Codex, OpenCode, MiMoCode, Pi, Kimi Code).
- **Liquid neon theme** and glass-morphism UI surfaces across desktop and app.
- Built-in provider metadata in the shared protocol manifest covering Claude, Codex, OpenCode, MiMoCode, Pi, and Kimi Code.
- Settings surfaces for skills management, MCP server management, and custom model providers.
- CLI and skills documentation in both English and Chinese.

### Changed

- Provider discovery, snapshots, and registry plumbing unified across daemon, client, app, CLI, and MCP surfaces.
- Workspace draft state, sidebar session state, host routing, and project selection tightened across desktop, web, and mobile.
- Agent lifecycle metadata now distinguishes subagent, handoff, detached, and team-slot relationships.
- Desktop and app UI refreshed with updated theme tokens and glass components.
- Release automation handles desktop signing secrets and Android native project generation more reliably.

### Fixed

- Synthetic model gateway responses return consistently for all supported gateway formats.
- Provider hover and settings code satisfies current typecheck expectations.
- Android APK release builds generate the native project before Gradle packaging.
- Desktop release packaging no longer requires unrelated local secrets for GitHub artifacts.

## [1.0.0] - 2026-06-15

### Added

- **GitHub release update checks** for automatic update notifications.
- **Custom provider configuration** with model gateway settings.
- **Workspace dock commands** for managing agent workspaces.
- Desktop workspace environment panel and home screen refinements.
- Full surface localization for ChisaCode UI.

### Changed

- Project renamed from Fleurdelys to **ChisaCode**.
- Provider settings and sidebar state refined.
- Agent lifecycle handling improved.
- Agent tool versioning and management consolidated.
- Desktop shortcut updates and README refresh (removed demo images, added bilingual README).

### Fixed

- Sidebar navigation redesigned for consistency.
- Desktop workspace layout aligned across surfaces.
- Composer draft agent selector stabilized.
- Turn changes dock state corrected.
- Local desktop runtime fixes synced.

[Unreleased]: https://github.com/ChisaAlter/ChisaCode/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/ChisaAlter/ChisaCode/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/ChisaAlter/ChisaCode/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/ChisaAlter/ChisaCode/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ChisaAlter/ChisaCode/releases/tag/v1.0.0
