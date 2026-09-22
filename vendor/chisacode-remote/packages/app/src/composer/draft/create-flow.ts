import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { ComposerAttachment } from "@/attachments/types";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { appI18n } from "@/i18n";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore } from "@/stores/session-store";
import {
  buildOptimisticUserMessage,
  generateMessageId,
  type StreamItem,
  type UserMessageImageAttachment,
} from "@/types/stream";
import type { AgentAttachment } from "@chisacode/protocol/messages";

const EMPTY_STREAM_ITEMS: StreamItem[] = [];

/**
 * Client-side cap on how long a draft create may wait for the daemon ack.
 * The daemon-side create keeps running after this deadline and is idempotent
 * for client-minted ids, so a retry returns the same agent instead of
 * duplicating. 60s matches the transport's own cap, so the deadline only
 * fires when the create can never settle; under machine load real creates
 * have been observed up to ~41s.
 */
const CREATE_REQUEST_DEADLINE_MS = 60_000;

/**
 * Rejects with the deadline error when the wrapped promise does not settle in
 * time. The underlying request is not cancelled; callers must tolerate the
 * daemon completing it afterwards.
 * @param promise The create request promise
 * @param onTimeout Builds the deadline error message
 * @returns The wrapped result
 * @throws The deadline error when the promise does not settle in time
 */
async function withCreateDeadline<T>(promise: Promise<T>, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), CREATE_REQUEST_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

