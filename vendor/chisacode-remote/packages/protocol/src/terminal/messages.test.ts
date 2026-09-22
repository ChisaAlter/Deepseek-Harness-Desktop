import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  SubscribeTerminalRequestSchema,
  SubscribeTerminalResponseSchema,
  TerminalInboundMessageSchemas,
  TerminalOutboundMessageSchemas,
} from "./messages.js";

function schemaTypes(schemas: readonly { shape: { type: { value: string } } }[]): string[] {
  return schemas.map((schema) => schema.shape.type.value);
}

describe("terminal message domain", () => {
  test("owns unique inbound and outbound message type sets", () => {
    const inboundTypes = schemaTypes(TerminalInboundMessageSchemas);
    const outboundTypes = schemaTypes(TerminalOutboundMessageSchemas);

    expect(inboundTypes).toHaveLength(11);
    expect(new Set(inboundTypes).size).toBe(inboundTypes.length);
    expect(outboundTypes).toHaveLength(8);
    expect(new Set(outboundTypes).size).toBe(outboundTypes.length);
  });

  test("keeps direct schemas and aggregate session unions aligned", () => {
    const request = SubscribeTerminalRequestSchema.parse({
      type: "subscribe_terminal_request",
      terminalId: "terminal-1",
      requestId: "request-1",
      restore: {
        mode: "visible-snapshot",
        scrollbackLines: 200,
        size: { rows: 24, cols: 80 },
      },
    });
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = SubscribeTerminalResponseSchema.parse({
      type: "subscribe_terminal_response",
      payload: {
        terminalId: "terminal-1",
        slot: 7,
        error: null,
        requestId: "request-1",
      },
    });
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
