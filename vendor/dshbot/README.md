# dshbot

The current product scope is the local Hermes Bots workflow set, using the
local Hermes implementation as the primary behavioral reference. This includes
the local roster, stable Bot and room conversations, profile and capability
configuration, memory, A2A messages and tasks, routines, and bounded room
workflows. Local avatar upload and deterministic/default blob avatar records
remain supported and are preserved.

Cross-device/cross-Connection Bots, remote gateway, avatar generation, and Pet
are explicitly out of scope. They are not pending gaps or acceptance work.

The current working tree completed its local Loader, package, browser, Harness,
and real Electron/provider acceptance on 2026-09-09. See
`docs/development-plan.md` for the exact verification boundary and evidence.

Sidebar bot contacts and group rooms for DeepSeek Harness — a **standalone
dsh plugin**. The desktop shell does not bundle or force-load it; install and
remove it like any other plugin.

This repository owns development, tests and distribution. The desktop repository
does not contain or export a development copy. The current compatibility target
is the desktop's updated Harness `0.1.3-alpha.1` checkout with the generic
`session.setPresentation` API and owned-session navigation consumers. The version
number alone is insufficient: an unmodified older Host lacks this contract.
No publication or default-home installation is implied by this document.

## Install

Install as an ordinary user plugin. The desktop does not ship a first-party
recommendation or automatically enable dshbot.

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
  rooms with catalog-bound session IDs. The previous `origin: 'dshbot'` create
  field is not supported by current Harness and has been removed. The local
  contract keeps plugin-owned conversations out of ordinary session flows and
  does not replace a missing binding with a blank session.
- Group rooms follow the Grok talking-circle contract: the room parent never
  calls a chat model; scheduling is peer-equal rounds over
  `ask_participant`, members deliver visible text only through
  `send_room_message` or `(pass)` to stay silent. Member turns run in persistent
  hidden Sessions with the Bot's ordinary tools, Skills, MCP and capability
  guard; cross-Bot delegation tools are withheld to prevent recursive routing.
  Only `send_room_message` plain text is delivered visibly to the room. Rooms
  contain 2–6 bots. Per-room limits can be configured
  up to 10 total visible member deliveries and 3 rounds; passes and failures do not spend the visible
  delivery budget. An all-pass round stops the room, and replayed calls without
  a result do not advance the speaker queue.
- A2A: `send_to_agent` messages another bot asynchronously or posts into a
  room; priority only reorders the inbox queue (no runner interrupt). Each
  1:1 bot sees a teammates/rooms directory section in its system prompt.
- Structured work handoff: `delegate_to_agent` creates a durable task with a
  task, constraints, success criteria, and optional idempotency key;
  `update_task` records an explicit completed/failed result and notifies the
  requester; `list_tasks` exposes task state and attempt counts. Delegation is
  allowed to a shared-room peer or to a target that explicitly lists the
  sender in `allowedSenderIds`; an empty target allowlist keeps ordinary
  `send_to_agent` messages compatible but does not grant arbitrary task work.
- A2A task and message transitions append a bounded audit trail to the dshbot
  catalog (`queued`, `delivered`, `completed`, `failed`, and refusal events),
  without adding a database or worker service.
- `remember` is the only memory write path and appends durable notes under
  `$DSH_HOME/dshbot-memory/`; the profile editor has no memory field.
- Avatars are local profile data: a local JPEG/PNG upload or a
  deterministic/default blob avatar is retained. Existing and default blob
  records are preserved; generated avatars are out of scope.

Protocol symbols live in `lib/group-chat.js`; catalog/scheduling helpers in
`lib/catalog.js`; host glue in `lib/index.js`.

## Local development

Use an already built Harness checkout without changing its dependencies:

```sh
npm run dev:link -- ../Deepseek-Harness-Desktop/vendor/deepseek-harness
npm test
npm run test:integration
npm run test:client
npm run test:client:full
npm run dev:client
```

The link script creates development-only workspace links in `node_modules` and
refuses to replace an existing dependency pointing somewhere else. Tests use
temporary homes, never the installed desktop's settings or conversation data.
See `docs/development-plan.md` for the staged development scope.