interface CreateAttempt {
  clientMessageId: string;
  text: string;
  timestamp: Date;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

type DraftAgentMachineState =
  | { tag: "draft"; errorMessage: string }
  | { tag: "creating"; attempt: CreateAttempt };

type DraftAgentMachineEvent =
  | { type: "DRAFT_SET_ERROR"; message: string }
  | { type: "SUBMIT"; attempt: CreateAttempt }
  | { type: "CREATE_FAILED"; message: string };

function assertNever(value: never): never {
  throw new Error(`Unhandled state: ${JSON.stringify(value)}`);
}

function projectOptimisticSidebarAgent<TDraftAgent>(input: {
  serverId: string;
  draftId: string;
  attempt: CreateAttempt;
  buildDraftAgent: (attempt: CreateAttempt) => TDraftAgent;
}): void {
  try {
    const optimisticAgent = input.buildDraftAgent(input.attempt);
    if (!optimisticAgent || typeof optimisticAgent !== "object") {
      return;
    }
    const candidate = optimisticAgent as {
      id?: string;
      serverId?: string;
      cwd?: string;
    };
    if (!candidate.id || !candidate.serverId || !candidate.cwd) {
      return;
    }
    useSessionStore.getState().setAgents(input.serverId, (prev) => {
      const next = new Map(prev);
      next.set(candidate.id as string, optimisticAgent as never);
      return next;
    });
  } catch {
    // Sidebar projection is best-effort; create still proceeds.
  }
}

function removeOptimisticSidebarAgent(input: { serverId: string; draftId: string }): void {
  useSessionStore.getState().setAgents(input.serverId, (prev) => {
    if (!prev.has(input.draftId)) {
      return prev;
    }
    const next = new Map(prev);
    next.delete(input.draftId);
    return next;
  });
}

function reducer(
  state: DraftAgentMachineState,
  event: DraftAgentMachineEvent,
): DraftAgentMachineState {
  switch (event.type) {
    case "DRAFT_SET_ERROR": {
      if (state.tag !== "draft") {
        return state;
      }
      return { ...state, errorMessage: event.message };
    }
    case "SUBMIT": {
      return { tag: "creating", attempt: event.attempt };
    }
    case "CREATE_FAILED": {
      if (state.tag !== "creating") {
        return state;
      }
      return { tag: "draft", errorMessage: event.message };
    }
    default:
      return assertNever(event);
  }
}

interface CreateRequestResult<TCreateResult> {
  agentId: string | null;
  result: TCreateResult;
}

interface SubmitContext {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
}

interface CreateRequestContext {
  attempt: CreateAttempt;
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  cwd: string;
}

interface UseDraftAgentCreateFlowOptions<TDraftAgent, TCreateResult> {
  draftId: string;
  getPendingServerId: () => string | null;
  initialAttempt?: CreateAttempt | null;
  allowEmptyText?: boolean;
  validateBeforeSubmit?: (ctx: SubmitContext) => string | null;
  onBeforeSubmit?: (ctx: CreateRequestContext) => void;
  onCreateStart?: () => void;
  createRequest: (ctx: CreateRequestContext) => Promise<CreateRequestResult<TCreateResult>>;
  buildDraftAgent: (attempt: CreateAttempt) => TDraftAgent;
  onCreateSuccess: (ctx: { result: TCreateResult; attempt: CreateAttempt }) => Promise<void> | void;
  onCreateError?: (error: Error) => void;
}

export function useDraftAgentCreateFlow<TDraftAgent, TCreateResult>({
  draftId,
  getPendingServerId,
  initialAttempt = null,
  allowEmptyText = false,
  validateBeforeSubmit,
  onBeforeSubmit,
  onCreateStart,
  createRequest,
  buildDraftAgent,
  onCreateSuccess,
  onCreateError,
}: UseDraftAgentCreateFlowOptions<TDraftAgent, TCreateResult>) {
  const [machine, dispatch] = useReducer(
    reducer,
    initialAttempt,
    (attempt): DraftAgentMachineState =>
      attempt
        ? { tag: "creating", attempt }
        : {
            tag: "draft",
            errorMessage: "",
          },
  );

  const setPendingCreateAttempt = useCreateFlowStore((state) => state.setPending);
  const updatePendingAgentId = useCreateFlowStore((state) => state.updateAgentId);
  const markPendingCreateLifecycle = useCreateFlowStore((state) => state.markLifecycle);
  const clearPendingCreateAttempt = useCreateFlowStore((state) => state.clear);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const pendingCreate = useCreateFlowStore((state) => state.pendingByDraftId[draftId] ?? null);
  const postCreateAgentError = useSessionStore((state) => {
    if (!pendingCreate?.agentId || pendingCreate.lifecycle !== "sent") {
      return null;
    }
    const agent = state.sessions[pendingCreate.serverId]?.agents?.get(pendingCreate.agentId);
    if (!agent || agent.status !== "error") {
      return null;
    }
    return agent.lastError?.trim() || "Agent run failed after create";
  });

  // After create accepts, run-start failures arrive as agent_state{error}. Surface
  // them in the draft form instead of leaving the handoff stuck as "creating".
  useEffect(() => {
    if (!postCreateAgentError || !pendingCreate?.agentId) {
      return;
    }
    dispatch({ type: "CREATE_FAILED", message: postCreateAgentError });
    markPendingCreateLifecycle({ draftId, lifecycle: "abandoned" });
    clearPendingCreateAttempt({ draftId });
    onCreateError?.(new Error(postCreateAgentError));
  }, [
    clearPendingCreateAttempt,
    draftId,
    markPendingCreateLifecycle,
    onCreateError,
    pendingCreate?.agentId,
    postCreateAgentError,
  ]);

  const formErrorMessage = machine.tag === "draft" ? machine.errorMessage : "";
  const isSubmitting = machine.tag === "creating";

  const optimisticStreamItems = useMemo<StreamItem[]>(() => {
    if (machine.tag !== "creating") {
      return EMPTY_STREAM_ITEMS;
    }

    if (
      !machine.attempt.text &&
      (!machine.attempt.images || machine.attempt.images.length === 0) &&
      (!machine.attempt.attachments || machine.attempt.attachments.length === 0)
    ) {
      return EMPTY_STREAM_ITEMS;
    }

    return [
      buildOptimisticUserMessage({
        id: machine.attempt.clientMessageId,
        text: machine.attempt.text,
        timestamp: machine.attempt.timestamp,
        images: machine.attempt.images,
        attachments: machine.attempt.attachments,
      }),
    ];
  }, [machine]);

  const draftAgent = useMemo<TDraftAgent | null>(() => {
    if (machine.tag !== "creating") {
      return null;
    }
    return buildDraftAgent(machine.attempt);
  }, [buildDraftAgent, machine]);

  const runCreateAttempt = useCallback(
    async ({ attempt, cwd }: { attempt: CreateAttempt; cwd: string }) => {
      const pendingServerId = getPendingServerId();
      if (!pendingServerId) {
        const error = new Error("No host selected");
        dispatch({ type: "DRAFT_SET_ERROR", message: error.message });
        throw error;
      }

      try {
        onBeforeSubmit?.({
          attempt,
          text: attempt.text,
          images: attempt.images,
          attachments: attempt.attachments,
          cwd,
        });

        const optimisticAgentId =
          useCreateFlowStore.getState().pendingByDraftId[draftId]?.agentId ?? null;

        const createResult = await withCreateDeadline(
          createRequest({
            attempt,
            text: attempt.text,
            images: attempt.images,
            attachments: attempt.attachments,
            cwd,
          }),
          () => new Error(appI18n.t("panels.agent.createTimeout")),
        );

        // A create ack without an agent id cannot transition the draft (the
        // layout-store conversion no-ops on blank ids), so fail loudly instead
        // of leaving the machine stuck in "creating" with a locked composer.
        if (!createResult.agentId) {
          throw new Error(appI18n.t("panels.agent.createMissingAgentId"));
        }

        updatePendingAgentId({ draftId, agentId: createResult.agentId });
        appendOptimisticUserMessageToAgentStream(
          pendingServerId,
          createResult.agentId,
          buildOptimisticUserMessage({
            id: attempt.clientMessageId,
            text: attempt.text,
            timestamp: attempt.timestamp,
            images: attempt.images,
            attachments: attempt.attachments,
          }),
          { placement: "tail", skipIfUserMessageExists: true },
        );
        markPendingCreateLifecycle({ draftId, lifecycle: "sent" });

        await onCreateSuccess({ result: createResult.result, attempt });

        // Older daemons do not adopt client-minted ids and return their own;
        // drop the optimistic row keyed by the reserved id so it does not
        // linger as a phantom beside the authoritative row.
        if (optimisticAgentId && optimisticAgentId !== createResult.agentId) {
          removeOptimisticSidebarAgent({
            serverId: pendingServerId,
            draftId: optimisticAgentId,
          });
        }
      } catch (error) {
        const resolved = error instanceof Error ? error : new Error("Failed to create agent");
        // Remove optimistic sidebar projection if create never produced a real
        // agent. The row is keyed by the preallocated agent id, not the draft id.
        const pending = useCreateFlowStore.getState().pendingByDraftId[draftId];
        const optimisticKey = pending?.agentId ?? draftId;
        removeOptimisticSidebarAgent({ serverId: pendingServerId, draftId: optimisticKey });
        dispatch({ type: "CREATE_FAILED", message: resolved.message });
        markPendingCreateLifecycle({ draftId, lifecycle: "abandoned" });
        clearPendingCreateAttempt({ draftId });
        onCreateError?.(resolved);
        throw error;
      }
    },
    [
      appendOptimisticUserMessageToAgentStream,
      clearPendingCreateAttempt,
      createRequest,
      draftId,
      getPendingServerId,
      markPendingCreateLifecycle,
      onBeforeSubmit,
      onCreateError,
      onCreateSuccess,
      updatePendingAgentId,
    ],
  );

  const handleCreateFromInput = useCallback(
    async ({ text, attachments, cwd }: SubmitContext) => {
      if (isSubmitting) {
        throw new Error("Already loading");
      }

      dispatch({ type: "DRAFT_SET_ERROR", message: "" });
      const wirePayload = splitComposerAttachmentsForSubmit(attachments);
      const images = wirePayload.images;

      const trimmedPrompt = text.trim();
      if (!trimmedPrompt && !allowEmptyText) {
        const error = new Error("Initial prompt is required");
        dispatch({ type: "DRAFT_SET_ERROR", message: error.message });
        throw error;
      }

      const validationError = validateBeforeSubmit?.({
        text: trimmedPrompt,
        attachments,
        cwd,
      });
      if (validationError) {
        const error = new Error(validationError);
        dispatch({ type: "DRAFT_SET_ERROR", message: validationError });
        throw error;
      }

      const pendingServerId = getPendingServerId();
      if (!pendingServerId) {
        const error = new Error("No host selected");
        dispatch({ type: "DRAFT_SET_ERROR", message: error.message });
        throw error;
      }

      const attempt: CreateAttempt = {
        clientMessageId: generateMessageId(),
        text: trimmedPrompt,
        timestamp: new Date(),
        ...(images && images.length > 0 ? { images } : {}),
        ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
      };

      // The optimistic row is keyed by the client-minted agent id, which the
      // daemon adopts verbatim on create. Reserve it up front so the pending
      // record, the optimistic row, and the wire request all agree.
      const optimisticAgent = buildDraftAgent(attempt);
      const optimisticAgentId =
        optimisticAgent && typeof optimisticAgent === "object"
          ? (((optimisticAgent as { id?: unknown }).id as string | undefined) ?? null)
          : null;

      setPendingCreateAttempt({
        draftId,
        serverId: pendingServerId,
        agentId: optimisticAgentId,
        clientMessageId: attempt.clientMessageId,
        text: attempt.text,
        timestamp: attempt.timestamp.getTime(),
        ...(attempt.images && attempt.images.length > 0 ? { images: attempt.images } : {}),
        ...(attempt.attachments && attempt.attachments.length > 0
          ? { attachments: attempt.attachments }
          : {}),
      });

      // Project a sidebar row immediately. Chat already has an optimistic user
      // message; the left rail previously waited for createAgent to return.
      projectOptimisticSidebarAgent({
        serverId: pendingServerId,
        draftId,
        attempt,
        buildDraftAgent,
      });

      dispatch({ type: "SUBMIT", attempt });
      onCreateStart?.();
      await runCreateAttempt({ attempt, cwd });
    },
    [
      allowEmptyText,
      buildDraftAgent,
      draftId,
      getPendingServerId,
      isSubmitting,
      onCreateStart,
      runCreateAttempt,
      setPendingCreateAttempt,
      validateBeforeSubmit,
    ],
  );

  const continueCreateFromAttempt = useCallback(
    async ({ attempt, cwd }: { attempt: CreateAttempt; cwd: string }) => {
      if (!isSubmitting) {
        dispatch({ type: "SUBMIT", attempt });
      }
      // Preallocate the client-minted agent id and project the optimistic
      // sidebar row, mirroring handleCreateFromInput. The new-workspace
      // pre-submit path reaches creation through this hook (and the machine
      // may already be "creating" from a restored initial attempt), so without
      // this the sidebar row only appeared after the server's first
      // agent_update. Both calls are idempotent.
      const pendingServerId = getPendingServerId();
      if (pendingServerId) {
        const optimisticAgent = buildDraftAgent(attempt);
        const optimisticAgentId =
          optimisticAgent && typeof optimisticAgent === "object"
            ? (((optimisticAgent as { id?: unknown }).id as string | undefined) ?? null)
            : null;
        if (optimisticAgentId) {
          updatePendingAgentId({ draftId, agentId: optimisticAgentId });
        }
        projectOptimisticSidebarAgent({
          serverId: pendingServerId,
          draftId,
          attempt,
          buildDraftAgent,
        });
      }
      await runCreateAttempt({ attempt, cwd });
    },
    [
      buildDraftAgent,
      draftId,
      getPendingServerId,
      isSubmitting,
      runCreateAttempt,
      updatePendingAgentId,
    ],
  );

  const setFormError = useCallback((message: string) => {
    dispatch({ type: "DRAFT_SET_ERROR", message });
  }, []);

  return {
    machine,
    formErrorMessage,
    isSubmitting,
    optimisticStreamItems,
    draftAgent,
    handleCreateFromInput,
    continueCreateFromAttempt,
    setFormError,
  };
}

export type { CreateAttempt as DraftCreateAttempt };
