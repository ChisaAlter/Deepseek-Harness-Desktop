import type { SessionInboundMessage } from "@chisacode/protocol/messages";
import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

export type FetchAgentsPayload = DaemonCommandResponsePayload<"fetch_agents_response">;
type FetchAgentsRequest = Extract<SessionInboundMessage, { type: "fetch_agents_request" }>;
export type FetchAgentsOptions = Omit<FetchAgentsRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchAgentsEntry = FetchAgentsPayload["entries"][number];
export type FetchAgentsPageInfo = FetchAgentsPayload["pageInfo"];

export type FetchAgentHistoryPayload = DaemonCommandResponsePayload<"fetch_agent_history_response">;
type FetchAgentHistoryRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_history_request" }
>;
export type FetchAgentHistoryOptions = Omit<FetchAgentHistoryRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchAgentHistoryEntry = FetchAgentHistoryPayload["entries"][number];
export type FetchAgentHistoryPageInfo = FetchAgentHistoryPayload["pageInfo"];

export type FetchRecentProviderSessionsPayload =
  DaemonCommandResponsePayload<"fetch_recent_provider_sessions_response">;
type FetchRecentProviderSessionsRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_recent_provider_sessions_request" }
>;
export type FetchRecentProviderSessionsOptions = Omit<
  FetchRecentProviderSessionsRequest,
  "type" | "requestId"
> & { requestId?: string };
export type FetchRecentProviderSessionEntry = FetchRecentProviderSessionsPayload["entries"][number];

export type UsageSummaryPayload = DaemonCommandResponsePayload<"usage.summary.get.response">;
type UsageSummaryGetRequest = Extract<SessionInboundMessage, { type: "usage.summary.get.request" }>;
export type FetchUsageSummaryOptions = Omit<UsageSummaryGetRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type UsageExportPayload = DaemonCommandResponsePayload<"usage.export.response">;
type UsageExportRequest = Extract<SessionInboundMessage, { type: "usage.export.request" }>;
export type ExportUsageOptions = Omit<UsageExportRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type UsageClearPayload = DaemonCommandResponsePayload<"usage.clear.response">;

export type FetchWorkspacesPayload = DaemonCommandResponsePayload<"fetch_workspaces_response">;
type FetchWorkspacesRequest = Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>;
export type FetchWorkspacesOptions = Omit<FetchWorkspacesRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchWorkspacesEntry = FetchWorkspacesPayload["entries"][number];
export type FetchWorkspacesPageInfo = FetchWorkspacesPayload["pageInfo"];

/** Implements agent/workspace directory reads and usage-reporting RPCs. */
export class QueryCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  fetchAgents(options?: FetchAgentsOptions): Promise<FetchAgentsPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_agents_request",
        ...(options?.scope ? { scope: options.scope } : {}),
        ...(options?.filter ? { filter: options.filter } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
        ...(options?.page ? { page: options.page } : {}),
        ...(options?.subscribe ? { subscribe: options.subscribe } : {}),
      },
      responseType: "fetch_agents_response",
      timeout: 10_000,
    });
  }

  fetchAgentHistory(options?: FetchAgentHistoryOptions): Promise<FetchAgentHistoryPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_agent_history_request",
        ...(options?.filter ? { filter: options.filter } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
        ...(options?.page ? { page: options.page } : {}),
      },
      responseType: "fetch_agent_history_response",
      timeout: 10_000,
    });
  }

  fetchRecentProviderSessions(
    options?: FetchRecentProviderSessionsOptions,
  ): Promise<FetchRecentProviderSessionsPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_recent_provider_sessions_request",
        ...(options?.cwd ? { cwd: options.cwd } : {}),
        ...(options?.providers ? { providers: options.providers } : {}),
        ...(options?.since ? { since: options.since } : {}),
        ...(options?.limit ? { limit: options.limit } : {}),
      },
      responseType: "fetch_recent_provider_sessions_response",
      timeout: 10_000,
    });
  }

  fetchUsageSummary(options?: FetchUsageSummaryOptions): Promise<UsageSummaryPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "usage.summary.get.request",
        ...(options?.rangeDays ? { rangeDays: options.rangeDays } : {}),
      },
      responseType: "usage.summary.get.response",
      timeout: 10_000,
    });
  }

  exportUsage(options?: ExportUsageOptions): Promise<UsageExportPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "usage.export.request",
        ...(options?.format ? { format: options.format } : {}),
      },
      responseType: "usage.export.response",
      timeout: 10_000,
    });
  }

  clearUsage(requestId?: string): Promise<UsageClearPayload> {
    return this.transport.request({
      requestId,
      message: { type: "usage.clear.request" },
      responseType: "usage.clear.response",
      timeout: 10_000,
    });
  }

  fetchWorkspaces(options?: FetchWorkspacesOptions): Promise<FetchWorkspacesPayload> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_workspaces_request",
        ...(options?.filter ? { filter: options.filter } : {}),
        ...(options?.sort ? { sort: options.sort } : {}),
        ...(options?.page ? { page: options.page } : {}),
        ...(options?.subscribe ? { subscribe: options.subscribe } : {}),
      },
      responseType: "fetch_workspaces_response",
      timeout: 10_000,
    });
  }
}
