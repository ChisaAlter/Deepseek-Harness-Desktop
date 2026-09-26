# Decision: Whale persona identity binds to the preset, not a session snapshot

Status: implemented

[中文](2026-09-26-whale-persona-identity-root-fix.md) | English

## Problem

"Her settings never reach her soul" recurred because the loss had several independent mechanisms:

- The persona section was gated on `sessionId === settings.sessionId`: once the resident id rotated or was lost (ten orphan `session-whale-*` shells appeared on 9/23 alone), reopening a stale or fresh conversation silently dropped her persona; the race between first-turn assembly and persisting `sessionId` could also produce a persona-less first turn.
- `scope.get()` read `settings.json` inside the assembly callback — a `JSON.parse` throw on a corrupt file broke every prompt assembly, failing the whole turn, not just the persona.
- With `DSH_HOME` missing, `createWhaleScope('')` placed `settings.json` at a path relative to the Harness process cwd: reads and writes silently split, the persona stayed empty, and nothing errored.
- The pet quick-chat legacy fallback hardcoded 「你是鲸鱼娘」 with none of the configured name, user title, or extra persona — with the assistant off or the transport down she was amnesiac by construction.
- The personality mirror retried only transport failures; an answered rejection (e.g. a snapshot conflict) logged and never resent, losing the value until the next startup re-assertion.
- The configured name sat in one line at the top of an 8KB prompt while history had her repeatedly calling herself 「鲸鱼娘」 and AGENTS.md was titled 「鲸鱼娘的家」 — the model followed the historical self-name and the setting was functionally dead.

## Decision

- Persona gating now means "whale-girl session identity": `session.header.agentPreset === 'whale-girl'` (durable header metadata present from creation, stable across restarts) is the primary signal; the stored `sessionId` match and the whale-home `cwd` match remain as compatibility signals for older sessions. Non-whale sessions still receive nothing.
- All `scope.get()` read paths go through `readSettings`; `read()` falls back to defaults on corrupt JSON/YAML and the next write heals the file.
- `createWhaleScope('')` returns an inert scope: reads give defaults, writes throw — a missing `DSH_HOME` no longer produces a relative-path split write.
- The pet fallback reads the same `data/whale/settings.json` via `getWhaleSettings` (read-only): offline replies still carry the configured name, user title and extra persona; the pet's own personality select (the single control) wins over the catalog value, which only serves as the fallback when the select is invalid.
- The personality mirror now retries answered rejections a bounded number of times (up to 3, 30s apart), resetting the counter when a new value is queued; transport failures still queue without a bound.
- The persona text ends with an identity anchor restating the configured name and user title and voiding older self-names, plus a worked Q&A example (`「你叫什么」→ configured name`) — weak models follow examples better than rules.

## Alternatives considered

- **Keep the sessionId gate, strengthen the wording** — rejected: id rotation, loss, and first-turn timing still zeroed the persona; copy cannot fix structural absence.
- **Clear or rebuild stale whale sessions on id loss** — rejected: violates the standing contract of never touching historical sessions; preset gating heals them for free.
- **Retry mirror rejections forever** — rejected: a genuine rejection (invalid value) never converges; the three-attempt bound splits the difference between healable conflicts and permanent verdicts.
- **Have the pet re-read settings over the loopback RPC** — rejected: the fallback exists precisely when the harness is unreachable; the settings file is local disk state and a direct read is the only viable path.
- **Retitle the seeded 「鲸鱼娘」 lines in AGENTS.md/MEMORY.md** — rejected: both files are user-editable seeds whose titles describe the role, not a self-name claim; editing user files to suppress a marginal echo violates the standing contract.
- **Inject a per-turn system-reminder into each user message** — rejected: it needs a new contribution seam on the session surface (a vendored-harness change), far beyond this fix; the anchor plus example covers the same positional benefit.

## Verification

- `src/main/dsh-whale-orchestration.test.js`: resident-session persona, persona on a whale-girl session with a different id (preset gate), foreign-session isolation, anchor+example assertions, the `complete: true` ban, corrupt settings.json tolerance, inert empty-home scope — 20/20 green, including a real-composition case booting a real `Context` + real `SystemPrompt` + real `apply()`.
- `src/main/pet-chat.test.js`: fallback persona carries configured name/title/extra persona; the pet's personality select wins over the catalog — 43/43.
- `src/main/desktop-live2d.test.js`: bounded retry on answered rejection (≤3), latest value wins, transport failures still queue — 38/38.
- Whale feature-card gate (8 files): 197/197. `npm run check:governance` 6/6, `npm run doc-sync` 8/8.
- **Live verification (2026-09-26, kimi-k3, real turns driven over CDP)**: the session log's `system/message` confirmed the configured name, user title, anchor and example all reached the model; on a bare 「你叫什么」 kimi-k3 still answered 「鲸鱼娘」 — its reasoning shows it reads the override and discards it in favor of history self-names; after one user-voiced correction it answers 「吃白饭的」 and addresses the user as 「爸爸」. Conclusion: the pipeline is complete; a weak model needs one user-side correction to override the historical echo, or a stronger model obeys outright.

## Consequences

- Stale whale sessions, rebuilt sessions, and first turns all receive the persona; setting edits still take effect on the next turn.
- A corrupt `settings.json` no longer kills her session outright — the persona degrades to defaults and the next write self-heals.
- A missing `DSH_HOME` now fails writes explicitly (the client shows the save failure) instead of silently writing to the wrong place.
- The pet offline fallback shares the same soul description as the shared session; the cost is a new read-only file dependency in the pet layer.
- A mirror rejection converges within at most 90 seconds; a permanent rejection is still dropped after three attempts and re-asserted on next startup.
- The identity anchor costs two prompt lines in exchange for name obedience against historical self-naming.
- See also [the configured name must reach the actual prompt](2026-09-24-whale-configured-name-in-prompt.en.md) — the earlier structural cause (an empty `complete` section discarding the entire prompt).
