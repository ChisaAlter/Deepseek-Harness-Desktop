import { describe, expect, test } from "vitest";

import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WorkspaceDescriptorPayloadSchema as LegacyWorkspaceDescriptorPayloadSchema,
} from "../messages.js";
import {
  DirectorySuggestionsRequestSchema,
  ListAvailableEditorsResponseMessageSchema,
  WorkspaceDescriptorPayloadSchema,
  WorkspaceInboundMessageSchemas,
  WorkspaceOutboundMessageSchemas,
} from "./messages.js";

function schemaTypes(schemas: readonly { shape: { type: { value: string } } }[]): string[] {
  return schemas.map((schema) => schema.shape.type.value);
}

describe("workspace message domain", () => {
  test("owns unique inbound and outbound message type sets", () => {
    const inboundTypes = schemaTypes(WorkspaceInboundMessageSchemas);
    const outboundTypes = schemaTypes(WorkspaceOutboundMessageSchemas);

    expect(inboundTypes).toHaveLength(14);
    expect(new Set(inboundTypes).size).toBe(inboundTypes.length);
    expect(outboundTypes).toHaveLength(18);
    expect(new Set(outboundTypes).size).toBe(outboundTypes.length);
  });

  test("keeps direct schemas and aggregate session unions aligned", () => {
    const request = DirectorySuggestionsRequestSchema.parse({
      type: "directory_suggestions_request",
      query: "src",
      requestId: "request-1",
    });
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = ListAvailableEditorsResponseMessageSchema.parse({
      type: "list_available_editors_response",
      payload: {
        requestId: "request-1",
        editors: [{ id: "vscode", label: "Visual Studio Code" }],
        error: null,
      },
    });
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps the legacy messages export wired to the workspace descriptor", () => {
    expect(LegacyWorkspaceDescriptorPayloadSchema).toBe(WorkspaceDescriptorPayloadSchema);
  });
});
