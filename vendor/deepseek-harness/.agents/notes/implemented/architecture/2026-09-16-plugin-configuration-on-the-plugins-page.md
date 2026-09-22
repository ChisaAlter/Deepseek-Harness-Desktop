# Agent Note: Plugin configuration on the Plugins page

Status: implemented

English | [中文](2026-09-16-plugin-configuration-on-the-plugins-page.zh.md)

## Problem

A plugin's settings lived in Settings, on the Plugins section's configuration tab: four collapsible cards, one per host-plane namespace, beside a read-only inventory tab. The sidebar's Plugins page listed and switched bundles but could not open a plugin's settings, so two surfaces split one object between them, and a bundle installed from outside the repository had no place for a form of its own at all.

## Decision

**The Plugins page hosts configuration; Settings keeps the inventory.** The page declares three slots as children of its `main` entry. `plugins.item` (list) lists an official plugin in the Official group by its `label`. `plugins.bundle.config` (keyed by the bundle's package name) renders on the bundle's page between its description and its rows. `plugins.row.config` (keyed by `<package name>#<row id>`) gives that row a configure control that opens a page headed by the row id. Every entry is rendered in two views the page passes as owner props: `summary` for the one-liner under the title, `page` for the form. The page draws the title, icon, and crumb, projects the three ledgers into one observable (`configLedgerSource`) beside its store, and never names a configurable plugin.

**Attribution is declared by the registrant, in the slot name and key.** No manifest field, no registration metadata, and no owner information from the settings service: an official page registers without a bundle, a bundle's page with its package name, a row's page with the bundle and the row id its patch declares. A community bundle that ships no browser half has no configuration page; the page renders no generic form from a settings schema.

**Only a save writes.** The form's discard control and its unsaved marker are gone: leaving a page drops the staged edits, which the form does on unmount. A save still writes through the client settings scope with the revision fence.

**The four host-plane pages register from `ui-settings-plugins` while the Host serves their namespaces.** The package keeps the Settings section as the **Built-in plugins** shell around the inventory tab and registers each page through `ctx.slots.inject` when the shared settings mirror shows the namespace, disposing it when the namespace goes, so a deployment that does not compose the owning plugin shows no trace of it. The `settings.plugin.item` slot is retired.

**The Official group.** The optional bundles the installation ships open the group, tagged **Beta** where the feature is one (Agent Teams), with no official tag; the configuration pages follow. Auto review leaves `OPTIONAL_BUNDLES` and the CLI's dependencies: it is a published experimental package the install guide names as its example.

## Consequences

- A bundle's browser half registers a form with one slot registration and its own dictionary; the bundle's patch must declare the row under the id in the key, and the registration exists while the row that carries the bundle's browser half is on: `dsh-client-modules` attaches that half to the row whose specifier is the bare package name, so a row-level page keyed to a subpath row disappears with the root row, not with its own.
- The four pages, their forms, and the settings write path are unchanged; `ui-settings-plugins` keeps its name for the section it still owns while its pages live on the Plugins page.
- Settings lists the inventory only; the settings goldens that carried the Plugins nav entry and the configuration tab were re-recorded.

## Alternatives considered

**Registration metadata on the slot entry.** A slot-declared `meta` share (description, bundle, row) would let one `plugins.item` slot carry every case, at the cost of a new concept in `ui-slots`; the three slots say the same with the API that exists.

**A generic form from the settings schema.** `describe()` already ships each namespace's schemastery schema, so a community namespace without a browser half could get a default form. Deferred: the official pages are curated, a generic form would expose internal namespaces without an allowlist, and attributing a namespace to a bundle needs an owner in the descriptor.

**Keeping the cards in Settings and linking to them from the page.** Cheapest, but the review asked for the form on the plugin's own page.

## Testing

`ui-plugin-manager` unit tests cover the ledger projection, the Official group's cards and pages, a bundle's form, and a row's page; `ui-settings-plugins` tests cover registration per served namespace and its withdrawal, and the form's save-only behavior. The `plugin-config` web lane edits the shell page through the real wire and opens a community fixture's row page after switching its bundle on; the `plugin-manager` lane records the new Official group.
