# Decision: Welcome resource closure and rendering gate

Status: implemented

[中文](2026-09-29-welcome-resource-closure.md) | English

## Problem

The entry policy is superseded by [direct desktop entry](../product/2026-09-29-direct-desktop-entry.en.md): welcome no longer opens. This record retains the resource-repair rationale.

Installed 0.3.3 candidate b061501e5b4 displayed default HTML and a broken brand image in first-run welcome, making the boot page appear stuck. The port included compiled component styles but omitted upstream page CSS, its window-material dependency and the brand SVG. Successful stylesheet loading did not prove complete layout. Smoke clicked API Key/set up later without validating presentation and incorrectly passed.

Record audit: [desktop bridges](../architecture/2026-09-26-upstream-desktop-bridges.en.md) retains its welcome entry and credential boundary; this repair completes its resources. [GUI reconciliation](2026-09-28-release-gui-contract-reconciliation.en.md) retains real entry smoke, adding presentation prerequisites before clicks.

## Decision

- Mirror the pinned upstream page layout, window material and brand image verbatim, loading page CSS after compiled styles in HTML. Do not redesign welcome.
- Before smoke clicks, validate full-window layout, brand image, stylesheets and actual action hit targets. Broken presentation fails immediately; only unfinished loading waits.
- Real Electron regression covers Chinese/English, light/dark, API Key/set up later, and injected layout/image failures that prove the gate rejects this defect. The same test can target an installed app.asar; the original candidate fails deterministically.
- Withdraw the original candidate recommendation. A replacement requires a new SHA, CI and asset hash binding. Welcome remains a configuration entry; background smoke skipping setup does not mean the user configured anything.

## Alternatives considered

- Skip welcome entirely: this enters the workspace but conceals first-run setup damage and changes the upstream contract; rejected.
- Check only files or stylesheet requests: the original package loads both compiled stylesheets yet lacks page layout, so this cannot detect the actual defect; rejected.
- Blame the Chinese installation path and move the app: real Electron loads styles at that path, falsifying the hypothesis. No user directory migration is required.

## Consequences

Three upstream resource mirrors and one real rendering regression must remain synchronized on upstream updates. Smoke now checks welcome presentation so automatic clicks cannot hide first-run defects. Final installation verification is recorded in the [repair report](../../../qa/results/2026-09-29-welcome/REPORT.md).
