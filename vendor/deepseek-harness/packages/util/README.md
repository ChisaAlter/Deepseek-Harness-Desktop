---
description: "Package map for the zero-dependency utility family: atomic file writes, branded ids, harness home paths, the launch environment, native commands, output retention, and timeouts."
kind: "package-group"
---

# util/ — zero-dependency shared utilities

English | [中文](README.zh.md)

## Summary

The `util/` group gives capability packages shared mechanical primitives instead of duplicate implementations. It covers atomic writes, branded ids, UUIDs, Harness-home paths, launch environments, native commands, output retention, and timeout handling. Every package here is a library: it registers no service or event, and the consuming capability retains the business semantics.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package provides one primitive; open a package page for how to use it.

| Package | Role |
|---|---|
| [`brand/`](brand/README.md) | Compile-time-only nominal brands for ids that cross package boundaries |
| [`crypto/`](crypto/README.md) | Mints RFC 9562 v4 UUIDs from the cross-runtime `crypto.getRandomValues` primitive |
| [`home-paths/`](home-paths/README.md) | Resolves the single Harness home and joins shared user-data paths |
| [`launch-environment/`](launch-environment/README.md) | Frozen launch environment that remembers which layer supplied each value |
| [`atomic-write/`](atomic-write/README.md) | Atomic file replacement and cross-process writer locking |
| [`native-command/`](native-command/README.md) | Runs host-native commands directly, never through a shell string |
| [`workspace-path/`](workspace-path/README.md) | Provides browser-safe Workspace path and display helpers |
| [`output-retention/`](output-retention/README.md) | Bounds model-facing output and reports exact omission metadata |
| [`timeout/`](timeout/README.md) | Deadline arithmetic, signal fusion, and timeout-versus-cancel classification |

-----

<a id="related-documentation"></a>
## Related documentation

- [Root package map](../README.md) — where `util/` sits among all package groups.
- [Generated configuration catalog](../../docs/config-catalog.md) — the library-package index this group forms part of.
- [Adding a package cookbook](../../docs/cookbook/adding-a-package.md) — how a new shared primitive lands in this group.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
