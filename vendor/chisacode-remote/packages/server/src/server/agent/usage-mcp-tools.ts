import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  UsageRangeDaysSchema,
  UsageSummaryPayloadSchema,
} from "@chisacode/protocol/usage/messages";

import { ensureValidJson } from "../json-utils.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import { buildUsageSummary, pruneUsageEvents, type UsageStore } from "../usage/usage-store.js";

export interface RegisterUsageMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  usageStore?: Pick<UsageStore, "list"> | null;
  callerAgentId?: string;
  lockedCwd?: string | null;
}

/** Registers a read-only usage summary tool with caller-workspace isolation. */
export function registerUsageMcpTools(options: RegisterUsageMcpToolsOptions): void {
  const usageStore = options.usageStore;
  const lockedCwd = options.lockedCwd;
  if (!usageStore || (options.callerAgentId && !lockedCwd)) {
    return;
  }

  options.registerTool(
    "get_usage_summary",
    {
      title: "Get usage summary",
      description:
        "Return aggregated local token usage. Agent-scoped calls are limited to the caller workspace and never expose raw usage events.",
      inputSchema: {
        rangeDays: UsageRangeDaysSchema.default(30),
      },
      outputSchema: {
        summary: UsageSummaryPayloadSchema,
      },
    },
    async ({ rangeDays }) => {
      const retained = pruneUsageEvents({ events: await usageStore.list() });
      const events = lockedCwd
        ? retained.filter((event) => isSameOrDescendantPath(lockedCwd, event.cwd))
        : retained;
      return {
        content: [],
        structuredContent: ensureValidJson({
          summary: buildUsageSummary({ events, rangeDays }),
        }),
      };
    },
  );
}
