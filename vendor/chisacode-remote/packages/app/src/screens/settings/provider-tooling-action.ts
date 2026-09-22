import type { UserVisibleErrorReporterInput } from "@/utils/user-visible-error";

export type ProviderToolingAction = "install" | "update" | "reinstall";

interface ProviderToolingClient {
  runProviderToolingAction(
    providerId: string,
    action: ProviderToolingAction,
  ): Promise<{ success: boolean; stderr: string; stdout: string }>;
}

interface RunProviderToolingActionInput {
  providerId: string;
  action: ProviderToolingAction;
  client: ProviderToolingClient;
  reportError: (report: UserVisibleErrorReporterInput) => void;
  fallbackMessage: string;
}

/**
 * Runs provider tooling and reports daemon failures through the UI error port.
 * @param input Provider tooling request and error presentation dependencies
 * @returns A promise that resolves after success or handled failure
 */
export async function runProviderToolingAction(
  input: RunProviderToolingActionInput,
): Promise<void> {
  try {
    const result = await input.client.runProviderToolingAction(input.providerId, input.action);
    if (result.success) return;
    const message = result.stderr.trim() || result.stdout.trim();
    throw new Error(message || input.fallbackMessage);
  } catch (error) {
    input.reportError({
      error,
      logLabel: `[ProvidersSettings] Failed to ${input.action} provider ${input.providerId}`,
      fallbackMessage: input.fallbackMessage,
    });
  }
}
