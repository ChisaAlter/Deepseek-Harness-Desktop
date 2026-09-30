# Agent Note: Stage build input ownership

Status: implemented

English | [中文](2026-09-30-stage-build-input-ownership.zh.md)

## Problem

Stage credentials omitted build helpers under `scripts/` and Cordis workspaces under `vendor/`, although client bundling imports those helpers and host compilation references those workspaces. Editing them without changing Git HEAD left the source-start path using stale artifacts. Native credentials also selected `entry/bin`, while the native builder writes each host's platform package.

## Decision

The stage layouts include root build manifests, build helpers, vendored sources and native declarations. Generated ownership uses exact roots: vendored and native entry `lib/` files belong to host compilation, while the native stage records the current host's platform `bin/`. A source directory named `lib` below `src/` remains an input. Each scan separates generated outputs from sources before computing credentials.

## Alternatives considered

**Force every build.** This refreshes omitted inputs but discards verified stage reuse. Complete input and output ownership retains reuse while invalidating edits.

**Treat every directory named lib as generated.** This avoids output feedback but excludes real source helpers. Exact package output roots preserve those inputs.

## Consequences

Existing credentials refresh when the expanded path sets differ. Editing shared build helpers may rebuild more than one stage because their input sets are conservative. Native credentials now follow the builder's actual host output directory. The credential format and compilation commands stay unchanged.

## Testing

`scripts/build-stage-credentials.client.spec.ts` covers unchanged reuse, helper and vendored source edits, vendored output tampering without input feedback, platform native declarations, and missing or malformed credentials.
