import {
  SessionInboundMessageSchema,
  type AgentPermissionResolvedMessage,
  type AgentSnapshotPayload,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";
import type { AgentPermissionResponse } from "@chisacode/protocol/agent-types";

import type { FetchAgentResult } from "./daemon-client-agent-lifecycle.js";
import type { DaemonRequestCoordinator } from "./daemon-client-request-coordinator.js";

type AgentUpdateMessage = Extract<SessionOutboundMessage, { type: "agent_update" }>;
export type AgentPermissionResolvedPayload = AgentPermissionResolvedMessage["payload"];

/** Result returned by the daemon wait-for-finish RPC. */
export interface WaitForFinishResult {
  status: "idle" | "error" | "permission" | "timeout";
  final: AgentSnapshotPayload | null;
  error: string | null;
  lastMessage: string | null;
}

interface AgentWaitClientOptions {
  createRequestId(requestId?: string): string;
  fetchAgent(agentId: string): Promise<FetchAgentResult | null>;
  requests: Pick<DaemonRequestCoordinator, "request" | "requestCorrelated">;
  sendMessage(message: SessionInboundMessage): void;
  subscribeAgentUpdates(handler: (message: AgentUpdateMessage) => void): () => void;
}

/** Owns agent permission correlation and wait lifecycle cleanup. */
export class AgentWaitClient {
  constructor(private readonly options: AgentWaitClientOptions) {}

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    this.options.sendMessage({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
  }

  async respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    timeout = 15_000,
  ): Promise<AgentPermissionResolvedPayload> {
    const message = SessionInboundMessageSchema.parse({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
    return this.options.requests.request({
      requestId,
      message,
      timeout,
      options: { skipQueue: true },
      select: (candidate) => {
        if (candidate.type !== "agent_permission_resolved") {
          return null;
        }
        if (candidate.payload.requestId !== requestId) {
          return null;
        }
        if (candidate.payload.agentId !== agentId) {
          return null;
        }
        return candidate.payload;
      },
    });
  }

  async waitForAgentUpsert(
    agentId: string,
    predicate: (snapshot: AgentSnapshotPayload) => boolean,
    timeout = 60_000,
  ): Promise<AgentSnapshotPayload> {
    const initialResult = await this.options.fetchAgent(agentId).catch(() => null);
    if (initialResult && predicate(initialResult.agent)) {
      return initialResult.agent;
    }

    const deadline = Date.now() + timeout;
    return await new Promise<AgentSnapshotPayload>((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;

      const finish = (
        result: { kind: "ok"; snapshot: AgentSnapshotPayload } | { kind: "error"; error: Error },
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (result.kind === "ok") {
          resolve(result.snapshot);
          return;
        }
        reject(result.error);
      };

      const maybeResolve = (snapshot: AgentSnapshotPayload | null) => {
        if (!snapshot) {
          return false;
        }
        let matches: boolean;
        try {
          matches = predicate(snapshot);
        } catch (error) {
          finish({ kind: "error", error: toError(error) });
          return true;
        }
        if (!matches) {
          return false;
        }
        finish({ kind: "ok", snapshot });
        return true;
      };

      const poll = async () => {
        if (settled || pollInFlight) {
          return;
        }
        pollInFlight = true;
        try {
          const result = await this.options.fetchAgent(agentId).catch(() => null);
          maybeResolve(result?.agent ?? null);
        } finally {
          pollInFlight = false;
        }
      };

      unsubscribe = this.options.subscribeAgentUpdates((message) => {
        if (settled || message.payload.kind !== "upsert") {
          return;
        }
        const snapshot = message.payload.agent;
        if (snapshot.id !== agentId) {
          return;
        }
        maybeResolve(snapshot);
      });

      const remaining = Math.max(1, deadline - Date.now());
      timeoutTimer = setTimeout(() => {
        finish({
          kind: "error",
          error: new Error(`Timed out waiting for agent ${agentId}`),
        });
      }, remaining);

      pollTimer = setInterval(() => {
        void poll();
      }, 250);
      void poll();
    });
  }

  async waitForFinish(agentId: string, timeout = 60_000): Promise<WaitForFinishResult> {
    const requestId = this.options.createRequestId();
    const hasTimeout = Number.isFinite(timeout) && timeout > 0;
    const message = SessionInboundMessageSchema.parse({
      type: "wait_for_finish_request",
      requestId,
      agentId,
      ...(hasTimeout ? { timeoutMs: timeout } : {}),
    });
    const payload = await this.options.requests.requestCorrelated({
      requestId,
      message,
      responseType: "wait_for_finish_response",
      timeout: hasTimeout ? timeout + 5_000 : 0,
      options: { skipQueue: true },
    });
    return {
      status: payload.status,
      final: payload.final,
      error: payload.error,
      lastMessage: payload.lastMessage,
    };
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
