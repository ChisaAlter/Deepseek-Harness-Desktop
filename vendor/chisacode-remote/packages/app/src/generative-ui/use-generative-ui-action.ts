import { useCallback, useRef, useState } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { GenerativeUiError, isRecoverableGenUiError } from "@/generative-ui/errors";

interface UseGenerativeUiActionOptions {
  serverId: string;
  agentId: string;
  errorThreshold?: number;
  onError?: (error: GenerativeUiError) => void;
}

interface ActionState {
  pending: boolean;
  lastError: GenerativeUiError | null;
  consecutiveFailures: number;
}

/**
 * Provides generative UI components with a sendAction callback for
 * relaying user interactions to the server. Includes throttling,
 * error counting, and a configurable error threshold.
 */
export function useGenerativeUiAction({
  serverId,
  agentId,
  errorThreshold = 3,
  onError,
}: UseGenerativeUiActionOptions) {
  const client = useHostRuntimeClient(serverId);
  const clientRef = useRef(client);
  clientRef.current = client;

  const [state, setState] = useState<ActionState>({
    pending: false,
    lastError: null,
    consecutiveFailures: 0,
  });

  const pendingRef = useRef(false);

  const sendAction = useCallback(
    async (instanceId: string, action: string, payload: unknown): Promise<boolean> => {
      if (pendingRef.current) {
        return false;
      }

      const current = clientRef.current;
      if (!current) {
        const err = new GenerativeUiError("No daemon client", "CLIENT_UNAVAILABLE", {
          instanceId,
          action,
        });
        setState((prev) => ({
          pending: false,
          lastError: err,
          consecutiveFailures: prev.consecutiveFailures + 1,
        }));
        return false;
      }

      pendingRef.current = true;
      setState((prev) => ({ ...prev, pending: true, lastError: null }));

      try {
        await current.sendGenerativeUiAction(agentId, instanceId, action, payload);
        setState({ pending: false, lastError: null, consecutiveFailures: 0 });
        return true;
      } catch (error) {
        const genError =
          error instanceof GenerativeUiError
            ? error
            : new GenerativeUiError("Generative UI action failed", "RPC_REJECTED", {
                instanceId: instanceId.slice(0, 128),
                action: action.slice(0, 128),
              });

        setState((prev) => {
          const failures = prev.consecutiveFailures + 1;
          if (failures >= errorThreshold) {
            onError?.(genError);
          }
          return {
            pending: false,
            lastError: genError,
            consecutiveFailures: failures,
          };
        });

        if (!isRecoverableGenUiError(error)) {
          console.error("[GenUI] Non-recoverable action error", { code: genError.code });
        }
        return false;
      } finally {
        pendingRef.current = false;
      }
    },
    [agentId, errorThreshold, onError],
  );

  const clearError = useCallback(() => {
    setState({ pending: false, lastError: null, consecutiveFailures: 0 });
  }, []);

  return { sendAction, ...state, clearError };
}
