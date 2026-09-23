# Agent Note: Desktop welcome window material

Status: implemented

English | [中文](2026-09-08-desktop-welcome-window-material.zh.md)

## Problem

The desktop welcome design blurs the desktop behind its entire window. Chromium backdrop filters only sample content inside the renderer. Credential setup also needs an explicit startup owner so a native skip is not followed by a second Web dialog.

## Decision

The [Electron welcome window](../../../../apps/desktop/src/welcome-window.ts) owns native material and window controls. Its independently bundled React renderer supplies the entry, account sign-in states and API-key form. It shares the `StateDot` loading component with the Web UI without booting the Web plugin graph. The Desktop build emits local JavaScript and CSS under `lib/welcome`, included in packaged applications; the document keeps its network-denying content security policy. A narrow preload supplies typed shell copy, a write-only key operation, and a skip operation; IPC rejects other windows and subframes. Each sandboxed preload is bundled independently because Electron’s restricted require cannot load sibling chunks. The Electron main process authenticates through the shared Web launch URL and resolves the official provider's reference through the existing settings and credential RPC methods. The [thin Web wrapper](2026-09-10-desktop-web-wrapper.md) owns the HTTP server; onboarding adds no Host endpoint or child IPC operation. Responses contain metadata or a safe outcome, never a key or private provider diagnostics.

Cold startup opens the entry when neither an account credential nor a model API key is stored. Saving enters the workspace after persistence succeeds; skipping enters without saving a draft or a completion flag. The next process launch checks the credential store again. The Desktop preload marker suppresses only the Web credential step; settings and the welcome notice remain mounted. Other native shells can set `credentialOnboarding` through the Models Host plugin, which publishes that boolean through the page-injection event before dialogs register. The module graph carries package identities rather than arbitrary Host config, so a Host row alone does not configure its Client half. Startup reads account presence and API-key configuration independently. Account sign-in enters the workspace; sign-out reopens the welcome window only when no model API key remains configured.

The generated project follows declared workspace dependencies because pnpm’s hoist index alone can omit configured plugins.

Desktop reads the shared `locale.preference` before opening the welcome window. The Client awaits an isolated preload read of that preference and the same OS language order before mounting, then reports resolved locale changes to the shell. Only an explicit Settings selection writes the preference; automatic detection stays provisional. The shell ships English and Simplified Chinese dictionaries, so a Client-only language pack falls back to a supported OS language in native windows.

The welcome flow shares the Desktop backend controller with startup recovery. The main recovery document loads offscreen while the Host starts; a failure reveals it, and successful startup chooses the welcome window or workspace after reading credentials and locale. Recovery actions retain the controller’s serialized retries and awaited child shutdown. The application preload exposes recovery controls only to shell documents and the locale bridge only to application documents.

## Alternatives considered

**A CSS-only backdrop filter.** It cannot blur other application windows or the desktop, so it cannot provide the required native effect.

**Persisting a completed-onboarding flag.** A skip is valid only for the current process; retaining it would suppress the next cold-start choice while the user still has no credentials.

**Keeping both native and Web credential dialogs.** Their separate completion state would ask for a key twice after a native skip. The composition assigns credential onboarding to one owner.

**Drawing replacement traffic lights.** Native controls preserve platform window behavior and accessibility. Their dimensions and outer window corners follow the OS rather than reproducing Figma geometry exactly.

**Separate preview callbacks.** A visual-only skip cannot demonstrate entry into the workspace and can hide broken startup dependencies. The preview uses the same callbacks and Host as the product.

## Consequences

Native blur strength and font fallback vary by system. macOS uses menu vibrancy with the onboarding window tint: 40% white in light mode and 50% rgb(24 25 28) in dark mode. Native materials own the blur strength. Windows compositing needs platform QA. Owner-local text expectations cover both pages and locales, and a built-Host acceptance test proves credential persistence across restarts. Account sign-out preserves independently configured API keys. Onboarding presentation produces no Session events.
