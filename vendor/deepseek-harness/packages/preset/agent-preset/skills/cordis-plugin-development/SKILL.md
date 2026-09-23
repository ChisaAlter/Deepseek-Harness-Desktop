---
name: cordis-plugin-development
description: Use when authoring, installing, configuring, or debugging persistent plugins and MCP connections in the current Harness profile, and for any visual object, decoration, or widget request that names no other destination, which means an installed UI plugin rendered in the Harness Web UI.
---

# Persistent Harness plugins

Use ordinary workspace files to author a bundle, then `plugin_manager` with `action: install_bundle` and the absolute package directory as `target` to install it in the current profile. Changes affect every session in that profile and survive restart. Load `editing-cordis-compositions` for agent preset changes.

## Deliver a working plugin first

1. Resolve the requested result and destination. An unspecified visual destination is the current Harness Web UI; a standalone image or HTML file does not complete such a request. Choose reasonable visual details and implement a small first version; install it before visual refinement.
2. Discover only the APIs needed for that version: `cordis_inspect_list`, then targeted `cordis_inspect_query` calls. For UI, query Client `Slots.listSubTree` and the selected slot's registration options and props. Once the chosen slot and registration API are known, write the plugin.
3. Read the matching template under `templates/` with the file-read tool and write its copies into one workspace directory, or write the installable package, patch, and required Host/Client files there yourself. Check JavaScript syntax and the manifest, then install it. Before that first installation, do not create preview HTML, mock shells, design variants, screenshot scripts, or rasterizer tooling. Use the installed plugin itself as the first preview.
4. Read the installation result. After `application: applied`, exercise the capability or inspect the live Client registration. Use the connected page for visual verification when browser control is available. State any verification limitation explicitly; installation and slot registration alone do not establish what the user can see.
5. Fix observed defects in the same plugin. When the requested result works, finish with its location and verification status. Do not continue speculative visual variants, optional features, or a new mock preview. Close any task list you created.

## Knowledge sources, in order

1. Inspection: `cordis_inspect_query` answers exact Service methods and Event modes (`Service`, `Event`), a mounted plugin's Config JSON Schema (`Config.listConfigs`: filter the paged directory by `name`, then query the `entry` id), the Tools this Agent can call (`Tool`), and live Client Slots and theme tokens (`Slots`, `Theme`).
2. Package documentation: `Config.listConfigs` with `name` set to the package finds its entries; querying one `entry` returns its `packageDir`, the resolved package directory. Read `<packageDir>/README.md`. Bundled packages resolve from the dsh installation and profile-installed bundles from the profile, so never guess the path from `$DSH_PROFILE_DIR`.
3. Source: installed packages ship built `lib/index.js` and `lib/types/**/*.d.ts` with JSDoc under that same `packageDir`, not `src/`; a source checkout of DSH has `packages/<group>/<name>/src`. Read them when inspection and the README leave a question open, and start source-level diagnosis from a concrete installation or runtime failure.

`DSH_PROFILE` (profile name) and `DSH_PROFILE_DIR` (its directory, whose `node_modules` holds only profile-installed bundles) are set in every shell call of a profile-launched Harness and absent when the Harness was booted without a profile. Bash reads them as `$DSH_PROFILE`; PowerShell, which the Windows preset uses, reads them as `$env:DSH_PROFILE`. With `dsh` on the PATH, `dsh --profile "$DSH_PROFILE" --dump-config` prints the composed profile.

## Read next

The files below live in this skill's base directory, which the `skill` tool reported, and the table is the complete list: do not enumerate that directory. In every deployment, including a source checkout, read these files with the file-read tool, write copies into the workspace with the file-write tool, and verify a copy by reading it back. In Desktop the directory sits inside `app.asar`, which only the Host process's own file reads can open; shell commands (`ls`, `cat`, `cp`, `cmp`), the glob and search tools (they run a native ripgrep process), `node`, and pnpm all fail on it. Never install or syntax-check a template in place; copy its contents into the workspace first.

| Task | File |
|---|---|
| Bundle manifest, display metadata and icon, install and enable semantics, Host plugin export forms, Config | `references/host-plugin.md` |
| A UI plugin rendered in the Web page: Client manifest, module loader, slot registration | `references/ui-plugin.md` |
| Connecting an MCP server through a configuration-only bundle | `references/mcp-bundle.md` |
| Verification limits when no browser control is available | `references/verification.md` |
| UI plugin starting point, four files | `templates/decoration/package.json`, `templates/decoration/cordis.patch.yml`, `templates/decoration/index.js`, `templates/decoration/client.js` |
| MCP bundle starting point, two files | `templates/mcp/package.json`, `templates/mcp/cordis.patch.yml` |
| Loader patch dialect and the list of installable plugin packages | the `cordis-composition-reference` skill |
