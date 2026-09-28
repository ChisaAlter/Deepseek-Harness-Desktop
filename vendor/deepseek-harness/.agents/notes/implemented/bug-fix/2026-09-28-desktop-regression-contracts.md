# Agent Note: Desktop regression contracts preserve identity and interaction

Status: implemented

English | [中文](2026-09-28-desktop-regression-contracts.zh.md)

## Problem

Desktop integration retains exiting content and contributes role-specific chrome, but older tests assumed immediate removal and literal radius declarations. Modal cleanup also displaced explicit return focus and selected disabled openers. Provider renames and compiled const enums left replay and logger fixtures behind their runtime contracts.

## Decision

The desktop fork keeps its existing geometry and role colors through shared tokens. Modal cleanup honors an eligible focus target already selected by its owner and uses the parent's autofocus control when the opener becomes unavailable. Exit tests verify immediate accessibility deactivation followed by eventual removal.

Tests provide declared services and observe the public logger exporter instead of reading an erased enum. Invalid tool calls retain rejection coverage in property tests. Replay overlays name the current API-key provider. Explicit `DSH_SNAPSHOT_HEADERS=refresh` in keyless replay updates only request-header sidecars and verifies recorded Session bytes remain unchanged; normal replay stays read-only.

The client catalog normalizes line endings before escaping source declarations into TypeScript strings. Its LF and CRLF regression compares complete generated output, while geometry tests resolve tokens and retain numerical assertions.

## Alternatives considered

Disabling exit motion or accepting every snapshot diff would hide product regressions. Requiring literal pixels would reject equivalent token use. Filtering malformed inputs out of property generators would remove useful negative coverage. Rewriting recorded Session generations to refresh tool descriptions would destroy historical input evidence.

## Consequences

The fixes preserve interaction and failure contracts while making tests follow actual lifecycle phases. The desktop fork's role defaults remain an integration choice; they do not redefine upstream default palette values. Component checks do not replace real browser or packaged-runtime acceptance.
