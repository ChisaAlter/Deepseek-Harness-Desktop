/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionStore } from "@/stores/session-store";
import { useComposerSendProjectionAck } from "./use-composer-send-projection-ack";
import type { StreamItem } from "@/types/stream";

function makeOptimisticUserMessage(
  id: string,
  text = `message ${id}`,
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date(1000),
    optimistic: true,
  };
}

function makeCanonicalUserMessage(
  id: string,
  text = `message ${id}`,
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date(2000),
  };
}

function setAgentStream(
  serverId: string,
  agentId: string,
  tail: StreamItem[],
  head: StreamItem[],
  agentStatus: "initializing" | "idle" | "running" | "error" | "closed" | null = "idle",
) {
  ensureSession(serverId);
  useSessionStore.setState((state) => {
    const session = state.sessions[serverId];
    if (!session) {
      return state;
    }
    const nextSession = {
      ...session,
      agentStreamTail: new Map(session.agentStreamTail),
      agentStreamHead: new Map(session.agentStreamHead),
      agents: new Map(session.agents),
      pendingPermissions: new Map(session.pendingPermissions),
    };
    nextSession.agentStreamTail.set(agentId, tail);
    nextSession.agentStreamHead.set(agentId, head);
    if (agentStatus === null) {
      nextSession.agents.delete(agentId);
    } else {
      nextSession.agents.set(agentId, {
        serverId,
        id: agentId,
        provider: "mock",
        status: agentStatus,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastUserMessageAt: null,
        lastActivityAt: new Date(0),
        capabilities: {
          supportsImages: false,
          supportsTools: false,
          supportsModes: false,
          supportsThinking: false,
        } as never,
        currentModeId: null,
        availableModes: [],
        pendingPermissions: [],
        persistence: null,
        title: null,
        cwd: "/tmp",
        model: null,
      } as never);
    }
    return {
      ...state,
      sessions: { ...state.sessions, [serverId]: nextSession },
    };
  });
}

function ensureSession(serverId: string): void {
  useSessionStore.setState((state) => {
    if (state.sessions[serverId]) {
      return state;
    }
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [serverId]: {
          serverId,
          client: null,
          serverInfo: null,
          hasHydratedAgents: false,
          hasHydratedWorkspaces: false,
          isPlayingAudio: false,
          focusedAgentId: null,
          messages: [],
          currentAssistantMessage: "",
          agentStreamTail: new Map(),
          agentStreamHead: new Map(),
          agentTimelineCursor: new Map(),
          agentTimelineHasOlder: new Map(),
          agentTimelineOlderFetchInFlight: new Map(),
          historySyncGeneration: 0,
          agentHistorySyncGeneration: new Map(),
          agentAuthoritativeHistoryApplied: new Map(),
          initializingAgents: new Map(),
          agents: new Map(),
          agentDetails: new Map(),
          workspaces: new Map(),
          queuedMessages: new Map(),
          pendingPermissions: new Map(),
          fileExplorer: new Map(),
        },
      },
    };
  });
}

const SERVER_ID = "srv-test";
const AGENT_ID = "agent-test";

describe("useComposerSendProjectionAck", () => {
  it("reports no pending send and not adopted initially", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    expect(result.current.pendingSendMessageId).toBeNull();
    expect(result.current.isServerAdopted).toBe(false);
  });

  it("tracks a pending send and reports not adopted while optimistic", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    expect(result.current.pendingSendMessageId).toBe("optimistic-1");
    expect(result.current.isServerAdopted).toBe(false);

    // The optimistic entry landing in the tail does not count as adoption.
    act(() => {
      setAgentStream(SERVER_ID, AGENT_ID, [makeOptimisticUserMessage("optimistic-1")], []);
    });
    expect(result.current.isServerAdopted).toBe(false);
  });

  it("reports adopted once the canonical entry lands in the tail", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    act(() => {
      setAgentStream(SERVER_ID, AGENT_ID, [makeCanonicalUserMessage("optimistic-1")], []);
    });
    expect(result.current.isServerAdopted).toBe(true);
  });

  it("reports adopted when the canonical entry lands in the head", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    act(() => {
      setAgentStream(SERVER_ID, AGENT_ID, [], [makeCanonicalUserMessage("optimistic-1")]);
    });
    expect(result.current.isServerAdopted).toBe(true);
  });

  it("stays unadopted when only an unrelated optimistic message exists", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    act(() => {
      setAgentStream(SERVER_ID, AGENT_ID, [makeOptimisticUserMessage("optimistic-other")], []);
    });
    expect(result.current.isServerAdopted).toBe(false);
  });

  it("clearing the pending send resets to not adopted", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], []);
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    act(() => {
      result.current.trackPendingSend(null);
    });
    expect(result.current.pendingSendMessageId).toBeNull();
    expect(result.current.isServerAdopted).toBe(false);
  });

  it("is a no-op without an agent id", () => {
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: null }),
    );
    expect(result.current.pendingSendMessageId).toBeNull();
    expect(result.current.isServerAdopted).toBe(false);
  });

  it("short-circuits when agent errors after a pending send", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], [], "running");
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      result.current.trackPendingSend("optimistic-1");
    });
    expect(result.current.isServerAdopted).toBe(false);
    act(() => {
      setAgentStream(SERVER_ID, AGENT_ID, [], [makeOptimisticUserMessage("optimistic-1")], "error");
    });
    expect(result.current.isServerAdopted).toBe(true);
  });

  it("builds a send snapshot that acknowledges id-drifted canonical users", () => {
    setAgentStream(SERVER_ID, AGENT_ID, [], [], "running");
    const { result } = renderHook(() =>
      useComposerSendProjectionAck({ serverId: SERVER_ID, agentId: AGENT_ID }),
    );
    act(() => {
      setAgentStream(
        SERVER_ID,
        AGENT_ID,
        [],
        [makeOptimisticUserMessage("optimistic-1")],
        "running",
      );
      result.current.trackPendingSend("optimistic-1");
    });
    expect(result.current.isServerAdopted).toBe(false);
    act(() => {
      // Real provider projected a different id (ordinal merge path).
      setAgentStream(
        SERVER_ID,
        AGENT_ID,
        [makeCanonicalUserMessage("server-minted")],
        [],
        "running",
      );
    });
    expect(result.current.isServerAdopted).toBe(true);
  });
});
