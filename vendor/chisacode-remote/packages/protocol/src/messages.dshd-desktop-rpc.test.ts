import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("dshd desktop host/git rpc schemas", () => {
  test("accepts host rpc request and response", () => {
    const inbound = SessionInboundMessageSchema.parse({
      type: "dshd.host.rpc.request",
      requestId: "req-1",
      method: "session.list",
      payload: {},
    });
    expect(inbound.type).toBe("dshd.host.rpc.request");
    const outbound = SessionOutboundMessageSchema.parse({
      type: "dshd.host.rpc.response",
      payload: { requestId: "req-1", ok: true, value: { items: [] } },
    });
    expect(outbound.type).toBe("dshd.host.rpc.response");
  });

  test("accepts git rpc and mux subscribe", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "dshd.git.rpc.request",
        requestId: "g1",
        action: "git-status",
        cwd: "/repo",
      }).type,
    ).toBe("dshd.git.rpc.request");
    expect(
      SessionInboundMessageSchema.parse({
        type: "dshd.host.mux.subscribe",
        requestId: "m1",
      }).type,
    ).toBe("dshd.host.mux.subscribe");
  });

  test("rejects unknown host-like types that are not in the union", () => {
    const result = SessionInboundMessageSchema.safeParse({
      type: "dshd.host.open-proxy",
      path: "/api/settings.describe",
    });
    expect(result.success).toBe(false);
  });
});
