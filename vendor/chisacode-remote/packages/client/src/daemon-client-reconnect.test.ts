/**
 * Reconnect path tests for DaemonClient.
 *
 * Covers: initial connect failure → retry → success; connection drop → auto-reconnect;
 * retries exhausted / close prevents reconnect; ensureConnected lifecycle.
 *
 * Uses fake timers + a fake DaemonTransport (no vi.mock) consistent with the existing
 * daemon-client.test.ts style.
 */
import { afterEach, expect, test, vi } from "vitest";
import { DaemonClient } from "./daemon-client.js";
import type { DaemonTransport } from "./daemon-client-transport-types.js";

// ---------------------------------------------------------------------------
// fake transport – mirrors createMockTransport from daemon-client.test.ts
// ---------------------------------------------------------------------------

let serverInfoOrdinal = 1;

function createMockTransport() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];

  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  let onClose: (_event?: unknown) => void = () => {};
  let onError: (_event?: unknown) => void = () => {};

  const transport: DaemonTransport = {
    send: (data) => sent.push(data),
    close: () => {},
    onMessage: (handler) => {
      onMessage = handler;
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: (handler) => {
      onClose = handler;
      return () => {};
    },
    onError: (handler) => {
      onError = handler;
      return () => {};
    },
  };

  return {
    transport,
    sent,
    triggerOpen: (options?: { preserveSent?: boolean }) => {
      onOpen();
      if (!options?.preserveSent) {
        sent.length = 0;
      }
      // Emulate server_info so the handshake completes and connect() resolves.
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: `srv_reconnect_${serverInfoOrdinal++}`,
              hostname: null,
              version: null,
            },
          },
        }),
      );
    },
    triggerSocketOpen: () => onOpen(),
    triggerClose: (event?: unknown) => onClose(event),
    triggerError: (event?: unknown) => onError(event),
    triggerMessage: (data: unknown) => onMessage(data),
  };
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function _assertStr(data: string | Uint8Array | ArrayBuffer | undefined): string {
  if (typeof data !== "string") throw new Error("Expected string frame");
  return data;
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("retries after initial connect failure and succeeds on second attempt", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_1",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 100 },
      transportFactory: () => {
        callCount += 1;
        return callCount === 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    // Start connect – first transport will fail during handshake.
    const connectPromise = client.connect().then(
      () => ({ ok: true as const }),
      (e) => ({ ok: false as const, error: e }),
    );
    expect(client.getConnectionState().status).toBe("connecting");

    // First transport fails without a successful open.
    first.triggerError(new Error("refused"));
    first.triggerClose({ code: 1006, reason: "refused" });

    // Client should be in disconnected state after failure.
    expect(client.getConnectionState().status).toBe("disconnected");
    expect(client.getConnectionState()).toMatchObject({
      reason: expect.stringContaining("refused"),
    });

    // Advance timer past baseDelay so the reconnect fires.
    await vi.advanceTimersByTimeAsync(10);
    expect(client.getConnectionState().status).toBe("connecting");

    // Second transport succeeds.
    second.triggerOpen();
    // After server_info, connect promise should resolve.
    await vi.advanceTimersByTimeAsync(0);

    const result = await connectPromise;
    expect(result.ok).toBe(true);
    expect(client.getConnectionState().status).toBe("connected");
    expect(callCount).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("auto-reconnects after connection is dropped mid-session", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_2",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 5 },
      transportFactory: () => {
        callCount += 1;
        return callCount === 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    // Initial connect.
    const connectPromise = client.connect();
    first.triggerOpen();
    await connectPromise;
    expect(client.getConnectionState().status).toBe("connected");

    // Drop connection – simulate transport close.
    first.triggerClose({ code: 1001, reason: "Server restart" });
    expect(client.getConnectionState().status).toBe("disconnected");

    // Reconnect fires after backoff.
    await vi.advanceTimersByTimeAsync(10);
    expect(client.getConnectionState().status).toBe("connecting");

    second.triggerOpen();
    expect(client.getConnectionState().status).toBe("connected");
    expect(callCount).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("does not retry after close() is called", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_3",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 100 },
      transportFactory: () => first.transport,
    });
    clients.push(client);

    // Start connect.
    client.connect().then(
      () => ({ ok: true as const }),
      (e) => ({ ok: false as const, error: e }),
    );

    // Fail the first transport.
    first.triggerError(new Error("refused"));
    first.triggerClose({ code: 1006 });
    expect(client.getConnectionState().status).toBe("disconnected");

    // Close before retry fires.
    await client.close();
    expect(client.getConnectionState().status).toBe("disposed");

    // Clear any pending timers (e.g. the 15s connect timeout) before advancing,
    // so no callback fires across the fake→real timer boundary in the finally.
    vi.clearAllTimers();
    // Advance past reconnect interval – no reconnect should happen.
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getConnectionState().status).toBe("disposed");
  } finally {
    vi.useRealTimers();
  }
});

