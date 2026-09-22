---
description: "Read-only runtime API discovery for agents developing and configuring installed Harness plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

English | [中文](README.zh.md)

## Summary

Inspect Host and Client runtime APIs before writing plugin code. Creator mode provides these read-only tools alongside Plugin Manager, which owns persistent profile changes. The inspection registry is supplied by the Cordis host runner; browser queries need a connected page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Creator mode includes this toolset. Other compositions mount `@deepseek-ai/dsh-tool-cordis` alongside the host runner that provides `cordisInspect`. Call `cordis_inspect_list` to discover providers, then `cordis_inspect_query` for a provider's exact methods and types. Use [Plugin Manager](../../boot/plugin-manager/README.md) to install bundles containing plugin code or MCP configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Host providers combine generated Service/Event catalogs and the requesting agent's tool registry. Client providers synchronize their manifests through the existing inspection registry and answer queries from a connected page. The tool plugin owns its registrations through Cordis effects; disposal removes both tools and prompt contributions. No invariant companion is published because inspection reads its providers directly and maintains no independent runtime projection.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin Manager](../../boot/plugin-manager/README.md) — persistent bundle installation and enablement.
- [Cordis host runner](../cordis-host-runner/README.md) — inspection registry and existing runtime consumers.

<a id="model-experience"></a>
## Model Experience

### Runtime inspection

#### What the model sees

The [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis) describes two read-only inspection tools. The [prompt](src/prompt.ts) directs persistent changes through Plugin Manager and describes MCP setup. Creator visual requests default to an installed UI plugin displayed in the current Web page; the development skill covers Client packaging and slot registration. Query results contain the requested API declarations or live tool schemas.

#### Token effect

Both tool schemas and the guidance section enter model requests while this plugin is visible. Query results append to the transcript; exact queries avoid loading unrelated declarations.

#### KV Cache effect

Unchanged schemas and guidance remain prefix-stable. Query results append to history; enabling other plugins can change subsequent tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Client queries wait for a responding page or cancellation. Inspection cannot invoke service methods, configure plugins, or execute generated code.

<a id="dev-note"></a>
### Dev Note

None.
