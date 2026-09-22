import { describe, expect, it } from "vitest";
import {
  GenerativeUiActionRequestSchema,
  GenerativeUiActionResponseSchema,
  LegacyGenerativeUiActionRequestSchema,
} from "./rpc-schemas.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "@chisacode/protocol/messages";

describe("GenerativeUiActionRequestSchema", () => {
  it("accepts a valid action request", () => {
    const result = GenerativeUiActionRequestSchema.safeParse({
      type: "generative_ui.action.request",
      requestId: "req-1",
      agentId: "agent-abc",
      instanceId: "inst-xyz",
      action: "submit",
      payload: { name: "Alice", age: 30 },
      timestamp: 1719700000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when agentId is missing", () => {
    const result = GenerativeUiActionRequestSchema.safeParse({
      type: "generative_ui.action.request",
      requestId: "req-1",
      instanceId: "inst-xyz",
      action: "submit",
      payload: null,
      timestamp: 1719700000000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when type is wrong", () => {
    const result = GenerativeUiActionRequestSchema.safeParse({
      type: "other.action",
      requestId: "req-1",
      agentId: "agent-abc",
      instanceId: "inst-xyz",
      action: "submit",
      payload: null,
      timestamp: 1719700000000,
    });
    expect(result.success).toBe(false);
  });

  it("accepts null payload", () => {
    const result = GenerativeUiActionRequestSchema.safeParse({
      type: "generative_ui.action.request",
      requestId: "req-1",
      agentId: "agent-abc",
      instanceId: "inst-xyz",
      action: "click",
      payload: null,
      timestamp: 1719700000000,
    });
    expect(result.success).toBe(true);
  });
});

describe("LegacyGenerativeUiActionRequestSchema", () => {
  it("keeps the legacy flat request as a distinct parseable schema", () => {
    expect(
      LegacyGenerativeUiActionRequestSchema.safeParse({
        type: "generative_ui.action",
        requestId: "req-legacy",
        agentId: "agent-abc",
        instanceId: "inst-xyz",
        action: "submit",
        payload: null,
        timestamp: 1719700000000,
      }).success,
    ).toBe(true);
  });
});

describe("GenerativeUiActionResponseSchema", () => {
  it("accepts received=true response", () => {
    const result = GenerativeUiActionResponseSchema.safeParse({
      type: "generative_ui.action.response",
      payload: { requestId: "req-1", received: true, error: null },
    });
    expect(result.success).toBe(true);
  });

  it("accepts received=false with error", () => {
    const result = GenerativeUiActionResponseSchema.safeParse({
      type: "generative_ui.action.response",
      payload: { requestId: "req-1", received: false, error: "agent not found" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when payload is missing fields", () => {
    const result = GenerativeUiActionResponseSchema.safeParse({
      type: "generative_ui.action.response",
      payload: { requestId: "req-1" },
    });
    expect(result.success).toBe(false);
  });
});

describe("Session message registration", () => {
  it("recognizes generative_ui.action.request as a valid inbound message", () => {
    const result = SessionInboundMessageSchema.safeParse({
      type: "generative_ui.action.request",
      requestId: "req-1",
      agentId: "agent-abc",
      instanceId: "inst-xyz",
      action: "submit",
      payload: { value: 42 },
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("continues recognizing generative_ui.action as a legacy inbound message", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "generative_ui.action",
        requestId: "req-legacy",
        agentId: "agent-abc",
        instanceId: "inst-xyz",
        action: "submit",
        payload: null,
        timestamp: Date.now(),
      }).success,
    ).toBe(true);
  });

  it("recognizes generative_ui.action.response as a valid outbound message", () => {
    const result = SessionOutboundMessageSchema.safeParse({
      type: "generative_ui.action.response",
      payload: { requestId: "req-1", received: true, error: null },
    });
    expect(result.success).toBe(true);
  });
});

describe("generative UI capability registration", () => {
  it("accepts generative UI in hello capabilities", () => {
    expect(
      WSHelloMessageSchema.safeParse({
        type: "hello",
        clientId: "client-1",
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { generative_ui: true },
      }).success,
    ).toBe(true);
  });

  it("keeps server_info generative UI feature optional", () => {
    const base = { status: "server_info", serverId: "server-1" };
    expect(ServerInfoStatusPayloadSchema.safeParse(base).success).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.safeParse({
        ...base,
        features: { generativeUi: true },
      }).success,
    ).toBe(true);
  });
});
