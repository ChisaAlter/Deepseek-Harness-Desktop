---
name: cordis-plugin-development
description: Use when authoring, installing, configuring, or debugging persistent plugins and MCP connections in the current Harness profile.
---

# Persistent Harness plugins

Use ordinary workspace files to author a bundle, then `plugin_manager install_bundle` to install it in the current profile. Changes affect every session in that profile and survive restart. Load `editing-cordis-compositions` for agent preset changes.

## Deliver a working plugin first

1. Resolve the requested result and destination. In Creator mode, an unspecified visual destination is the current Harness Web UI. Choose reasonable visual details and implement a small first version.
2. Discover only the APIs needed for that version: `cordis_inspect_list`, then targeted `cordis_inspect_query` calls. For UI, query Client `Slots.listSubTree` and the selected slot's registration options and props. Treat the recipes below and returned API declarations as the supported implementation path. Once the chosen slot and registration API are known, write the plugin. Before the first installation, resolve missing declarations through inspection; do not re-check these recipes by reading Loader, manifest-parser, package-manager, React, or slot implementation source. Source-level diagnosis starts from a concrete installation or runtime failure.
3. The first files you write are the installable package, patch, and required Host/Client files in one workspace directory. Check JavaScript syntax and the manifest, then install it. Before that first installation, do not create preview HTML, mock shells, design variants, screenshot scripts, or rasterizer tooling. Use the installed plugin itself as the first preview.
4. Read the installation result. After `application: applied`, exercise the capability or inspect the live Client registration. Use the connected page for visual verification when browser control is available. State any verification limitation explicitly; installation and slot registration alone do not establish what the user can see.
5. Fix observed defects in the same plugin. When the requested result works, finish with its location and verification status. Do not continue speculative visual variants, optional features, or a new mock preview. Close any task list you created.

## Package and install

A bundle declares `dsh.bundle.patch` in `package.json`. Its YAML patch inserts plugin entries. Give the package and rows unique names; use the Loader's existing YAML syntax, including `!!js` where expressions are needed. Read an existing patch before editing it: a matching override replaces the complete config.

For a simple drawing, prefer a slot with allocated space, such as `conversation.composer.dock` when available. Keep the first version within that slot’s flow; do not plan a motion path around host controls. This minimal package needs no dependencies, install scripts, or build tool:

```json
{
  "name": "@local/my-decoration",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

`index.js` exports `export function apply() {}`. A Host plugin with behavior exports either a service class as default or named `apply`, `inject`, and optional `Config`; do not mix these forms. The bundle's `cordis.patch.yml`:

```yaml
- insert:
    - id: my-decoration
      name: '@local/my-decoration'
```

Call `plugin_manager` with `action: install_bundle` and the absolute package directory as `target`. It performs package installation and bundle selection; do not reproduce those steps with shell commands. Only pass `approvedBuilds` after the user explicitly approves the reported pending build scripts.

Use `list_plugins` or `list_bundles` to obtain exact identifiers for existing installations. `set_plugin` and `set_bundle` toggle them; `remove_bundle` removes a bundle. Inspect saved-state and activation outcomes separately: `failed` requires diagnosis, `overridden` means a higher-priority layer wins, and `restart-required` means the change is not live. Installing a new bundle can activate through HMR; replacing an installed package requires restart to load a fresh JavaScript module generation. Do not infer updated browser code from an unchanged slot id.

## Client implementation

The browser artifact registers a lazy factory whose id equals the package name. React comes from the browser module table; no duplicate React installation, CDN script, or UMD search is needed. For compiled sources, use the deployment's Client build tooling to emit this format; declare non-baseline runtime imports in `dsh.client.external`.

This `client.js` example uses `conversation.composer.dock` for a small drawing below the composer. Replace the artwork with the requested drawing. Follow the selected slot's props and options. Do not read another plugin's DOM, stylesheet, or component source to estimate placement; choose a slot that already allocates space. Use `shell.overlay` only when the request needs an overlay and its placement is known.

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Decoration() {
      return h('svg', {
        viewBox: '0 0 64 64', width: 48, height: 48,
        'aria-hidden': true,
        style: { display: 'block', pointerEvents: 'none' },
      }, h('circle', { cx: 32, cy: 32, r: 24, fill: '#247bbf' }));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
        }, Decoration));
      },
    };
  },
});
```

Keep factories free of side effects. Register styles, timers, listeners and other resources inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions. Component-local styles can render as React elements so unmounting removes them. Verify disposal for resources you add. Inherit the host theme for containers and controls; artwork may use its own colors. Route visible UI text through the Client locale service. Do not replace the app root or append a second application to `document.body`.

## Verify in the available environment

Prefer the authenticated page already connected to Harness. Do not launch a separate browser from shell commands, change `HOME`, inspect personal browser profiles, search for authentication tokens, or alter keychains to obtain a screenshot. For a visual-only request without browser control, limit verification to JavaScript syntax, manifest validation, and the live Client slot, then report that visual verification remains unavailable. Before or after installation, do not search for rasterizers, invoke Quick Look, extract SVG into preview files, emulate React/DOM, or implement a custom renderer to compensate for missing browser control. A screenshot of a mock page is not verification of the running plugin.

For any test subprocess or temporary resource, use a unique owned directory, bound execution, and await cleanup. A failed optional preview must not turn into environment repair or block installation.

## Connect an MCP server

Create a configuration-only bundle: its manifest needs a unique name, version, and `dsh.bundle.patch`, but no Host/Client entry files. Insert the already installed MCP client in its patch:

```yaml
- insert:
    - id: demo-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: streamable-http
        url: http://127.0.0.1:3000/mcp
        failOnStartupError: true
```

Replace the endpoint, install the bundle through `plugin_manager`, then call `mcp__demo__ping` or another discovered tool. For stdio, use `transport: stdio`, `command`, and optional `args`, `env`, and `cwd`. Ambient credentials are scrubbed; reference existing credentials with Loader `!!js` rather than copying secrets into conversation text. Repair the same bundle on failure instead of creating duplicates.
