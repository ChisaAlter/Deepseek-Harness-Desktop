import type {
  DaemonTransport,
  DaemonTransportFactory,
} from "@chisacode/client/internal/daemon-client";
import type { LocalTransportTarget } from "./desktop-daemon";
import {
  defaultLocalDaemonTransportRpc,
  type LocalDaemonTransportRpc,
} from "./local-daemon-transport-rpc";

const LOCAL_TRANSPORT_SCHEME = "chisacode+local:";
const LEGACY_LOCAL_TRANSPORT_SCHEME = "chisacode+local:";

function encodeBinaryToBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return globalThis.btoa(binary);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function buildLocalDaemonTransportUrl(target: LocalTransportTarget): string {
  const url = new URL(`${LOCAL_TRANSPORT_SCHEME}//${target.transportType}`);
  url.searchParams.set("path", target.transportPath);
  return url.toString();
}

function parseLocalDaemonTransportUrl(url: string): LocalTransportTarget {
  const parsed = new URL(url);
  if (
    parsed.protocol !== LOCAL_TRANSPORT_SCHEME &&
    parsed.protocol !== LEGACY_LOCAL_TRANSPORT_SCHEME
  ) {
    throw new Error(`Unsupported local transport URL: ${url}`);
  }
  const transportType = parsed.hostname;
  const transportPath = parsed.searchParams.get("path")?.trim() ?? "";
  if ((transportType !== "socket" && transportType !== "pipe") || !transportPath) {
    throw new Error(`Invalid local transport target: ${url}`);
  }
  return {
    transportType,
    transportPath,
  };
}

export function createDesktopLocalDaemonTransportFactory(
  rpc: LocalDaemonTransportRpc = defaultLocalDaemonTransportRpc,
): DaemonTransportFactory | null {
  return ({ url }) => {
    const target = parseLocalDaemonTransportUrl(url);
    let sessionId: string | null = null;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let didEmitOpen = false;
    /** Outbound frames queued before the session id resolves; flushed on open. */
    const pendingSendQueue: Array<string | Uint8Array | ArrayBuffer> = [];

    const openHandlers = new Set<() => void>();
    const closeHandlers = new Set<(event?: unknown) => void>();
    const errorHandlers = new Set<(event?: unknown) => void>();
    const messageHandlers = new Set<(data: unknown) => void>();

    const emitOpen = () => {
      if (didEmitOpen || disposed) {
        return;
      }
      didEmitOpen = true;
      // Flush any frames queued before the session id resolved.
      while (pendingSendQueue.length > 0) {
        const queued = pendingSendQueue.shift();
        if (queued) {
          deliverSend(queued);
        }
      }
      for (const handler of openHandlers) {
        handler();
      }
    };
    const emitClose = (event?: unknown) => {
      for (const handler of closeHandlers) {
        handler(event);
      }
    };
    const emitError = (event?: unknown) => {
      for (const handler of errorHandlers) {
        handler(event);
      }
    };
    const emitMessage = (data: unknown) => {
      for (const handler of messageHandlers) {
        handler(data);
      }
    };

    void rpc
      .listenToEvents((payload) => {
        if (disposed || !sessionId || payload.sessionId !== sessionId) {
          return;
        }
        if (payload.kind === "open") {
          emitOpen();
          return;
        }
        if (payload.kind === "message") {
          if (payload.text) {
            emitMessage({ data: payload.text });
            return;
          }
          if (payload.binaryBase64) {
            emitMessage({ data: decodeBase64ToBytes(payload.binaryBase64) });
          }
          return;
        }
        if (payload.kind === "close") {
          emitClose(payload);
          return;
        }
        emitError(payload.error ?? "Local daemon transport error");
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        return;
      })
      .catch((error) => {
        emitError(error);
      });

    void rpc
      .openSession(target)
      .then((id) => {
        if (disposed) {
          void rpc.closeSession(id).catch((error) => emitError(error));
          return;
        }
        sessionId = id;
        emitOpen();
        return;
      })
      .catch((error) => {
        emitError(error);
      });

    const deliverSend = (data: string | Uint8Array | ArrayBuffer): void => {
      if (!sessionId) {
        return;
      }
      if (typeof data === "string") {
        void rpc.sendMessage({ sessionId, text: data }).catch((error) => emitError(error));
        return;
      }
      const binaryBase64 = encodeBinaryToBase64(
        data instanceof ArrayBuffer ? data : new Uint8Array(data),
      );
      void rpc.sendMessage({ sessionId, binaryBase64 }).catch((error) => emitError(error));
    };

    const transport: DaemonTransport = {
      send: (data) => {
        if (disposed) {
          return;
        }
        if (!sessionId) {
          // Buffer outbound frames until the session opens so early handshake
          // frames (auth/hello) are not silently dropped during the open race.
          pendingSendQueue.push(data);
          return;
        }
        deliverSend(data);
      },
      close: () => {
        disposed = true;
        pendingSendQueue.length = 0;
        const currentSessionId = sessionId;
        sessionId = null;
        if (currentSessionId) {
          void rpc.closeSession(currentSessionId).catch((error) => emitError(error));
        }
        unlisten?.();
        unlisten = null;
      },
      onMessage: (handler) => {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onOpen: (handler) => {
        openHandlers.add(handler);
        return () => openHandlers.delete(handler);
      },
      onClose: (handler) => {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      onError: (handler) => {
        errorHandlers.add(handler);
        return () => errorHandlers.delete(handler);
      },
    };

    return transport;
  };
}
