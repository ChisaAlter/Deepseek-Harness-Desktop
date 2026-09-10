# Agent Note: MCP Settings test connection

Status: implemented

English | [中文](2026-09-08-mcp-settings-test-connection.zh.md)

## Problem

MCP Settings had live health and a remounting `retry`, but no action that tested an existing managed configuration without changing the document or the live `mcp-client` child. Remounting and reading health could not prove a fresh initialize and tool discovery worked.

## Decision

Host Remote `mcpServers.test({ id })` resolves an existing managed record from the raw file service or an existing read-only composition row, then creates a private MCP SDK client and transport. The probe completes initialize and every paginated `tools/list` page, returns server name, transport, raw tool names, count, and elapsed time, and closes the temporary client/transport before returning. A bounded combined signal covers Remote cancellation and a ten-second timeout; close is separately bounded. The probe never calls `remount`, writes the managed document, creates a Loader child, reserves a live `serverName`, or touches `ctx.tools`.

The MCP Settings rows call this Remote directly. Managed and composition rows show one pending-safe Test action, a short success summary, or the Remote error. Existing retry, OAuth, edit, delete, and enablement paths remain separate. This partially supersedes the earlier MCP settings note's statement that there was no connection-test button; its catalog ownership and live-health decisions remain current.

## Alternatives considered

**Remount the live child and read `list` afterward.** Rejected because it mutates lifecycle state, provides no independent fresh-connection proof, and can collide with live tool registration.

**Reuse the live `mcp-client` supervisor.** Rejected because it owns the registered tool generation and `serverName` reservation; Settings needs a disposable, side-effect-free probe.

## Consequences

Settings can report real initialize and tool discovery failures without changing MCP configuration or model-visible tools. Composition rows are testable because the probe consumes their resolved config without adopting their Loader child. Stdio subprocesses and Streamable HTTP transports are closed on success, failure, cancellation, and timeout.

## Testing

Focused Host tests cover stdio and HTTP success, paginated discovery, connection failure, timeout cleanup, and cancellation cleanup. Gateway tests prove managed and composition resolution without remount, document mutation, or tool registration. Client tests cover pending duplicate suppression, success summaries, and error rendering while preserving retry behavior. Host and Client TypeScript checks pass after Typert generation.

## Related

[MCP and Skill settings management](2026-08-14-mcp-and-skill-settings.md).
[MCP Settings signs in HTTP servers](2026-08-20-mcp-settings-oauth.md).
