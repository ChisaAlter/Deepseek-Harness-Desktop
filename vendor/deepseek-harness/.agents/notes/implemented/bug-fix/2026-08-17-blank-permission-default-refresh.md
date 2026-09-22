# Agent Note: Refresh blank session permission defaults

Status: implemented

English | [中文](2026-08-17-blank-permission-default-refresh.zh.md)

## Problem

The Web New Session flow reuses a workspace's blank session instead of minting another hidden placeholder. Permission defaults are pinned into a session at creation time, so changing the General settings permission row after a blank placeholder already existed left that placeholder on the previous preset. The next "new" conversation could therefore reuse a blank session whose permission chip contradicted the newly saved default.

## Decision

The Web workspace runtime owns candidate selection: a reusable session must be blank, belong to the selected Workspace, match its canonical cwd, and not be archived. Instead of returning that id directly, `WorkspaceRuntime.connectWorkspace` explicitly adopts it through `session.create` with `reuseWorkspaceBlank: true`. The host rechecks blankness, Workspace membership, cwd, and archive state before notification, and can resume a cold persisted placeholder before notifying optional default owners about the exact eligible session.

`dsh-permission-presets` records each `permission/preset` origin as `default`, `selection`, or `inferred`. On confirmed reuse, it advances the session to the current `defaultPreset` only when no turn has started, the latest selection is default-origin, and the effective sandbox and approval knobs still match that selection. Explicit picks, inferred or origin-less legacy selections, and independently changed knobs remain pinned. The update goes through the normal preset writer, so durable `permission/preset`, `sandbox/mode`, and `approval/policy` facts remain the source for projections and execution.

This partially refines the earlier [permission default for new sessions](../../archived/feature/2026-07-31-permission-default-for-new-sessions.md) decision: a settings write alone does not mutate an existing session, while the later confirmed reuse of a default-origin Workspace blank may advance it after live or cold adoption.

## Alternatives considered

**Disable blank-session reuse after any permission settings change.** Rejected because it would leave extra hidden placeholders and make New Session less deterministic. The existing reuse policy is valuable; only stale permission defaults were wrong.

**Have the client compare a blank session's permission projection with the Settings row.** Rejected because the workspace runtime would need to understand the permission settings namespace. The client reports only its reuse decision; the permission service owns the default-origin test and update.

**Scan every live blank session when Settings changes.** Rejected because the live store omits cold persisted placeholders and includes blank sessions that Web cannot reuse, such as archived or non-member sessions. It also cannot distinguish an old default from an explicit selection after restart without a durable origin.

## Consequences

A Settings change does not rewrite an existing session. Confirmed New Session reuse may append permission facts to a live or cold default-origin placeholder, which remains blank because blankness is defined by the absence of `turn/start`. Started conversations, ordinary seeded resumes, explicit selections, and sessions outside the Web reuse decision keep their permission.
