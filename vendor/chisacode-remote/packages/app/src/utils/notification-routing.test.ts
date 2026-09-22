import { describe, expect, it } from "vitest";

import {
  buildAndroidNotificationData,
  buildNotificationRoute,
  normalizeAndroidNotificationData,
  parseAndroidNotificationData,
  resolveNotificationTarget,
} from "./notification-routing";

describe("Android notification data", () => {
  it("round-trips only bounded server and agent ids", () => {
    const encoded = buildAndroidNotificationData({
      serverId: " server-123 ",
      agentId: " agent-456 ",
      ignored: "not copied",
    });

    expect(encoded).toBe('{"serverId":"server-123","agentId":"agent-456"}');
    expect(parseAndroidNotificationData(encoded)).toEqual({
      serverId: "server-123",
      agentId: "agent-456",
    });
  });

  it("rejects missing, malformed, and oversized payloads", () => {
    expect(buildAndroidNotificationData({ serverId: "server", agentId: "" })).toBeNull();
    expect(parseAndroidNotificationData(undefined)).toBeNull();
    expect(parseAndroidNotificationData("not-json")).toBeNull();
    expect(parseAndroidNotificationData('{"serverId":"server"}')).toBeNull();
    expect(parseAndroidNotificationData('{"serverId":123,"agentId":"agent"}')).toBeNull();
    expect(parseAndroidNotificationData('{"serverId":"server","agentId":true}')).toBeNull();
    expect(
      parseAndroidNotificationData(JSON.stringify({ serverId: "s".repeat(513), agentId: "agent" })),
    ).toBeNull();
  });

  it("normalizes cold JSON and warm event objects through one dispatch shape", () => {
    const expected = { serverId: "server", agentId: "agent" };
    expect(normalizeAndroidNotificationData('{"serverId":"server","agentId":"agent"}')).toEqual(
      expected,
    );
    expect(normalizeAndroidNotificationData({ serverId: "server", agentId: "agent" })).toEqual(
      expected,
    );
    expect(normalizeAndroidNotificationData({ serverId: 1, agentId: "agent" })).toBeNull();
  });
});

describe("resolveNotificationTarget", () => {
  it("extracts non-empty server and agent ids", () => {
    expect(
      resolveNotificationTarget({
        serverId: " server-123 ",
        agentId: " agent-456 ",
      }),
    ).toEqual({
      serverId: "server-123",
      agentId: "agent-456",
      workspaceId: null,
    });
  });

  it("returns null for missing/empty ids", () => {
    expect(resolveNotificationTarget({ serverId: "", agentId: "   " })).toEqual({
      serverId: null,
      agentId: null,
      workspaceId: null,
    });
    expect(resolveNotificationTarget(undefined)).toEqual({
      serverId: null,
      agentId: null,
      workspaceId: null,
    });
  });

  it("extracts a trimmed workspace id", () => {
    expect(
      resolveNotificationTarget({
        serverId: "srv-1",
        workspaceId: " ws-main ",
      }),
    ).toEqual({
      serverId: "srv-1",
      agentId: null,
      workspaceId: "ws-main",
    });
  });

  it("does not treat cwd as a workspace id alias", () => {
    expect(
      resolveNotificationTarget({
        serverId: "srv-1",
        agentId: "agent-1",
        cwd: "/tmp/repo",
      }),
    ).toEqual({
      serverId: "srv-1",
      agentId: "agent-1",
      workspaceId: null,
    });
  });
});

describe("buildNotificationRoute", () => {
  it("routes to the agent path when workspace id is present", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv-1",
        agentId: "agent-1",
        workspaceId: "ws-main",
      }),
    ).toBe("/h/srv-1/workspace/ws-main?open=agent%3Aagent-1");
  });

  it("routes directly to server-scoped agent path when both ids are present", () => {
    expect(buildNotificationRoute({ serverId: "srv-1", agentId: "agent-1" })).toBe(
      "/h/srv-1/agent/agent-1",
    );
  });

  it("falls back to host root when only serverId is present", () => {
    expect(buildNotificationRoute({ serverId: "srv-only" })).toBe("/h/srv-only");
  });

  it("routes to the workspace when workspace id is present without an agent id", () => {
    expect(buildNotificationRoute({ serverId: "srv-1", workspaceId: "ws-main" })).toBe(
      "/h/srv-1/workspace/ws-main",
    );
    expect(buildNotificationRoute({ serverId: "srv-1", workspaceId: "/tmp/repo" })).toBe(
      "/h/srv-1/workspace/b64_L3RtcC9yZXBv",
    );
  });

  it("falls back to root when no server id is present", () => {
    expect(buildNotificationRoute({ agentId: "agent-legacy" })).toBe("/");
    expect(buildNotificationRoute(undefined)).toBe("/");
  });

  it("encodes path segments", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv/with/slash",
        agentId: "agent with space",
      }),
    ).toBe("/h/srv%2Fwith%2Fslash/agent/agent%20with%20space");
  });

  it("encodes workspace notification routes", () => {
    expect(
      buildNotificationRoute({
        serverId: "srv/with/slash",
        agentId: "agent with space",
        workspaceId: "/tmp/repo",
      }),
    ).toBe("/h/srv%2Fwith%2Fslash/workspace/b64_L3RtcC9yZXBv?open=agent%3Aagent%20with%20space");
  });
});
