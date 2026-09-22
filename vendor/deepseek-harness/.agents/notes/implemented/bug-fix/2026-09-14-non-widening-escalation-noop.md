# Agent Note: Non-widening sandbox escalation resolves to the effective mode

Status: implemented

English | [中文](2026-09-14-non-widening-escalation-noop.zh.md)

## Problem

`approveEscalation` threw `sandbox escalation to "<mode>" is not strictly wider than this call's current "<effective>" mode` for every non-widening request — including a `danger-full-access` session asking for `danger-full-access`, the ceiling case `WIDER_MODES` can never contain. The tool registry turned the throw into an isError result: nothing ran, the model retried the same arguments, and the loop repeated. No privilege was ever at stake; the error was pure friction.

## Decision

A request naming a real escalation target (`ESCALATION_TARGETS`) against a recognized effective mode that does not strictly widen is not an escalation: `approveEscalation` returns `effectiveMode`, the caller stamps the policy unchanged, and no approval is asked. Requests still fail closed when the target sits outside the closed vocabulary (`read-only` or an arbitrary string) or the effective mode itself is unrecognized — corrupted session state keeps failing loud. The approval chain for genuinely widening requests is untouched. This narrows the original fail-closed rule in [the sandbox note](../feature/2026-07-06-sandbox.md), whose shipped-fact lines were updated in place.

## Alternatives considered

**Keep the throw with friendlier text.** The model could still loop on the corrected message, and the error remains pure friction — the call would have run identically without the parameter.

**Return the requested mode for narrower asks** (e.g. `workspace-write` under a `danger-full-access` session). That is a per-call confinement feature the parameter was never designed for; treating the request as a no-op matches what omitting `sandbox_permissions` would do.

**Fail closed on any non-widening request.** That is the pre-fix behavior being removed.

## Consequences

`dsh-tool-bash`, `dsh-tool-pwsh`, and `dsh-tool-fs` calls carrying a redundant or already-covered `sandbox_permissions` now execute under their standing policy instead of erroring. Out-of-vocabulary targets and unrecognized effective modes still produce the verbatim `not strictly wider` failure without prompting. Widening requests still resolve through `ctx.approval` with the same four-outcome mapping.
