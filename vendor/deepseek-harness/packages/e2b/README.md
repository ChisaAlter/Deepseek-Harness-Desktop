---
description: "The E2B remote-runtime group map: file and command work inside one remote Linux sandbox, for users and maintainers of the E2B family."
kind: "package-group"
---

# packages/e2b

English | [中文](README.zh.md)

## Summary

The E2B family lets agents read and edit files, run shell commands, and use terminals inside one remote Linux sandbox instead of on the host machine. It keeps filesystem work separate from command and terminal execution while both use the same sandbox. Existing shell, terminal, and language-server features continue to work without E2B-specific tools. The harness, model calls, and session state remain local; the sandbox is ephemeral, experimental, and absent from shipped compositions by default.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`e2b`](e2b/README.md) | One shared remote Linux sandbox that file and command work runs in | `ctx.e2b` |
| [`fs-e2b`](fs-e2b/README.md) | File reads, writes, edits, and listings inside the remote sandbox | `ctx.fs` |
| [`subprocess-e2b`](subprocess-e2b/README.md) | Shell commands and interactive terminals inside the remote sandbox | `ctx.subprocess` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Portable execution-world decision](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) — why the execution world can move without moving the harness, and what stays local.
- [Subprocess subsystem](../../docs/subsystems/subprocess.md) — the subprocess seam contract and the generated Cordis surface, including `ctx.e2b`.
- [Filesystem subsystem](../../docs/subsystems/filesystem.md) — the filesystem seam contract and the generated Cordis surface.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