The client fixture requires the sibling built Harness checkout (override with
`DSH_HARNESS_ROOT`) and its Vite/Playwright dependencies, including Chromium.
It mounts the actual plugin client with real React and Harness primitives over
isolated sample catalog/session services. The preview command prints its local
URL and picks another port if occupied. No installed plugin data is loaded.

## Bot workflows

The Bot page has Contacts, Tasks and Routines views. Tasks support text/status filters,
live details, participant conversations, constraints, acceptance
criteria, outcomes, delivery attempts, and events. Missing participants never
create replacement conversations; delivered does not claim execution is running.

Queued tasks can pause/resume. Cancel marks a task terminal and prevents late
results from changing it; it cannot undo external actions. Retry creates a new
linked task after checking current delegation permissions. Stopping a bot is a
separate confirmed whole-conversation operation; room stop also aborts members.

The profile editor configures message/task sources using the existing allowlist.
Default allows ordinary messages and shared-room delegation. Selected bots
restrict both to the chosen contacts, and require a nonempty valid selection.
Profile saves preserve mailbox/task data and keep the draft open on rejected
writes or revision conflicts. Read-only and unavailable catalogs cannot be edited.

Tool, Skills and MCP selections use actual execution guards, including nested
agent tool calls. All preserves existing behavior; Selected with no entries
denies that category. Skills selection controls the skill loader, not arbitrary
filesystem access. MCP selection controls already-connected tools, not server
installation or credentials. These controls are not an operating-system sandbox.

Routines offer create/edit, enable/pause, run-now and delete for ordinary bots.
Intervals are 1 minute to 1 year, with at most 100 schedules. Missed intervals
coalesce into one run when the Host is available; there is no background execution
after the plugin or desktop exits. A queued/running attempt cannot overlap with
another run of the same routine. Busy bots wait until a later tick. Cold sessions
resume through the existing Session Controller with their original composition.
Pausing removes queued mail but does not stop an active model turn. Model failure
disables the schedule and quarantines retained mail until explicit recovery;
three unavailable-session failures also disable it. Run-now on a paused routine
does not enable future intervals. Errors and run outcomes remain visible.

## Persistence and delivery

Catalog writes await the settings provider and supply the revision read by the
operation. A conflicting write fails instead of replacing newer inboxes, tasks,
or contact edits. Internal, side-effect-free inbox projections may recompute on
a conflict (bounded to three attempts); user edits are never silently retried.
Writes patch only changed catalog fields and preserve other
settings namespaces. Message/task wake-up occurs only after the inbox is saved.

Live wake-up uses `ctx.agents` and identified, plugin-sourced relay messages.
Room scheduling recognizes dshbot relay input without changing its logged
provenance to a user message. Assistant history helpers read the current nested
message envelope; this does not rewrite any stored session generation.
Acceptance into an agent inbox is not execution or completion: durable bot mail
remains until a consuming model stream completes. Failed or cancelled streams
retain mail, and a failed acknowledgement can be retried. Delivery is
at-least-once, not exactly-once across crashes; callers should use task
idempotency keys and verify results before repeating external actions.
Failed scheduled mail is quarantined rather than replayed into a later ordinary
conversation; explicitly running again gives it a new run identity.

## Historical checks

Earlier records from 2026-09-08 include unit/compatibility tests, scoped
Loader/transport integrations, browser scenarios, and Harness Web/Electron
checks. They are retained for provenance in the linked documents, but were
checkpoint evidence rather than final acceptance for this working tree.

## Current verification

The 2026-09-09 working tree passed 223 package tests, 48 client workflow tests,
the real full-shell client gate, package/publish inspection (including
`npm pack --dry-run`), both Harness TypeScript project builds, the official
Harness build, and the focused 70-test Conversation/Trajectory GUI gate. All 11
Loader scenarios passed; one aggregate serial invocation was interrupted by an
environmental `ENOSPC`, after which the affected eight-scenario Loader file
passed in full.

The final visible Electron acceptance used an isolated desktop profile and a
real configured provider. It verified the canonical Bot conversation, managed
composer with profile-owned model, exact replies, section persistence, GitHub
Skill installation/provenance, process restart, history recovery, and a second
model reply from the existing conversation. Evidence is written under
`artifacts/client-workflows/electron-acceptance-20260909-complete/`.

No plugin was enabled in the user's default profile, and this working tree was
not published.
