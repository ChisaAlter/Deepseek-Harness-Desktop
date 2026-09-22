# Agent Note: Loose modules skip private marker manifests

Status: implemented

English | [中文](2026-09-13-loose-module-private-manifest-skip.zh.md)

## Problem

A loose Loader entry (a file-URL, relative, or absolute module path) resolves its owning package identity by walking up to the nearest `package.json`. That manifest can belong to an unrelated ancestor — a profile or workspace marker such as `{ "name": "dsh-profile-web", "private": true }` with no `version`. The inventory treated any named incomplete manifest as malformed package metadata and threw, which the DeepSeek adapter wrapped as `REQUEST_EXTENSION`, failing every official request in deployments that mount a loose module beneath such a marker.

## Decision

Loose-module resolution treats an incomplete manifest as a marker, not a package claim, when the manifest is nameless or `private`; it contributes no identity. A `private` manifest carrying complete name/version still reports an identity. Non-private named manifests that lack a version keep failing request preparation. Bare package entries keep failing on any malformed manifest, since their manifest came from a real package resolution.

## Alternatives considered

**Skip every incomplete manifest for loose modules.** A named non-private manifest is a deliberate package claim; silently omitting it would hide genuinely malformed packages. The `private` marker is the observable boundary between a package claim and an ancestor marker.

**Bound the upward manifest walk.** Limiting `nearestManifest` to the Loader tree base or the entry's own directory would also dodge unrelated markers but changes resolution semantics beyond the observed failure and can strand legitimate owning manifests.

**Fix only in the mounting deployment.** Shipping a `package.json` beside each loose module repairs that deployment but leaves every other loose mount one ancestor marker away from failing all requests.

## Consequences

Requests no longer fail when a loose module sits under a private profile or workspace marker. Deployments that mount loose modules without a sibling manifest contribute no package identity rather than an error or a wrong one. Malformed package claims still fail loud. [Inventory tests](../../../../packages/llm/plugin-package-inventory-deepseek/tests/inventory.spec.ts) cover the private-marker skip and complete private manifests.
