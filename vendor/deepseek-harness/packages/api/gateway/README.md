---
description: "Typed Client-to-Host calls and streams: dispatch, validation, cancellation, reconnection, and forwarded Host events."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gateway

English | [中文](README.zh.md)

## Summary

Two-sided Typert RPC endpoint for Host and Client Cordis environments. The Host entry provides `ctx.typertGateway`, while `@deepseek-ai/dsh-api-gateway/client` provides `ctx.remote`; both consume the same generated `InvocationDescriptor` contract and leave business selection to API Remotes. Connection carries unary request correlation, trust, and response envelopes, while Gateway owns multiplexed Remote streams.

## Table of Contents

- [Host service: `TypertGatewayService` (ctx key: `typertGateway`)](#host-service-typertgatewayservice-ctx-key-typertgateway)
- [Client service: `ClientRemote` (ctx key: `remote`)](#client-service-clientremote-ctx-key-remote)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="host-service-typertgatewayservice-ctx-key-typertgateway"></a>
## Host service: `TypertGatewayService` (ctx key: `typertGateway`)

`ctx.typertGateway.invoke()` resolves the current descriptor and Cordis Service for each call, validates exact named arguments, resolves registered object or Context identities, invokes the public business method, and validates its result. Business Services extend `TypertRemoteService` and mark methods with `@Remote` or `@RemoteScope` from [`dsh-typert-protocol`](../../typert/protocol/README.md); `bindTypertRemote()` remains available when another base class owns inheritance.

Strict mode reads generated invocation descriptors from `ctx.typert.local`. Lookup parameters use the currently active resolver in `ctx.typert.lookups`: the business package registers the stable declaration and default policy, while Host composition can override resolution behavior with effect-scoped `configure()`; `@RemoteScope` resolves its receiver through a registered Host Context adapter. SRC mode is a development fallback for endpoints that have never had a strict definition; it parses simple parameter names and accepts only JSON-safe values for non-lookup parameters. Withdrawing an observed strict definition fails instead of weakening validation.

The Host entry registers a trusted-host interceptor on Connection's shared `/api` FetchHandler. Connection passes this composite handler through its HTTP bridge; the handler dispatches claimed endpoints to Gateway and returns 404 for unclaimed requests unless an exact Fetch route owns them. Direct `invoke()` calls preserve business errors; `TypertGatewayError` distinguishes failures owned by dispatch, binding, providers, lookup, Context, arguments, and codecs. A resolver may use `TypertLookupFailure` to carry an existing RPC error, preserving its original error code for policy rejections such as cold-resume failures or ownership fences.

A cancellation-aware Remote method declares `signal: AbortSignal` as its final Host parameter. The signal is descriptor metadata rather than a wire argument: Connection supplies it to the Gateway, and the Gateway injects it after decoded business parameters. SRC recognizes the reserved final name, while strict generation additionally requires the global `AbortSignal` type.

A stream Remote uses `@Remote({ mode: 'stream' })` and returns an `Iterable` or `AsyncIterable`. `ctx.typertGateway.stream()` applies the same endpoint, argument, lookup, and cancellation checks as unary invocation, then validates each yielded item with the generated result codec. The Client opens the Gateway-owned `/api/remote.mux` WebSocket when its plugin activates, keeps it connected while idle, and retries physical connection failures with capped backoff. The Host sends Ping control frames at the configured `websocketHeartbeatIntervalMs` interval (30 seconds by default), and the browser answers Pong at the WebSocket protocol layer, so idle network intermediaries see traffic without any Remote stream frame. Independently cancellable logical streams share that socket; an in-process Connection carrier provides equivalent streams directly without opening it.

Host composition can register one application event source through `registerRemoteEvents()`. Gateway reserves the internal `$events` logical endpoint for that source, accepts only empty `args`, and aborts streams opened by the registration when the source is withdrawn. API Remotes owns the event selection, argument validation, per-Client queues, and the Host home sent in the opening `{ type: 'ready', clientId, host: { home } }` frame. Its source factory attaches incremental listeners synchronously, so the Client publishes the generation and starts baseline reads only after incremental delivery is ready.

<a id="client-service-clientremote-ctx-key-remote"></a>
## Client service: `ClientRemote` (ctx key: `remote`)

`ctx.remote.$mount()` validates and registers a generated Host-for-Client contribution, then installs concrete direct and scoped methods for the calling Cordis fiber. Each namespace is a traced `remote.<namespace>` child Service and unloads after its last method is withdrawn. Duplicate endpoints, namespace collisions, and descriptors without strict generated codecs fail before methods become callable.

Each unary call validates positional inputs, constructs the descriptor's exact named `args`, and sends it through `ctx.connection.rpc.call('/api', endpoint, ...)`. A generated stream method returns an `AsyncIterable` and opens one logical stream through an in-process Connection carrier when available, otherwise through the shared Gateway WebSocket. Generated cancellation-aware methods accept a final optional `AbortSignal`; the Client combines it with the contribution mount lifetime before invoking the carrier. Unary results and every stream item are validated before reaching application code. Withdrawing a contribution removes its descriptors and methods together, aborts in-flight calls and streams, and makes retained method handles reject.

`ctx.remote.$stream()` returns a single-consumer `RemoteStream` spanning physical carrier generations. It permits one immediate retry while the Host remains available, otherwise waits for the next connected Host generation, and annotates each item with its physical generation. The domain consumer validates and accepts each generation's opening value; business and protocol failures remain terminal. `RemoteSnapshotStream` adds one opening snapshot followed by deltas. `RemoteJournalStream` adds follow-before-page opening, pagination, reconnect catch-up, and gap repair over domain-defined inclusive entry ranges; it removes complete duplicates and rejects gaps, inverted ranges, and partial overlaps. Disposing any stream cancels its requests and resolves after the active iterator is fully stopped.

`ctx.remote.$on()` subscribes to one forwarded Host event. Its legal keys are exactly the Host assembly's forwarding selection, and the listener type is the owning package's own Cordis `Events` declaration, so no second signature can drift from it. Each subscription belongs to the calling fiber and disappears with it. The Client Remote service registers the `$events` pump as a Connection generation source when it activates, whether any `$on` listener exists. Browsers use Remote mux, while in-process compositions use `connection.rpc.open`; the opening `ready` item establishes a Connection generation and supplies its Host facts. Carrier failure, Remote stream failure, unexpected normal completion, a non-ready opening item, or a malformed event item ends that generation and lets Connection reopen it after backoff. Ordinary notifications run in registration order and isolate listener failures. Agent-scoped waterfalls let a listener return a result, call `next()`, or reject; Gateway returns that outcome through the existing HTTP unary carrier.

Generated declaration merges provide the TypeScript API through the shared `TypertClientRemote` contract. The Client entry contains no Host Service or Host Cordis interface merge, and method lookup and invocation use ordinary objects and functions rather than a JavaScript Proxy.

<a id="model-experience"></a>
## Model Experience

None, as the package dispatches application calls and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; invoked business Services own any model-visible result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Connection adapter maps ordinary dispatch failures and business exceptions to the RPC `internal` code with empty details; lookup-policy errors carried by `TypertLookupFailure` are returned unchanged. Structured `TypertGatewayError` categories remain available only to same-process callers.
- SRC mode supports unique identifier parameters without destructuring, defaults, or rest parameters. It validates JSON safety rather than generated business types and never infers optional fields.
- Only strict generated contributions can mount on the Client face. SRC markers have no Client codec or type projection.
- `$stream()` supervises carrier replacement but does not infer replay semantics; each domain owns its resume cursor or replacement-baseline validation and normal-end classification. Connection generations reopen the internal `$events` stream; one-way notifications are not replayed, while pending scoped waterfalls retain their event id across replay.
- Lookup resolvers are configured per key; an individual Remote parameter or endpoint cannot currently select a live-only policy under the same `agent`/`session` key.
- Forwarded events reach `$on` without business-payload projection or redaction. Ordinary notifications are not replayed after reconnect; Agent-scoped waterfalls project only the top-level Agent identity needed to select the Client Context and carry their own pending lifetime.
- WebSocket heartbeats keep idle intermediaries active but do not require a timely Pong or terminate an unresponsive peer. Half-open carriers remain subject to TCP or intermediary failure detection before the Client reconnects.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
