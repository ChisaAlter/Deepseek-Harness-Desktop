/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appI18n } from "@/i18n";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import type { UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment } from "@chisacode/protocol/messages";
import { useDraftAgentCreateFlow, type DraftCreateAttempt } from "./create-flow";

describe("useDraftAgentCreateFlow", () => {
  beforeEach(() => {
    useCreateFlowStore.setState({ pendingByDraftId: {} });
  });

  it("renders a prepared new-workspace create attempt as optimistic chat before continuing it", async () => {
    const image: UserMessageImageAttachment = {
      id: "image-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "image-key",
      createdAt: 123,
    };
    const attachment = {
      type: "review",
      cwd: "/repo",
      summary: "Review",
    } as unknown as AgentAttachment;
    const attempt: DraftCreateAttempt = {
      clientMessageId: "msg-prepared",
      text: "build this",
      timestamp: new Date("2026-05-25T00:00:00.000Z"),
      images: [image],
      attachments: [attachment],
    };
    const createRequest = vi.fn(
      async (ctx: {
        attempt: DraftCreateAttempt;
        text: string;
        images?: UserMessageImageAttachment[];
        attachments?: AgentAttachment[];
        cwd: string;
      }) => ({
        agentId: "agent-1",
        result: { id: "agent-1", ctx },
      }),
    );
    const onCreateSuccess = vi.fn();

    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-1",
        getPendingServerId: () => "server-1",
        initialAttempt: attempt,
        buildDraftAgent: (currentAttempt) => ({ currentAttempt }),
        createRequest,
        onCreateSuccess,
      }),
    );

    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.draftAgent).toEqual({ currentAttempt: attempt });
    expect(result.current.optimisticStreamItems).toEqual([
      {
        kind: "user_message",
        id: "msg-prepared",
        text: "build this",
        timestamp: attempt.timestamp,
        optimistic: true,
        images: [image],
        attachments: [attachment],
      },
    ]);
    expect(createRequest).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.continueCreateFromAttempt({ attempt, cwd: "/repo" });
    });

    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(createRequest).toHaveBeenCalledWith({
      attempt,
      text: "build this",
      images: [image],
      attachments: [attachment],
      cwd: "/repo",
    });
    expect(onCreateSuccess).toHaveBeenCalledTimes(1);
  });

  it("projects an optimistic sidebar agent immediately on submit", async () => {
    const { useSessionStore } = await import("@/stores/session-store");
    const createRequest = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        agentId: "agent-optimistic",
        result: { id: "agent-optimistic" },
      };
    });

    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        "server-1": {
          serverId: "server-1",
          client: null,
          serverInfo: null,
          hasHydratedAgents: true,
          hasHydratedWorkspaces: true,
          isPlayingAudio: false,
          focusedAgentId: null,
          messages: [],
          currentAssistantMessage: "",
          agents: new Map(),
          agentStreamTail: new Map(),
          agentStreamHead: new Map(),
          pendingPermissions: new Map(),
        } as never,
      },
    }));

    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-optimistic",
        getPendingServerId: () => "server-1",
        buildDraftAgent: (currentAttempt) =>
          ({
            serverId: "server-1",
            id: "draft-optimistic",
            provider: "grokbuild",
            status: "running",
            createdAt: currentAttempt.timestamp,
            updatedAt: currentAttempt.timestamp,
            lastUserMessageAt: currentAttempt.timestamp,
            lastActivityAt: currentAttempt.timestamp,
            capabilities: {},
            currentModeId: null,
            availableModes: [],
            pendingPermissions: [],
            persistence: null,
            title: currentAttempt.text,
            cwd: "/repo/chisa-terminal",
            model: "grok-4.5",
            parentAgentId: null,
            labels: {},
            projectPlacement: {
              projectKey: "/repo/chisa-terminal",
              projectName: "ChisaTerminal",
              checkout: {
                cwd: "/repo/chisa-terminal",
                isGit: false,
                currentBranch: null,
                remoteUrl: null,
                worktreeRoot: null,
                isChisaCodeOwnedWorktree: false,
                mainRepoRoot: null,
              },
            },
          }) as never,
        createRequest,
        onCreateSuccess: vi.fn(),
      }),
    );

    let createPromise: Promise<void> | undefined;
    act(() => {
      createPromise = result.current.handleCreateFromInput({
        text: "你怎么看这个项目",
        attachments: [],
        cwd: "/repo/chisa-terminal",
      });
    });

    expect(
      useSessionStore.getState().sessions["server-1"]?.agents.get("draft-optimistic")?.title,
    ).toBe("你怎么看这个项目");

    await act(async () => {
      await createPromise;
    });
  });

  it("returns to draft with an error when onBeforeSubmit throws", async () => {
    const createRequest = vi.fn(async () => ({
      agentId: "agent-1",
      result: { id: "agent-1" },
    }));
    const onCreateError = vi.fn();

    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-before-submit",
        getPendingServerId: () => "server-1",
        onBeforeSubmit: () => {
          throw new Error("isWeb is not defined");
        },
        buildDraftAgent: (currentAttempt) => ({ currentAttempt }),
        createRequest,
        onCreateSuccess: vi.fn(),
        onCreateError,
      }),
    );

    await act(async () => {
      await expect(
        result.current.handleCreateFromInput({
          text: "hello",
          attachments: [],
          cwd: "/repo",
        }),
      ).rejects.toThrow("isWeb is not defined");
    });

    expect(createRequest).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.formErrorMessage).toBe("isWeb is not defined");
    expect(onCreateError).toHaveBeenCalledTimes(1);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-before-submit"]).toBeUndefined();
  });

  it("surfaces post-create agent_state error after create accepts", async () => {
    const { useSessionStore } = await import("@/stores/session-store");
    const createRequest = vi.fn(async () => ({
      agentId: "agent-post-create",
      result: { id: "agent-post-create" },
    }));
    const onCreateError = vi.fn();
    const onCreateSuccess = vi.fn();

    useCreateFlowStore.setState({ pendingByDraftId: {} });
    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        "server-1": {
          serverId: "server-1",
          client: null,
          serverInfo: null,
          hasHydratedAgents: true,
          hasHydratedWorkspaces: true,
          isPlayingAudio: false,
          focusedAgentId: null,
          messages: [],
          currentAssistantMessage: "",
          agents: new Map([
            [
              "agent-post-create",
              {
                serverId: "server-1",
                id: "agent-post-create",
                provider: "mock",
                status: "running",
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
                lastError: null,
              } as never,
            ],
          ]),
          agentStreamTail: new Map(),
          agentStreamHead: new Map(),
          pendingPermissions: new Map(),
        } as never,
      },
    }));

    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-post-create",
        getPendingServerId: () => "server-1",
        buildDraftAgent: (currentAttempt) => ({ currentAttempt }),
        createRequest,
        onCreateSuccess,
        onCreateError,
      }),
    );

    await act(async () => {
      await result.current.handleCreateFromInput({
        text: "start me",
        attachments: [],
        cwd: "/repo",
      });
    });

    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(onCreateSuccess).toHaveBeenCalledTimes(1);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-post-create"]?.lifecycle).toBe(
      "sent",
    );

    function markAgentPostCreateFailed(): void {
      useSessionStore.setState((state) => {
        const session = state.sessions["server-1"];
        if (!session) {
          return state;
        }
        const current = session.agents.get("agent-post-create");
        if (!current) {
          return state;
        }
        const agents = new Map(session.agents);
        agents.set("agent-post-create", {
          ...current,
          status: "error",
          lastError: "Failed to start turn",
        });
        return {
          ...state,
          sessions: {
            ...state.sessions,
            "server-1": {
              ...session,
              agents,
            },
          },
        };
      });
    }

    await act(async () => {
      markAgentPostCreateFailed();
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.formErrorMessage).toBe("Failed to start turn");
    expect(onCreateError).toHaveBeenCalledTimes(1);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-post-create"]).toBeUndefined();
  });

  it("fails the draft create when the daemon ack does not arrive within the deadline", async () => {
    vi.useFakeTimers();
    try {
      const createRequest = vi.fn(() => new Promise<never>(() => {}));
      const onCreateError = vi.fn();
      const { result } = renderHook(() =>
        useDraftAgentCreateFlow({
          draftId: "draft-timeout",
          getPendingServerId: () => "server-1",
          buildDraftAgent: (currentAttempt) => ({ currentAttempt }),
          createRequest,
          onCreateSuccess: vi.fn(),
          onCreateError,
        }),
      );

      let createPromise: Promise<void> | undefined;
      act(() => {
        createPromise = result.current.handleCreateFromInput({
          text: "hello",
          attachments: [],
          cwd: "/repo",
        });
      });

      expect(result.current.isSubmitting).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await expect(createPromise).rejects.toThrow(appI18n.t("panels.agent.createTimeout"));
      });

      // The machine must leave "creating" so the composer unlocks and the
      // draft stays editable with its message preserved for retry.
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.formErrorMessage).toBe(appI18n.t("panels.agent.createTimeout"));
      expect(useCreateFlowStore.getState().pendingByDraftId["draft-timeout"]).toBeUndefined();
      expect(onCreateError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails loudly when the create ack carries no agent id instead of staying stuck", async () => {
    const createRequest = vi.fn(async () => ({
      agentId: null,
      result: { id: null },
    }));
    const onCreateError = vi.fn();
    const onCreateSuccess = vi.fn();
    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-no-id",
        getPendingServerId: () => "server-1",
        buildDraftAgent: (currentAttempt) => ({ currentAttempt }),
        createRequest,
        onCreateSuccess,
        onCreateError,
      }),
    );

    await act(async () => {
      await expect(
        result.current.handleCreateFromInput({
          text: "hello",
          attachments: [],
          cwd: "/repo",
        }),
      ).rejects.toThrow(appI18n.t("panels.agent.createMissingAgentId"));
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.formErrorMessage).toBe(appI18n.t("panels.agent.createMissingAgentId"));
    expect(onCreateSuccess).not.toHaveBeenCalled();
    expect(onCreateError).toHaveBeenCalledTimes(1);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-no-id"]).toBeUndefined();
  });

  it("removes the optimistic row when the daemon returns a different agent id", async () => {
    const { useSessionStore } = await import("@/stores/session-store");
    const createRequest = vi.fn(async () => ({
      agentId: "daemon-minted-id",
      result: { id: "daemon-minted-id" },
    }));

    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        "server-1": {
          serverId: "server-1",
          client: null,
          serverInfo: null,
          hasHydratedAgents: true,
          hasHydratedWorkspaces: true,
          isPlayingAudio: false,
          focusedAgentId: null,
          messages: [],
          currentAssistantMessage: "",
          agents: new Map(),
          agentStreamTail: new Map(),
          agentStreamHead: new Map(),
          pendingPermissions: new Map(),
        } as never,
      },
    }));

    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-mismatch",
        getPendingServerId: () => "server-1",
        buildDraftAgent: (currentAttempt) =>
          ({
            serverId: "server-1",
            id: "reserved-id",
            provider: "grokbuild",
            status: "running",
            createdAt: currentAttempt.timestamp,
            updatedAt: currentAttempt.timestamp,
            lastUserMessageAt: currentAttempt.timestamp,
            lastActivityAt: currentAttempt.timestamp,
            capabilities: {},
            currentModeId: null,
            availableModes: [],
            pendingPermissions: [],
            persistence: null,
            title: currentAttempt.text,
            cwd: "/repo/chisa-terminal",
            model: "grok-4.5",
            parentAgentId: null,
            labels: {},
          }) as never,
        createRequest,
        onCreateSuccess: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCreateFromInput({
        text: "你好",
        attachments: [],
        cwd: "/repo/chisa-terminal",
      });
    });

    // The optimistic row keyed by the reserved id must not linger as a phantom
    // beside the authoritative row minted by the (older) daemon.
    expect(useSessionStore.getState().sessions["server-1"]?.agents.has("reserved-id")).toBe(false);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-mismatch"]?.agentId).toBe(
      "daemon-minted-id",
    );
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-mismatch"]?.lifecycle).toBe(
      "sent",
    );
  });
});
