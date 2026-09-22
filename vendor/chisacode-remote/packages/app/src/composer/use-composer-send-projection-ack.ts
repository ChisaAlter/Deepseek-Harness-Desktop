import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "@/stores/session-store";
import {
  createComposerSendSnapshot,
  hasServerAcknowledgedComposerSend,
  type ComposerSendSnapshot,
} from "@/timeline/session-stream-reducers";
import type { StreamItem } from "@/types/stream";

const EMPTY_STREAM_ITEMS: readonly StreamItem[] = [];

/**
 * Composer send-busy state driven by a send-time snapshot (dual-stream analogue
 * of T3 LocalDispatch), not by re-scanning the store after an async gap.
 *
 * Production flow:
 * 1. dispatch appends the optimistic user message synchronously
 * 2. onOptimisticDispatched fires with the message id
 * 3. trackPendingSend builds a {@link ComposerSendSnapshot} from current stream
 *    + agent status
 * 4. isServerAdopted flips when {@link hasServerAcknowledgedComposerSend} sees
 *    permission/error/idle short-circuit, same-id canonical projection,
 *    latest-canonical-user drift past baseline, or turn progress
 */
export function useComposerSendProjectionAck(input: { serverId: string; agentId: string | null }): {
  /** Optimistic message id from the pending snapshot, or null */
  pendingSendMessageId: string | null;
  /** True when the server has acknowledged the pending send snapshot */
  isServerAdopted: boolean;
  /**
   * Captures a send-time snapshot for the optimistic message id.
   * Call from the dispatch-time optimistic callback; pass null to clear
   * (e.g. on send error).
   */
  trackPendingSend: (messageId: string | null) => void;
} {
  const [pendingSnapshot, setPendingSnapshot] = useState<ComposerSendSnapshot | null>(null);

  const projectionInputs = useSessionStore(
    useShallow((state) => {
      if (!input.agentId) {
        return {
          tail: EMPTY_STREAM_ITEMS,
          head: EMPTY_STREAM_ITEMS,
          hasPendingPermission: false,
          agentStatus: null as string | null,
        };
      }
      const session = state.sessions[input.serverId];
      const agent = session?.agents?.get(input.agentId);
      const pendingPermissions = session?.pendingPermissions;
      let hasPendingPermission = false;
      if (pendingPermissions) {
        for (const permission of pendingPermissions.values()) {
          if (permission.agentId === input.agentId) {
            hasPendingPermission = true;
            break;
          }
        }
      }
      return {
        tail: session?.agentStreamTail?.get(input.agentId) ?? EMPTY_STREAM_ITEMS,
        head: session?.agentStreamHead?.get(input.agentId) ?? EMPTY_STREAM_ITEMS,
        hasPendingPermission,
        agentStatus: agent?.status ?? null,
      };
    }),
  );

  const isServerAdopted = useMemo(
    () =>
      hasServerAcknowledgedComposerSend({
        snapshot: pendingSnapshot,
        tail: projectionInputs.tail,
        head: projectionInputs.head,
        agentStatus: projectionInputs.agentStatus,
        hasPendingPermission: projectionInputs.hasPendingPermission,
      }),
    [pendingSnapshot, projectionInputs],
  );

  const trackPendingSend = useCallback(
    (messageId: string | null) => {
      if (messageId === null) {
        setPendingSnapshot(null);
        return;
      }
      // Read the latest stream/agent state at callback time so the snapshot
      // captures the dual-stream view after the optimistic append.
      const session = useSessionStore.getState().sessions[input.serverId];
      const agentId = input.agentId;
      const tail =
        agentId && session
          ? (session.agentStreamTail?.get(agentId) ?? EMPTY_STREAM_ITEMS)
          : EMPTY_STREAM_ITEMS;
      const head =
        agentId && session
          ? (session.agentStreamHead?.get(agentId) ?? EMPTY_STREAM_ITEMS)
          : EMPTY_STREAM_ITEMS;
      const agentStatus =
        agentId && session ? (session.agents?.get(agentId)?.status ?? null) : null;
      setPendingSnapshot(
        createComposerSendSnapshot({
          optimisticMessageId: messageId,
          tail,
          head,
          agentStatus,
        }),
      );
    },
    [input.agentId, input.serverId],
  );

  return {
    pendingSendMessageId: pendingSnapshot?.optimisticMessageId ?? null,
    isServerAdopted,
    trackPendingSend,
  };
}
