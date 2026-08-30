---
description: "The Branded<B> nominal-typing primitive for packages that own ids crossing package boundaries, and the policy for when to brand."
kind: "package-library"
---

# @deepseek-ai/dsh-brand

English | [中文](README.zh.md)

## Summary

`dsh-brand` makes structurally identical strings non-interchangeable at the type level with its `Branded<B>` primitive: a `SessionId` cannot be passed where a `ToolCallId` is expected even though both are plain `string`s at runtime. Comparison, logging, JSON serialization, and the wire format all behave exactly as for ordinary strings because the brand is erased at compile time. It is a type-only package with no runtime code and no dependency on other harness packages, so any package can brand the ids it owns without importing an unrelated capability package. Packages that own a cross-package id — `ToolCallId` in `dsh-llm`, the shared agent/session `SessionId`, `JobId` in `dsh-jobs` — brand that id and construct it through a per-id factory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Brand the ids a package owns when they cross a package boundary and could plausibly be confused with another package's ids; not every string needs a brand. A branded id is a contract for TypeScript callers: it only ever enters the functions that expect it, and an id from another package is rejected at compile time.

### Branding an id

Declare the branded type and its construction factory in the owning package:

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

export type SessionId = Branded<'SessionId'>

/** Brand a string as a SessionId (a plain cast — zero runtime cost). */
export function SessionId(id: string): SessionId {
  return id as SessionId
}
```

The factory is a plain cast with zero runtime cost. Once branded, the id flows through the codebase as an ordinary string: it compares, logs, serializes to JSON, and crosses the wire without any special handling.

### When to brand

Brand ids that cross package boundaries and could plausibly be confused — `ToolCallId` in `dsh-llm`, the shared agent/session `SessionId` in `dsh-session`, `JobId` in `dsh-jobs`, `LspProviderId` in `dsh-lsp`. Do not brand every string: the cost is a factory at every construction site and a type import in every consumer, so ids that never leave their owning package do not earn it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The primitive is one intersection type: `string & { readonly [BRAND]: B }`, where `BRAND` is a module-private `unique symbol`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `Branded<B>` type and the private `BRAND` symbol — the whole package |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; erasure is enforced by the compiler) |

### How erasure works

The symbol never exists at runtime: the type is erased during compilation, so a branded value is a plain string with no tag, no prototype, and no runtime check. Construction is a cast inside the owning package's factory, so a brand is only ever created where the owning package says it is.

### Why it stays dependency-free

Keeping `Branded` in its own package means `dsh-jobs` can brand `JobId` without importing an unrelated capability package just to reach the primitive, and the brand vocabulary has exactly one owner.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you need the ids this primitive brands or the type conventions around it.

- [Core subsystem](../../../docs/subsystems/core.md) — where the shared `SessionId` brand and the type rules are documented.
- [LSP subsystem](../../../docs/subsystems/lsp.md) — `LspProviderId`, a branded provider id built on this primitive.
- [Jobs package](../../jobs/jobs/README.md) — the `JobId` brand owned by the jobs capability.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
