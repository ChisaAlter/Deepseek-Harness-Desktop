# Agent Note: Malformed tool-call recovery

Status: implemented

English | [中文](2026-08-27-malformed-tool-call-recovery.zh.md)

## Problem

Provider streams could omit a tool function name or call id. The DeepSeek adapter and shared `BlockAssembler` replaced those missing values with empty strings, so the agent persisted an assistant tool call before `ToolRuntime` discovered `unknown tool ""`. That malformed call and its result then remained in provider history and could make every later request fail.

## Decision

Tool-call identity has one shared contract: the provider call id is non-empty and the function name matches `[A-Za-z0-9_-]{1,64}`.

- Both adapters preserve absence while streaming and reject an invalid completed identity as `MALFORMED_RESPONSE`.
- `BlockAssembler` validates both completed blocks and delta-only assembly without inventing fallback values.
- The agent loop validates assembled calls before `assistant/message`, offers malformed responses to `agent/request-error`, and persists or executes nothing from the failed attempt.
- The default normal retry policy includes `MALFORMED_RESPONSE`, because the rejected attempt contributed no durable assistant message.
- `Session.deriveMessages()` removes malformed calls and suppresses their results in projection. It preserves other content and valid calls, but drops adapter replay metadata from a changed message. Durable events remain untouched.
- `ToolRuntime.register()` enforces the same name grammar at the producer boundary.

## Alternatives considered

**Reject only in `ToolRuntime.execute()`.** This is too late: the assistant call is already durable, and returning `UNKNOWN_TOOL` preserves the malformed identity in every later provider request.

**Replace a missing name or id with a placeholder.** A fabricated identity can select no real capability and creates a false call/result pair. Classifying the response as malformed lets the bounded request-recovery policy obtain a valid response instead.

**Rewrite poisoned session events.** Session events are append-only evidence. Repairing only the derived provider transcript recovers old sessions without changing durable history or tool-outcome records.

## Consequences

New malformed responses retry without poisoning session history. Existing sessions containing empty-name calls recover on their next request. Direct consumers of `BlockAssembler` receive a structured protocol error and must handle it like any other failed model response.

## Verification

Focused tests cover both adapters, assembly, retry-policy defaults, no persistence or execution before retry, a successful later prompt, poisoned transcript projection, and tool registration names.
