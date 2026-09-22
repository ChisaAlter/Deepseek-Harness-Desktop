import { describe, expect, test } from "vitest";

import {
  ProviderSnapshotEntrySchema as LegacyProviderSnapshotEntrySchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "../messages.js";
import {
  DiagnosticsRequestSchema,
  DiagnosticsResponseSchema,
  ProviderInboundMessageSchemas,
  ProviderOutboundMessageSchemas,
  ProviderSnapshotEntrySchema,
  GetProvidersSnapshotResponseMessageSchema,
} from "./messages.js";

function schemaTypes(schemas: readonly { shape: { type: { value: string } } }[]): string[] {
  return schemas.map((schema) => schema.shape.type.value);
}

describe("provider message domain", () => {
  test("owns unique inbound and outbound message type sets", () => {
    const inboundTypes = schemaTypes(ProviderInboundMessageSchemas);
    const outboundTypes = schemaTypes(ProviderOutboundMessageSchemas);

    expect(inboundTypes).toHaveLength(11);
    expect(new Set(inboundTypes).size).toBe(inboundTypes.length);
    expect(outboundTypes).toHaveLength(12);
    expect(new Set(outboundTypes).size).toBe(outboundTypes.length);
  });

  test("keeps direct schemas and aggregate session unions aligned", () => {
    const request = DiagnosticsRequestSchema.parse({
      type: "diagnostics.request",
      requestId: "request-1",
      includeLogs: true,
      maxLogLines: 120,
    });
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = DiagnosticsResponseSchema.parse({
      type: "diagnostics.response",
      payload: {
        requestId: "request-1",
        diagnostic: "healthy",
      },
    });
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("bounds explicitly requested daemon log context", () => {
    expect(
      DiagnosticsRequestSchema.safeParse({
        type: "diagnostics.request",
        requestId: "request-1",
        includeLogs: true,
        maxLogLines: 201,
      }).success,
    ).toBe(false);
  });

  test("accepts structured snapshot reasons and canonical workspace scope", () => {
    const response = GetProvidersSnapshotResponseMessageSchema.parse({
      type: "get_providers_snapshot_response",
      payload: {
        cwd: "C:\\workspace\\project",
        entries: [
          {
            provider: "pi",
            status: "unavailable",
            statusReason: "command_unavailable",
            enabled: true,
          },
        ],
        generatedAt: "2026-01-01T00:00:00.000Z",
        requestId: "snapshot-1",
      },
    });

    expect(response.payload.cwd).toBe("C:\\workspace\\project");
    expect(response.payload.entries[0]?.statusReason).toBe("command_unavailable");
  });
  test("keeps old snapshot responses valid when new fields are absent", () => {
    expect(
      GetProvidersSnapshotResponseMessageSchema.parse({
        type: "get_providers_snapshot_response",
        payload: {
          entries: [],
          generatedAt: "2026-01-01T00:00:00.000Z",
          requestId: "legacy-1",
        },
      }),
    ).toEqual({
      type: "get_providers_snapshot_response",
      payload: {
        entries: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
        requestId: "legacy-1",
      },
    });
  });

  test("keeps the legacy messages export wired to provider schemas", () => {
    expect(LegacyProviderSnapshotEntrySchema).toBe(ProviderSnapshotEntrySchema);
  });
});
