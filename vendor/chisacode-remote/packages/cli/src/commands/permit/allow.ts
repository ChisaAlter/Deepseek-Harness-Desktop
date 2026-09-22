import type { Command } from "commander";
import type { AgentPermissionRequest } from "@chisacode/protocol/agent-types";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandOptions, ListResult, OutputSchema, CommandError } from "../../output/index.js";
import { tCli } from "../../i18n.js";

/** Permission response item for display */
export interface PermissionResponseItem {
  requestId: string;
  agentId: string;
  agentShortId: string;
  name: string;
  result: string;
}

/** Schema for permit allow/deny output */
export const permitResponseSchema: OutputSchema<PermissionResponseItem> = {
  idField: "requestId",
  columns: [
    { header: "REQUEST ID", field: "requestId", width: 12 },
    { header: "AGENT", field: "agentShortId", width: 10 },
    { header: "TOOL", field: "name", width: 20 },
    {
      header: "RESULT",
      field: "result",
      width: 10,
      color: (value) => {
        if (value === "allowed") return "green";
        if (value === "denied") return "red";
        return undefined;
      },
    },
  ],
};

export type PermitAllowResult = ListResult<PermissionResponseItem>;

export interface PermitAllowOptions extends CommandOptions {
  all?: boolean;
  input?: string;
  host?: string;
}

export async function runAllowCommand(
  agentIdOrPrefix: string,
  reqId: string | undefined,
  options: PermitAllowOptions,
  _command: Command,
): Promise<PermitAllowResult> {
  const host = getDaemonHost({ host: options.host });

  // Require an explicit request ID or --all: silently allowing every pending
  // permission (including shell/file writes) when the user omits req_id is a
  // footgun and contradicts the help text ("optional if --all"). Mirrors deny.
  if (!options.all && !reqId) {
    const error: CommandError = {
      code: "MISSING_ARGUMENT",
      message: tCli("permit.error.requestRequired"),
      details: tCli("permit.error.allowUsage"),
    };
    throw error;
  }

  // Parse input JSON if provided
  let updatedInput: Record<string, unknown> | undefined;
  if (options.input) {
    try {
      updatedInput = JSON.parse(options.input);
    } catch (err) {
      const error: CommandError = {
        code: "INVALID_JSON",
        message: tCli("permit.error.invalidJson", {
          message: err instanceof Error ? err.message : String(err),
        }),
        details: tCli("permit.error.validJsonHint"),
      };
      throw error;
    }
  }

  let client;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: tCli("permit.error.connect", { host, message }),
      details: tCli("permit.error.startDaemon"),
    };
    throw error;
  }

  try {
    const fetchResult = await client.fetchAgent(agentIdOrPrefix);
    if (!fetchResult) {
      await client.close();
      const error: CommandError = {
        code: "AGENT_NOT_FOUND",
        message: tCli("permit.error.agentNotFound", { agent: agentIdOrPrefix }),
        details: tCli("permit.error.listAgentsHint"),
      };
      throw error;
    }
    const agent = fetchResult.agent;
    const resolvedAgentId = agent.id;

    // Get pending permissions for this agent
    const pendingPermissions = agent.pendingPermissions || [];
    if (pendingPermissions.length === 0) {
      await client.close();
      const error: CommandError = {
        code: "NO_PENDING_PERMISSIONS",
        message: tCli("permit.error.noPending", { agent: agent.id.slice(0, 7) }),
      };
      throw error;
    }

    // Determine which permissions to allow
    let permissionsToAllow: AgentPermissionRequest[];
    if (options.all) {
      // --all is the explicit opt-in for allowing every pending permission
      permissionsToAllow = pendingPermissions;
    } else {
      // Find permission by ID prefix
      const permission = pendingPermissions.find((p) => p.id === reqId || p.id.startsWith(reqId!));
      if (!permission) {
        await client.close();
        const error: CommandError = {
          code: "PERMISSION_NOT_FOUND",
          message: tCli("permit.error.requestNotFound", { request: reqId }),
          details: tCli("permit.error.availableRequests", {
            requests: pendingPermissions.map((p) => p.id.slice(0, 8)).join(", "),
          }),
        };
        throw error;
      }
      permissionsToAllow = [permission];
    }

    // Allow permissions
    const results: PermissionResponseItem[] = await Promise.all(
      permissionsToAllow.map(async (permission) => {
        await client.respondToPermission(resolvedAgentId, permission.id, {
          behavior: "allow",
          ...(updatedInput ? { updatedInput } : {}),
        });
        return {
          requestId: permission.id.slice(0, 8),
          agentId: resolvedAgentId,
          agentShortId: resolvedAgentId.slice(0, 7),
          name: permission.name,
          result: "allowed",
        };
      }),
    );

    await client.close();

    return {
      type: "list",
      data: results,
      schema: permitResponseSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    // Re-throw CommandErrors
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "ALLOW_PERMISSION_FAILED",
      message: tCli("permit.error.allowFailed", { message }),
    };
    throw error;
  }
}
