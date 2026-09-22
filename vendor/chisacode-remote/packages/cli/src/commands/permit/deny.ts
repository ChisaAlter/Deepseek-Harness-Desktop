import type { Command } from "commander";
import type { AgentPermissionRequest } from "@chisacode/protocol/agent-types";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandOptions, ListResult, CommandError } from "../../output/index.js";
import { permitResponseSchema, type PermissionResponseItem } from "./allow.js";
import { tCli } from "../../i18n.js";

export type PermitDenyResult = ListResult<PermissionResponseItem>;

export interface PermitDenyOptions extends CommandOptions {
  all?: boolean;
  message?: string;
  interrupt?: boolean;
  host?: string;
}

export async function runDenyCommand(
  agentIdOrPrefix: string,
  reqId: string | undefined,
  options: PermitDenyOptions,
  _command: Command,
): Promise<PermitDenyResult> {
  const host = getDaemonHost({ host: options.host });

  // Validate arguments
  if (!options.all && !reqId) {
    const error: CommandError = {
      code: "MISSING_ARGUMENT",
      message: tCli("permit.error.requestRequired"),
      details: tCli("permit.error.denyUsage"),
    };
    throw error;
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

    // Determine which permissions to deny
    let permissionsToDeny: AgentPermissionRequest[];
    if (options.all) {
      permissionsToDeny = pendingPermissions;
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
      permissionsToDeny = [permission];
    }

    // Deny permissions
    const results: PermissionResponseItem[] = await Promise.all(
      permissionsToDeny.map(async (permission) => {
        await client.respondToPermission(resolvedAgentId, permission.id, {
          behavior: "deny",
          ...(options.message ? { message: options.message } : {}),
          ...(options.interrupt ? { interrupt: true } : {}),
        });
        return {
          requestId: permission.id.slice(0, 8),
          agentId: resolvedAgentId,
          agentShortId: resolvedAgentId.slice(0, 7),
          name: permission.name,
          result: "denied",
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
      code: "DENY_PERMISSION_FAILED",
      message: tCli("permit.error.denyFailed", { message }),
    };
    throw error;
  }
}
