# dshbot

Sidebar bot contacts and group rooms for DeepSeek Harness — a **standalone
dsh plugin**. The desktop shell does not bundle or force-load it; install and
remove it like any other plugin.

Primary development happens in
[ChisaAlter/Deepseek-Harness-Desktop](https://github.com/ChisaAlter/Deepseek-Harness-Desktop)
(`vendor/dshbot`, exported here with
`scripts/export-dshbot-standalone.mjs`); this repository is the standalone
distribution and npm release home.

## Install

In the desktop app: Settings → 插件市场 lists dshbot as a first-party row;
one click installs it through the curated catalog channel.

Through the official plugin CLI channels:

```sh
# straight from this repository
dsh plugin --profile web add github:ChisaAlter/dshbot

# once published to the npm registry
dsh plugin --profile web add dshbot@0.2.0
```

On first load the plugin provisions its `dshbot-room` agent preset into
`$DSH_HOME/.agent-presets/` by itself (and refreshes it on upgrades), so no
host-side preset copying is required. Removing the plugin with
`dsh plugin remove dshbot` removes the sidebar tab.

## Publishing to npm

To release `dshbot@<semver>`:

```sh
# 1. bump "version" in package.json (land it on main)
# 2. preflight locally (the release workflow runs the same script)
node scripts/check-publish.mjs v0.2.0
# 3. tag exactly v<version> and push; CI publishes with provenance
git tag v0.2.0 && git push origin v0.2.0
```

The `Publish dshbot` workflow (`.github/workflows/publish.yml`) requires the
`NPM_TOKEN` repository secret (an npm automation token with publish rights on
the `dshbot` name); without it the job fails with a clear message instead of
half-publishing.

## What it does

- Sidebar "Bots" tab (`sidebar.nav.tab` slot): 1:1 bot contacts and group
  rooms, sessions created with `origin: 'dshbot'` (hidden from workspace
  session lists).
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
`lib/catalog.js`; host glue in `lib/index.js`.
