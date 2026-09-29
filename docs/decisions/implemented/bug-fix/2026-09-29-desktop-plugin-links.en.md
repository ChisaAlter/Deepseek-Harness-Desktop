# Decision: Idempotent built-in plugin link preparation

Status: implemented

[中文](2026-09-29-desktop-plugin-links.md) | English

## Problem

Installed startup reported EEXIST for task-control, platform-session and usage-panel links. Valid links were repeatedly replaced, while existence checks swallowed all read errors, potentially masking the original failure as a creation conflict. Isolated replacement stress did not reproduce the user's environmental trigger; this defensive repair does not explain every observed failure.

## Decision

- Shared preparation reuses junctions resolving to the same directory; directory identity comparison tolerates Windows path casing. Only ENOENT means absent; other errors propagate unchanged.
- Replace symbolic links only, never recursively delete occupying ordinary directories or files; retain usage-panel's existing recognized-copy quarantine and rollback protocol.
- After EEXIST, inspect again and accept only a verified link to the expected directory. Unknown content, wrong targets and unverifiable links still block startup, without bypassing task protection.

## Alternatives considered

Ignoring EEXIST could accept the wrong plugin; clearing node_modules would destroy user content; retrying every filesystem error would hide access failures. Reject these options. Replacing valid links on every start offers no benefit and increases the conflict window.

## Consequences

Valid links are no longer rewritten at startup. Unknown occupying content requires separate handling rather than silent deletion. Regressions cover valid links, read failures, concurrent creation, wrong targets, dangling links and user-content preservation; the installed scenario still needs verification in a later candidate. No installed files or releases are changed here.
