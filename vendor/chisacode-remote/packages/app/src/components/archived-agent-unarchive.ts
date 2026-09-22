import type { UserVisibleErrorReporterInput } from "@/utils/user-visible-error";

interface UnarchiveAgentInput {
  agentId: string;
  refreshAgent: (agentId: string) => Promise<unknown>;
  reportError: (report: UserVisibleErrorReporterInput) => void;
  fallbackMessage: string;
  setPending: (pending: boolean) => void;
}

/**
 * Refreshes an archived agent and restores the retry state when the refresh fails.
 * @param input Agent refresh operation and presentation callbacks
 * @returns A promise that resolves after the refresh attempt is handled
 */
export async function unarchiveAgent(input: UnarchiveAgentInput): Promise<void> {
  input.setPending(true);
  try {
    await input.refreshAgent(input.agentId);
  } catch (error) {
    input.reportError({
      logLabel: "[ArchivedAgentCallout] Failed to unarchive agent",
      error,
      fallbackMessage: input.fallbackMessage,
    });
    input.setPending(false);
  }
}
