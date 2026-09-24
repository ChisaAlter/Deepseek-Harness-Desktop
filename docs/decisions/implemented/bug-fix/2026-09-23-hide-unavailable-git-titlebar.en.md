# Decision: Hide titlebar Git actions when status is unavailable

Status: implemented

[中文](2026-09-23-hide-unavailable-git-titlebar.md) | English

## Problem

When a session has no working directory, or its Git status is loading, returns `null`, or rejects, the titlebar still renders a disabled Commit button, an empty branch control, and an openable dropdown. The dropdown has no usable action and can appear as a thin white strip in a narrow window. The group also consumes space when the right panel opens.

## Decision

`ui-git` renders the titlebar Git group only when the current session has a working directory, status for that directory has loaded, and a valid status object exists. Loaded state is tied to cwd, so switching directories never flashes controls from the previous repository. A confirmed `isRepo:false` still renders Initialize Git. A valid repository keeps its branch control and menu even when the quick action is disabled, because other actions can remain useful. Existing focus and workspace-registration signals retry failed status reads and reveal the group after recovery. Progress feedback remains independent of titlebar visibility.

## Alternatives considered

- **Hide only the disabled Commit button**: the empty branch, dividers, and dropdown would still leave a useless strip.
- **Hide the group whenever the quick action is disabled**: a clean repository can still have useful branch and menu actions.
- **Show Initialize Git for unavailable status**: `null` may signal authorization or IPC failure and does not prove a non-repository.

## Consequences

The titlebar has no Git placeholder while status loads, then shows the group at the current density after a successful read. The unavailable dropdown is absent; valid repositories and the non-repository initialization path keep their behavior. `git-actions.client.spec.tsx` covers missing cwd, loading, cwd changes, `null`, rejected IPC, recovery after workspace registration, and non-repository initialization.
