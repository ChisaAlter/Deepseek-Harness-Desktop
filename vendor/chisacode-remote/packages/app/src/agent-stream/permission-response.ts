import type { AgentPermissionResponse } from "@chisacode/protocol/agent-types";
import { reportPresentedError, type ErrorLogger } from "@/utils/user-visible-error";

interface SubmitPermissionResponseInput {
  agentId: string;
  requestId: string;
  response: AgentPermissionResponse;
  respond: (input: {
    agentId: string;
    requestId: string;
    response: AgentPermissionResponse;
  }) => Promise<unknown>;
  presentError: (message: string) => void;
  fallbackMessage: string;
  onFailure: (error: unknown) => void;
  logger?: ErrorLogger;
}

/**
 * Submits a permission response while preserving user feedback and retry recovery.
 * @param input Permission response operation and presentation callbacks
 * @returns Whether the permission response completed successfully
 */
export async function submitPermissionResponse(
  input: SubmitPermissionResponseInput,
): Promise<boolean> {
  try {
    await input.respond({
      agentId: input.agentId,
      requestId: input.requestId,
      response: input.response,
    });
    return true;
  } catch (error) {
    reportPresentedError({
      logLabel: "[PermissionRequestCard] Failed to respond to permission",
      error,
      fallbackMessage: input.fallbackMessage,
      present: input.presentError,
      logger: input.logger,
    });
    input.onFailure(error);
    return false;
  }
}
