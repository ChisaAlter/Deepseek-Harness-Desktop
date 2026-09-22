# Agent Note: Client Settings navigation service

Status: implemented

English | [中文](2026-09-08-settings-navigation-service.zh.md)

## Problem

The Settings shell's visibility and requested section were component-local state, so an ordinary client plugin could not open the existing modal at a registered section or issue a request before the shell mounted.

## Decision

`ui-settings-general` provides the typed `ctx.settingsNavigation` client service. Its `open(sectionId?)` and `close()` methods publish one observable snapshot containing shell visibility and the requested section id. The `SettingsRoot` entry consumes that same snapshot through its injected hook source and routes every trigger, navigation, onboarding, mask, Escape, and header-close path through the service callbacks.

The service stores requested ids without validating them against the ledger. `SettingsRoot` resolves the requested id against the current `settings.section` projection, so omitted, empty, and unknown ids open the existing shell on its first registered section. The service is created in `apply`, follows the package fiber, and is replaced on reload without retaining the previous shell state.

The `/client` entry exports only `SettingsNavigation` and `SettingsNavigationSnapshot` types; the implementation class remains internal. The Context declaration and runtime provider live in `ui-settings-general`, so `ui-settings` does not acquire a presentation dependency or a new value edge.

## Alternatives considered

**Expose a React setter or simulate a sidebar click.** Rejected because both approaches bypass the observable ownership model, fail before mount, and couple plugins to component or DOM details.

**Put the service in `ui-settings`.** Rejected because `ui-settings` owns the settings transport and slot types but renders no shell; moving navigation there would give the base package presentation state and expand the allowed change beyond the shell owner.

**Validate section ids inside the service.** Rejected because the service has no stable ownership of the live section ledger. Resolving against the shell's current projection preserves first-item fallback when registrations change.

## Consequences

Ordinary client plugins can open the existing Settings modal without a second surface, and requests issued before the shell mounts are consumed when it appears. Repeated open requests switch the rendered section while the modal remains mounted. All close paths publish one closed service state, and existing presence, focus restoration, onboarding, trigger, and section-ledger behavior remain shell-owned.

Consumers that need compile-time access import the public service types; runtime collaboration uses Cordis service injection. The observable service is process-local viewing state and is not persisted or written to the session log.

## Testing

The navigation-focused Settings suite passes 40 tests across four files, and the full `ui-settings-general` package suite passes 72 tests across 12 files. The `ui-settings-general` TypeScript project passes `tsc --noEmit`. README English/Chinese pairing records are current.
