# dshbot

Sidebar bot contacts and group rooms for DeepSeek Harness — a **standalone
dsh plugin**. The desktop shell does not bundle or force-load it; install and
remove it like any other plugin.

## Install

In the desktop app: Settings → 插件市场 lists dshbot as a first-party row;
one click installs it through the curated catalog channel (spec below).

Through the official plugin CLI channels:

```sh
# from the standalone repository (the marketplace row uses exactly this spec)
dsh plugin --profile web add github:ChisaAlter/dshbot

# once published to a registry
dsh plugin --profile web add dshbot@0.2.0

# legacy monorepo path spec (curated-catalog-only channel; superseded)
dsh plugin --profile web add github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot
```

On first load the plugin provisions its `dshbot-room` agent preset into
`$DSH_HOME/.agent-presets/` by itself (and refreshes it on upgrades), so no
host-side preset copying is required. Removing the plugin with
`dsh plugin remove dshbot` removes the sidebar tab; the desktop shell also
cleans up the preset directory when no dshbot install remains.

Desktop development: set `dshbotPreset: true` in the desktop config to have
the shell copy this workspace package into the web profile on start
(non-blocking; a failure only logs).

## Publishing to npm

The package is publish-ready (`publishConfig.access: public`, MIT LICENSE,
`files` manifest locked by `src/main/dshbot-publish-manifest.test.js`).
To release `dshbot@<semver>`:

```sh
# 1. bump "version" in vendor/dshbot/package.json (and land it on main)
# 2. preflight locally (also runs in the desktop unit suite)
node scripts/check-dshbot-publish.mjs dshbot-v0.2.0
# 3. tag exactly dshbot-v<version> and push; CI publishes with provenance
git tag dshbot-v0.2.0 && git push origin dshbot-v0.2.0
```

The `Publish dshbot` workflow (`.github/workflows/publish-dshbot.yml`)
requires the `NPM_TOKEN` repository secret (an npm automation token with
publish rights on the `dshbot` name); without it the job fails with a clear
message instead of half-publishing.

## Standalone repository split

The standalone distribution repo [ChisaAlter/dshbot](https://github.com/ChisaAlter/dshbot)
(package at the root) is the public install source; this directory stays the
development copy inside the desktop monorepo (used by the `dshbotPreset` dev
flow and as the export source). The standalone tree is generated from this
directory — never hand-edited — with:

```sh
node scripts/export-dshbot-standalone.mjs <output-dir>
```

The export rewrites `repository`/`homepage` to the standalone repo, ships a
root-layout preflight (`scripts/check-publish.mjs`, `v<semver>` tags) and its
own publish workflow. `src/main/dshbot-publish-manifest.test.js` keeps the
exported tree publishable.

## What it does

- **Desktop fork** — Sidebar "Bots" region tab (`sidebar.nav.tab` /
  `sidebar.page`): 1:1 bot contacts and group rooms, sessions created with
  `origin: 'dshbot'` (hidden from workspace session lists).
- **Official `@deepseek-ai/dsh`** — When the host does not declare region-tab
  seats, the client falls back to a visible `sidebar.footer.action` control
  that opens the same Bot list in a panel (`data-dshbot-official-trigger`).
  Requires **Node ≥ 22.15** (`engines.node`).
- Group rooms follow the Grok talking-circle contract: the room parent never
  calls a chat model; scheduling is peer-equal rounds over
  `ask_participant`, members deliver visible text only through
  `send_room_message` or `(pass)` to stay silent. A member turn is
  tool-filtered to `send_room_message` only, and the member system prompt
  says exactly that. Rooms contain 2–6 bots. The fixed limits are 10 member
  attempts and 3 rounds; pass, failure, and a replayed call without a result
  consume an attempt, and member failures become silent passes.
- A2A: `send_to_agent` messages another bot asynchronously or posts into a
  room; priority only reorders the inbox queue (no runner interrupt). Each
  1:1 bot sees a teammates/rooms directory section in its system prompt.
- `remember` is the only memory write path and appends durable notes under
  `$DSH_HOME/dshbot-memory/`; the profile editor has no memory field.

Protocol symbols live in `lib/group-chat.js`; catalog/scheduling helpers in
`lib/catalog.js`; host glue in `lib/index.js`; host slot probe in
`lib/sidebar-host.js`.