test("close rejects an in-flight connect and ignores late events from that transport", async () => {
  const logger = createMockLogger();
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_reconnect_close_pending",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  await client.close();

  await expect(connectPromise).rejects.toThrow("Daemon client closed");
  expect(client.getConnectionState().status).toBe("disposed");

  mock.triggerOpen();
  mock.triggerError(new Error("late error"));
  mock.triggerClose({ code: 1006, reason: "late close" });
  expect(client.getConnectionState().status).toBe("disposed");

  await client.close();
  await expect(client.connect()).rejects.toThrow("Daemon client is disposed");
});

test("ignores a deferred Blob message from a stale reconnect transport", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;
    let resolveBlob: ((buffer: ArrayBuffer) => void) | undefined;
    const blobBuffer = new Promise<ArrayBuffer>((resolve) => {
      resolveBlob = resolve;
    });
    class DeferredBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return blobBuffer;
      }
    }
    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_deferred_blob",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 5 },
      transportFactory: () => {
        callCount += 1;
        return callCount === 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    let connected = false;
    const connectPromise = client.connect().then(() => {
      connected = true;
      return true;
    });
    first.triggerMessage(new DeferredBlob());
    first.triggerClose({ code: 1006, reason: "retry" });
    await vi.advanceTimersByTimeAsync(5);
    expect(client.getConnectionState().status).toBe("connecting");

    const staleServerInfo = new TextEncoder().encode(
      JSON.stringify({
        type: "session",
        message: {
          type: "status",
          payload: {
            status: "server_info",
            serverId: "srv_stale_blob",
            hostname: null,
            version: null,
          },
        },
      }),
    );
    resolveBlob?.(staleServerInfo.buffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(connected).toBe(false);
    expect(client.getConnectionState().status).toBe("connecting");

    second.triggerSocketOpen();
    second.triggerMessage(new Blob([staleServerInfo]));
    await connectPromise;
    expect(connected).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("ensureConnected triggers reconnect when disconnected", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_4",
      logger,
      reconnect: { enabled: false }, // auto-reconnect off
      transportFactory: () => {
        callCount += 1;
        return callCount === 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    // Initial connect succeeds.
    const connectPromise = client.connect();
    first.triggerOpen();
    await connectPromise;
    expect(client.getConnectionState().status).toBe("connected");

    // Connection drops – auto-reconnect is disabled, so state goes to disconnected.
    first.triggerClose({ code: 1001 });
    expect(client.getConnectionState().status).toBe("disconnected");

    // Call ensureConnected – should trigger connect on the second transport.
    client.ensureConnected();
    expect(client.getConnectionState().status).toBe("connecting");

    second.triggerOpen();
    expect(client.getConnectionState().status).toBe("connected");
  } finally {
    vi.useRealTimers();
  }
});

test("ensureConnected is a no-op when already disposed", async () => {
  const logger = createMockLogger();
  const mock = createMockTransport();

  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_reconnect_5",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen();
  await connectPromise;
  expect(client.getConnectionState().status).toBe("connected");

  await client.close();
  expect(client.getConnectionState().status).toBe("disposed");

  client.ensureConnected();
  expect(client.getConnectionState().status).toBe("disposed");
});

test("uses exponential backoff between reconnect attempts", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const mock = createMockTransport();

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_6",
      logger,
      reconnect: { enabled: true, baseDelayMs: 100, maxDelayMs: 5000 },
      transportFactory: () => mock.transport,
    });
    clients.push(client);

    const _connectPromise = client.connect().catch(() => {});
    // Fire only close to get single-increment per attempt
    mock.triggerClose({ code: 1006, reason: "refused" });

    // First reconnect delay: baseDelay * 2^0 = 100
    await vi.advanceTimersByTimeAsync(99);
    expect(client.getConnectionState().status).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1);
    expect(client.getConnectionState().status).toBe("connecting");

    // Fail again.
    mock.triggerClose({ code: 1006, reason: "refused" });
    expect(client.getConnectionState().status).toBe("disconnected");

    // Second reconnect delay: baseDelay * 2^1 = 200
    await vi.advanceTimersByTimeAsync(199);
    expect(client.getConnectionState().status).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1);
    expect(client.getConnectionState().status).toBe("connecting");

    // Fail again.
    mock.triggerClose({ code: 1006, reason: "refused" });
    expect(client.getConnectionState().status).toBe("disconnected");

    // Third delay: baseDelay * 2^2 = 400
    await vi.advanceTimersByTimeAsync(399);
    expect(client.getConnectionState().status).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(1);
    expect(client.getConnectionState().status).toBe("connecting");
  } finally {
    vi.useRealTimers();
  }
});

