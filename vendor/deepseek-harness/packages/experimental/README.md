---
description: "The experimental group map: pre-stable prototypes that are private by default, with explicit public Agent Teams packages."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

The experimental group contains prototype capabilities whose contracts can change and carry no support promise. Packages are private by default; the five Agent Teams packages are published opt-in exceptions under their existing `@deepseek-ai/dsh-experimental-*` names. The group also holds the private cross-realm Inspector, CPython subprocess backend, and browser-worker preview packages. Released products outside this group must not depend on experimental packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.md) | Published opt-in profile layer for Agent Teams | — |
| [`agent-team`](agent-team/README.md) | Named teammates with durable messages and a shared task board | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.md) | Published opt-in Web layer for Agent Teams | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.md) | Team roster, task board, and teammate navigation for Web | — |
| [`code-runtime-python`](code-runtime-python/README.md) | CPython subprocess backend for the code-execution seam | `ctx.codeRuntime` |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.md) | Nine tools that let the model create, message, and coordinate teammates | registers scoped tools on `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — private defaults, public Agent Teams exceptions, and dependency isolation.
- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
