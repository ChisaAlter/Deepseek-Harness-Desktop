import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  CheckoutInboundMessageSchemas,
  CheckoutOutboundMessageSchemas,
  CheckoutStatusRequestSchema,
  CheckoutStatusResponseSchema,
} from "./messages.js";

function schemaTypes(schemas: readonly { shape: { type: { value: string } } }[]): string[] {
  return schemas.map((schema) => schema.shape.type.value);
}

describe("checkout message domain", () => {
  test("owns unique inbound and outbound message type sets", () => {
    const inboundTypes = schemaTypes(CheckoutInboundMessageSchemas);
    const outboundTypes = schemaTypes(CheckoutOutboundMessageSchemas);

    expect(inboundTypes).toHaveLength(22);
    expect(new Set(inboundTypes).size).toBe(inboundTypes.length);
    expect(outboundTypes).toHaveLength(23);
    expect(new Set(outboundTypes).size).toBe(outboundTypes.length);
  });

  test("keeps direct schemas and aggregate session unions aligned", () => {
    const request = CheckoutStatusRequestSchema.parse({
      type: "checkout_status_request",
      cwd: "/repo",
      requestId: "request-1",
    });
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: {
        cwd: "/repo",
        error: null,
        requestId: "request-1",
        isGit: false,
        isChisaCodeOwnedWorktree: false,
        repoRoot: null,
        currentBranch: null,
        isDirty: null,
        baseRef: null,
        aheadBehind: null,
        aheadOfOrigin: null,
        behindOfOrigin: null,
        hasRemote: false,
        remoteUrl: null,
      },
    });
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
