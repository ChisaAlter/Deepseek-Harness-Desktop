---
description: "Built-in plugins settings section for the dsh web client, and the official plugin configuration pages that register into the Plugins page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

## Summary

Use the **Built-in plugins** settings section to inspect the plugins this deployment ships, and the **Official** group of the sidebar's Plugins page to configure the host-plane plugins that expose settings. Each configuration page shows which values the user overrode, lets them reset those to deployment defaults, keeps edits local until save, and drops them when the page is left. If the configuration changed after the page loaded, the save is rejected instead of overwriting the newer values.

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

Open **Built-in plugins** in Settings for the read-only inventory; [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) contributes it as the section's one tab, shown as the page itself. To configure a host-plane plugin, select **Plugins** in the sidebar: the Official group lists one card per plugin this deployment composes, in this order — the shell executor (`shell`), the agent loop's tool-call parallelism (`agent-loop`), Subagent delegation limits and model selection (`subagent` and `subagent-model-selection`), and the DeepSeek search provider (`web-search-deepseek`) — and a card opens the plugin's page with its form.

### What appears here

Each page registers into the Plugins page's `plugins.item` slot while the Host serves its settings namespace, so a deployment that does not compose the owning plugin shows no trace of it, and a namespace the Host starts or stops serving adds or withdraws its page on the next settings-document commit or reconnect. The card's one-liner and the page's form are one entry rendered in the two views the Plugins page asks for.

### Editing and saving

A page stages what the user types and writes it only when they save. Each control renders staged text, so what is on screen is exactly what a save would store. Leaving the page drops the drafts; there is no discard control. A failed save keeps the page as it is, reports the failure, and retains the drafts for correction. A reset stages the composed default rather than writing immediately, and a draft the field does not accept blocks the save instead of being dropped. The Host is the only authority on whether a value was accepted.

The **Subagent** card groups delegation limits and model selection on one page with one save button. **Maximum recursion depth** and **Subagent parallelism limit** appear side by side, stacking on narrow screens. Information buttons reveal a two-row depth example and the shared count rule; validation errors remain visible below the input. Depth retains explicit tool overrides. Capacity counts live continuable descendants across all recursion levels, including waiting children and excluding the root, one-shot runs, and external providers. Saving applies to later delegation attempts; lowering capacity does not stop existing children.

The model selection section stages its permission switch and exact model checkboxes together. Enabling requires at least one selected adapter route. Saving submits `enabled` and `allowedModels` in one mutation fenced by the revision where that draft began; a newer Host revision marks the draft failed instead of restoring a revoked route. Disabling retains the selected routes for later reuse. Available models are grouped by provider, while saved routes absent from the current catalog appear last and remain removable. Adapter names and model descriptions remain live directory metadata and are not stored, and the card refreshes them after adapter changes, settings commits, and reconnects.

Saving the Subagent card validates both sections and writes their drafts through their existing namespaces. These writes are independent: if one fails, the card stays open with that draft retained, and retry writes only the remaining draft. The page appears when either namespace is served and shows only the available sections.

### Secret-role fields

A key control starts blank, reports only whether one is configured, and writes through the credentials domain rather than the settings section; a blank draft writes nothing and keeps the stored key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is one registration rule and one write path: each page is registered while its namespace is served, and saves go through the client settings scope.

### The registration rule

The section declares `settings.plugins.tab`, a root list slot whose labels become ordered tabs; a lone contribution renders as the page itself, and a tab stays mounted after its first selection so search and the inventory snapshot survive switching. The configuration pages are `plugins.item` registrations, one per namespace, made through `ctx.slots.inject` when the shared settings mirror shows the Host serves the namespace and disposed when it stops; registration order is the page order, not the Host's description order, which follows plugin activation and can change between boots. A page owns its controls and copy; the Plugins page draws its title, icon, and crumb.

### The write path

Saving writes staged fields through the client settings scope, which fences each write or ordered mutation with the namespace revision the draft read, so a form that has drifted from the document is refused rather than overwriting a concurrent change. A field's presence in the raw user layer — not its value — is what marks it overridden; a reset clears that field so it re-inherits the composition layer. Secret-role fields never ride a response; the page re-reads on the forwarded `credentials/reference-updated` event for the reference it watches.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the Plugins page, the settings base, the inventory tab, and the durable seams behind the forms.

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the sidebar page whose `plugins.item`, `plugins.bundle.config`, and `plugins.row.config` slots host configuration pages.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section` and the settings scope.
- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) — the read-only inventory the section shows.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [credentials](../../credentials/README.md) — the credential-reference seam secret fields write through.
- [ui-settings-general](../ui-settings-general/README.md) — the settings shell hosting the section.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define which plugins get a page and how fresh the group is; they are current package constraints.

- **Only host-plane plugins have a page** — a plugin an agent preset mounts carries its configuration inline in that preset's `agent.cordis.yml` and cannot register a settings namespace at all, so this package registers nothing for it. Editing those values remains the preset editor's job.
- **A page still needs a browser bundle** — the browser half must be a `dsh.client` package built in the client module system's lazy-CJS factory format, and the `clientBundle` preset that emits it lives in `../../../packages/client/tsdown.client.ts` rather than a published package, so a plugin outside this repository has to reproduce that build itself.
- **The served namespaces re-read on two signals only** — the wire announces settings-document commits and connection resets, not registrations, so a namespace whose owner registers after the mirror's read joins the Official group on the next document commit or reconnect.
- **The shell page follows the composed executor** — the POSIX and PowerShell executor families share the `shell` namespace because a host composes exactly one of them, so the served schema differs by platform (PowerShell adds `pwshPath`) even though the page edits the same two fields on both.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a browser-side settings surface whose node half owns no event stream or mutable runtime data; the layering and write refusals are Host contracts covered by the owning plugins and the api-proxy.
