---
description: "The shared Typert Remote protocol: decorators, wire descriptors, codecs, and provider contracts used by business packages, generated artifacts, the Host Gateway, and the Client API."
kind: "package-library"
---

# @deepseek-ai/dsh-typert-protocol

English | [中文](README.zh.md)

## Summary

With `dsh-typert-protocol`, business packages can expose Host methods to Remote clients: mark a method with `@Remote` (or `@RemoteScope` for scoped receivers), bind the service to a wire namespace, and associate Host objects and scoped Contexts with wire identities through the merge-extensible protocol maps. Generated artifacts, the Host Gateway, and the Client API consume the same invocation descriptors, codecs, and provider contracts, so one declaration set stays in sync across every face. The package registers no Cordis service and runs no TypeScript analysis; it declares types and decorator markers only.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This package is for business-package and assembly maintainers who expose Host capabilities to Remote clients. It is a declarations library: mark methods, bind services, and let the generated pipeline and the Gateway do the rest.

### Exposing a Host method

A business package marks a public instance method with `@Remote` (or `@RemoteScope(key)` when the receiver comes from a scoped Context), and the owning service either extends `TypertRemoteService` or declares a `typertRemote` binding through `bindTypertRemote()`:

```text
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export class GoalService extends TypertRemoteService {
  @Remote
  async create(agentId: string, objective: string): Promise<GoalResult> {
    ...
  }
}
```

Generation turns the method into a wire endpoint under the service's namespace; Clients call it as a typed method through `ctx.remote` (see the [API Gateway reference](../../../docs/api-gateway.md)). A method opts into cooperative cancellation by declaring `signal: AbortSignal` as its final parameter — the signal is injected, never a JSON parameter or lookup field.

### Associating Host objects and Contexts with wire identities

Complex Host objects cannot cross the wire directly. A business package declares the association through the merge-extensible `TypertLookupMap` and `TypertContextMap`. Host and Client Context adapters both map `Context` to a wire identity and that identity back to `Context`; the Host adapter also owns the stable wire declaration. Host composition may override its synchronous or asynchronous resolver. A policy rejection can throw `TypertLookupFailure` to carry an adapter-owned failure value to the caller.

### Receiving forwarded Host events on the Client

The Host assembly extends `TypertRemoteEventSelection` with the Cordis events it forwards to consumers, which narrows the `ctx.remote.$on` key set. `TypertForwardableEvent` accepts unscoped `void` notifications and scoped async waterfalls whose final `next()` callback returns the event's result type. `TypertClientEventListener` derives the Client listener from that same `Events` member while preserving signals, optional and readonly fields, arrays, callbacks, and result types. `TypertClientRemote` exposes only `$mount()` and `$on()`; event transport remains private to Gateway.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the declarations stay compiler-independent and where each contract is enforced; the programming model is covered in [Use this package](#use-this-package).

### Design concept

The package keeps reflection out of the compiler: decorator initializers retain markers in a module-private `WeakMap` keyed by the Service prototype, with no constructor symbols, prototype properties, parameter metadata, or runtime reflection fields. Full parameter, result, lookup, and schema reflection is the Typert build pipeline's job, delivered through `InvocationDescriptor`.

### Remote markers

`@Remote` and `@RemoteScope` schedule an initializer that records the method name, an optional export name, and the invocation mode; `remoteMethods(service)` returns a detached declaration-order snapshot that the Gateway's source-mode fallback reads. Markers require public, non-static instance methods with string names, and conflicting markers on one method are rejected.

### Protocol maps and descriptors

The merge-extensible protocol maps keep static associations in the type system, while runtime providers register resolution with `ctx.typert`; the map names and shapes live in [`src/types.ts`](src/types.ts). `InvocationDescriptor` is the shared runtime form consumed by the registry, the Gateway, and the Client Remote, covering direct and Context receivers, JSON and lookup parameters, scope projections, cancellation, and result codecs.

### Wire identity grammar

Every namespace, method, lookup, and Context segment must satisfy `isTypertRemoteSegment()`, so generated names cross the shared RPC carrier unchanged. Strict codecs carry generated schemas; `src-json` codecs identify the weaker source-launch path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Decorators, Gateway bindings, `remoteMethods`, segment validation, `TypertLookupFailure` |
| [`src/types.ts`](src/types.ts) | Protocol maps, `InvocationDescriptor`, codecs, provider contracts, registry interfaces, `TypertClientRemote` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the declarations to the runtime and the call path.

- [API Gateway reference](../../../docs/api-gateway.md) — how the declarations become running Host-to-Client calls.
- [Typert subsystem reference](../../../docs/subsystems/typert.md) — the literal public contracts recorded from protocol and Gateway types.
- [Typert registry](../registry/README.md) — where descriptors and providers are stored at runtime.
- [Typert generator](../generator/README.md) — what generates the consumer-side declarations and descriptors.
- [Remote-call Agent Note](../../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) — the architecture and transport decisions behind Remote calls.

-----

<a id="model-experience"></a>
## Model Experience

None, as compiler-independent Remote protocol declarations register nothing model-facing.

#### KV Cache effect

No direct effect; the declared contracts reach a request only when an assembly places them in one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the declarations can represent; they are current package constraints, not a task backlog.

- **Decorator markers are minimal** — markers contain only the method name and the direct or Context invocation mode; parameter, result, lookup, and schema reflection require the Typert build pipeline.
- **Remote signatures are restricted** — decorators accept only public, non-static instance methods with string names, and source-mode execution cannot represent overloaded, destructured, defaulted, or rest-parameter signatures.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
