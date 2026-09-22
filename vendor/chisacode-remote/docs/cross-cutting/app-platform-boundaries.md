# App Platform Boundaries

Use this when changing UI or client-facing code that must run across iOS, Android, browser web, and Electron web.

## Modules

- `app`: cross-platform React Native UI, host runtime state, workspace screens, composer, settings, voice.
- `desktop`: Electron-specific web environment and bridge behavior.
- `expo-two-way-audio`: native audio bridge used by voice features.
- `client`: daemon state and transport consumed by app.
- `protocol`: message shapes and feature gates consumed by app.

## Existing Docs

- `docs/coding-standards.md`
- `docs/hover.md`
- `docs/unistyles.md`
- `docs/floating-panels.md`
- `docs/design.md`

## Invariants

- App code is cross-platform by default.
- DOM APIs require `isWeb` guards.
- Use `.web.ts(x)`, `.native.ts(x)`, and `.electron.ts(x)` when behavior is fundamentally platform-specific.
- Hover-only controls must have always-visible native or compact behavior.
- Use layout breakpoints for form factor, not platform checks.

## Handoff Checklist

1. Identify every platform affected by the UI path.
2. Check whether the behavior belongs in shared app code, `.web`, `.native`, or `.electron`.
3. Keep composer and host/session state boundaries intact.
4. Use targeted tests and browser/device verification appropriate to the changed surface.
5. Do not add visual-only docs in app text; document behavior in `docs/`.