test("reconnect does not resolve original connect promise until hello completes", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_7",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 5 },
      transportFactory: () => {
        callCount += 1;
        return callCount === 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    // Start connect – first transport fails without opening.
    const connectPromise = client.connect();
    first.triggerError(new Error("refused"));
    first.triggerClose({ code: 1006 });

    // Reconnect fires.
    await vi.advanceTimersByTimeAsync(10);

    // Before hello completes, the original connect promise should still be pending.
    // Check that connectionState is "connecting" not "connected".
    expect(client.getConnectionState().status).toBe("connecting");

    // Complete the hello handshake.
    second.triggerOpen();
    expect(client.getConnectionState().status).toBe("connected");
    await connectPromise;
  } finally {
    vi.useRealTimers();
  }
});

test("lastError is cleared after successful reconnect", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const first = createMockTransport();
    const second = createMockTransport();
    let callCount = 0;

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_8",
      logger,
      reconnect: { enabled: true, baseDelayMs: 5, maxDelayMs: 100 },
      transportFactory: () => {
        callCount += 1;
        return callCount <= 1 ? first.transport : second.transport;
      },
    });
    clients.push(client);

    const connectPromise = client.connect();
    // Fail first attempt – lastError should be set.
    first.triggerError(new Error("refused"));
    first.triggerClose({ code: 1006, reason: "refused" });
    expect(client.lastError).toMatch(/refused/);

    // Reconnect succeeds.
    await vi.advanceTimersByTimeAsync(10);
    second.triggerOpen();
    await connectPromise;
    expect(client.getConnectionState().status).toBe("connected");

    // lastError is cleared in the onOpen handler when the transport reopens.
    expect(client.lastError).toBeNull();
    expect(callCount).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("reconnect is disabled when config.reconnect.enabled is false", async () => {
  vi.useFakeTimers();
  try {
    const logger = createMockLogger();
    const mock = createMockTransport();

    const client = new DaemonClient({
      url: "ws://test",
      clientId: "clsk_reconnect_9",
      logger,
      reconnect: { enabled: false },
      transportFactory: () => mock.transport,
    });
    clients.push(client);

    // Start connect.
    const connectPromise = client.connect().then(
      () => ({ ok: true as const }),
      (e) => ({ ok: false as const, error: e }),
    );

    // Fail transport before hello.
    mock.triggerError(new Error("refused"));
    mock.triggerClose({ code: 1006, reason: "refused" });

    // Wait well past any retry interval.
    await vi.advanceTimersByTimeAsync(5000);

    const result = await connectPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toMatch(/refused|disconnected/);
    }
    expect(client.getConnectionState().status).toBe("disconnected");
  } finally {
    vi.useRealTimers();
  }
});

test("getConnectionState reflects correct state through reconnect lifecycle", async () => {
  const logger = createMockLogger();
  const mock = createMockTransport();

  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_reconnect_10",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  // Initial idle state.
  expect(client.getConnectionState().status).toBe("idle");

  // Connect without awaiting – should be connecting.
  const connectPromise = client.connect();
  expect(client.getConnectionState().status).toBe("connecting");

  mock.triggerOpen();
  await connectPromise;
  expect(client.getConnectionState().status).toBe("connected");

  // Transport close with reconnect disabled should go to disconnected.
  mock.triggerClose({ code: 1000, reason: "Done" });
  expect(client.getConnectionState()).toMatchObject({
    status: "disconnected",
  });

  // Explicit close.
  await client.close();
  expect(client.getConnectionState().status).toBe("disposed");
});
