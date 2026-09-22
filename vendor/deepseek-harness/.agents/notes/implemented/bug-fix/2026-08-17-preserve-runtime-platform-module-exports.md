# Agent Note: Preserve runtime platform module exports

Status: implemented

English | [中文](2026-08-17-preserve-runtime-platform-module-exports.zh.md)

## Problem

The Web shell publishes shared platform modules to plugins that are loaded at runtime. Vite only retained exports that the static shell itself referenced. A plugin could therefore load successfully but receive `undefined` for a valid string-keyed export. The Git titlebar plugin requested `IconCloudUploadOutline16`, threw while rendering, and prevented its whole trailing slot from mounting. This hid the branch picker and Git controls even though the plugin was active.

## Decision

`getStaticModules()` copies every shared module namespace through `preserveModuleExports()` before handing it to the runtime module loader. The observable namespace copy makes Vite retain all public members for every platform module, while the loader still receives ordinary module-like objects.

The assembled Web test imports `@deepseek-ai/dsh-client-ui-primitives` through the runtime module system and verifies the Cloud Upload, Commit, and Pull Request icons are functions. The titlebar test also requires the Switch branch control to render and records its accessible output.

## Alternatives considered

**Preserve only the missing Cloud Upload icon.** Rejected because any future runtime plugin could access another public export that the static shell does not use, recreating the same failure with a different control.

**Disable tree shaking for the Web build.** Rejected because it would retain unrelated code across the whole bundle instead of preserving only the explicit module namespaces exposed to runtime plugins.

**Make every plugin import static shell dependencies directly.** Rejected because the plugin loader intentionally resolves shared modules at runtime, and a central static registry would duplicate that mechanism and make plugins less independently loadable.

## Consequences

Published platform module chunks retain their public exports, so runtime-loaded plugins can use their declared UI primitives without depending on accidental static use elsewhere in the shell. The corresponding shared chunks may grow when a platform package exports unused members; that size cost is bounded to the modules deliberately made available to plugins.

The production-build regression catches an omitted runtime export before it reaches the desktop shell. It does not validate every export's behavior; packages remain responsible for their own API tests.
