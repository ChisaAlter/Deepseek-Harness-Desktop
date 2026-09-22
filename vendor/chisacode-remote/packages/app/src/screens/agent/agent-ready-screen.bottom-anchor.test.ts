import { describe, expect, it } from "vitest";
import {
  deriveRouteBottomAnchorIntent,
  deriveRouteBottomAnchorRequest,
} from "./agent-ready-screen-bottom-anchor";

describe("agent-ready-screen bottom anchor intent", () => {
  it("latches initial-entry on first route entry before authoritative history is applied", () => {
    const intentAtEntry = deriveRouteBottomAnchorIntent({
      cachedIntent: null,
      routeKey: "server-1:agent-1",
      hasAppliedAuthoritativeHistoryAtEntry: false,
    });

    const intentAfterHistoryApplies = deriveRouteBottomAnchorIntent({
      cachedIntent: intentAtEntry,
      routeKey: "server-1:agent-1",
      hasAppliedAuthoritativeHistoryAtEntry: true,
    });

    expect(intentAfterHistoryApplies).toEqual({
      routeKey: "server-1:agent-1",
      reason: "initial-entry",
    });
    expect(
      deriveRouteBottomAnchorRequest({
        intent: intentAfterHistoryApplies,
        effectiveAgentId: "agent-1",
      }),
    ).toEqual({
      agentId: "agent-1",
      reason: "initial-entry",
      requestKey: "server-1:agent-1:initial-entry",
    });
  });

  it("creates resume requests when revisiting an already-hydrated route", () => {
    const intent = deriveRouteBottomAnchorIntent({
      cachedIntent: null,
      routeKey: "server-1:agent-2",
      hasAppliedAuthoritativeHistoryAtEntry: true,
    });

    expect(
      deriveRouteBottomAnchorRequest({
        intent,
        effectiveAgentId: "agent-2",
      }),
    ).toEqual({
      agentId: "agent-2",
      reason: "resume",
      requestKey: "server-1:agent-2:resume",
    });
  });

  it("does not create a request until the effective agent exists", () => {
    const intent = deriveRouteBottomAnchorIntent({
      cachedIntent: null,
      routeKey: "server-1:agent-3",
      hasAppliedAuthoritativeHistoryAtEntry: false,
    });

    expect(
      deriveRouteBottomAnchorRequest({
        intent,
        effectiveAgentId: null,
      }),
    ).toBeNull();
  });
});
