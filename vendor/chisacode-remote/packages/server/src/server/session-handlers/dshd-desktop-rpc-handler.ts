import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";

type MuxFrameHandler = (frame: { rpcId: string; envelope: unknown }) => void;

export type DshdDesktopRpcHooks = {
  hostRpc(input: {
    method: string;
    payload?: unknown;
  }): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
  gitRpc(input: {
    action: string;
    cwd: string;
    payload?: unknown;
  }): Promise<unknown>;
  respond(input: { rpcId: string; value: unknown }): Promise<unknown>;
  subscribeMux(onFrame: MuxFrameHandler): () => void;
};

function desktopRpc(): DshdDesktopRpcHooks {
  const hooks = (globalThis as { __dshdDesktopRpc?: DshdDesktopRpcHooks }).__dshdDesktopRpc;
  if (!hooks) {
    throw new Error("桌面端未启动");
  }
  return hooks;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "request failed");
}

const muxUnsubs = new WeakMap<object, () => void>();

export function dispatchDshdDesktopRpc(
  msg: SessionInboundMessage,
  emit: (message: SessionOutboundMessage) => void,
  sessionKey: object,
): Promise<void> | undefined {
  switch (msg.type) {
    case "dshd.host.rpc.request":
      return handleHostRpc(msg, emit);
    case "dshd.git.rpc.request":
      return handleGitRpc(msg, emit);
    case "dshd.host.mux.subscribe":
      return handleMuxSubscribe(msg, emit, sessionKey);
    case "dshd.host.mux.unsubscribe":
      muxUnsubs.get(sessionKey)?.();
      muxUnsubs.delete(sessionKey);
      return Promise.resolve();
    default:
      return undefined;
  }
}

async function handleHostRpc(
  msg: Extract<SessionInboundMessage, { type: "dshd.host.rpc.request" }>,
  emit: (message: SessionOutboundMessage) => void,
): Promise<void> {
  try {
    if (msg.method === "respond") {
      const payload = (msg.payload && typeof msg.payload === "object" ? msg.payload : {}) as {
        rpcId?: string;
        value?: unknown;
      };
      await desktopRpc().respond({ rpcId: String(payload.rpcId || ""), value: payload.value });
      emit({
        type: "dshd.host.rpc.response",
        payload: { requestId: msg.requestId, ok: true, value: { accepted: true } },
      });
      return;
    }
    const result = await desktopRpc().hostRpc({ method: msg.method, payload: msg.payload });
    emit({
      type: "dshd.host.rpc.response",
      payload: {
        requestId: msg.requestId,
        ok: result.ok === true,
        value: result.value,
        error: result.error,
      },
    });
  } catch (error) {
    emit({
      type: "dshd.host.rpc.response",
      payload: { requestId: msg.requestId, ok: false, error: errorText(error) },
    });
  }
}

async function handleGitRpc(
  msg: Extract<SessionInboundMessage, { type: "dshd.git.rpc.request" }>,
  emit: (message: SessionOutboundMessage) => void,
): Promise<void> {
  try {
    const value = await desktopRpc().gitRpc({
      action: msg.action,
      cwd: msg.cwd,
      payload: msg.payload,
    });
    emit({
      type: "dshd.git.rpc.response",
      payload: { requestId: msg.requestId, ok: true, value },
    });
  } catch (error) {
    emit({
      type: "dshd.git.rpc.response",
      payload: { requestId: msg.requestId, ok: false, error: errorText(error) },
    });
  }
}

async function handleMuxSubscribe(
  msg: Extract<SessionInboundMessage, { type: "dshd.host.mux.subscribe" }>,
  emit: (message: SessionOutboundMessage) => void,
  sessionKey: object,
): Promise<void> {
  muxUnsubs.get(sessionKey)?.();
  const unsub = desktopRpc().subscribeMux((frame) => {
    emit({
      type: "dshd.host.mux.frame",
      payload: { rpcId: frame.rpcId, envelope: frame.envelope },
    });
  });
  muxUnsubs.set(sessionKey, unsub);
  emit({
    type: "dshd.host.rpc.response",
    payload: { requestId: msg.requestId, ok: true, value: { subscribed: true } },
  });
}
