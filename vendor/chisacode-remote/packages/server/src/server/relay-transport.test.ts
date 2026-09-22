import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type pino from "pino";
import { generateRelayAuthKeyPair } from "@chisacode/relay/e2ee";
import {
  getRelayEncryptedPayloadBytes,
  RELAY_DATA_MAX_PAYLOAD_BYTES,
  startRelayTransport,
} from "./relay-transport";
import { isWebSocketPayloadWithinLimit, WEBSOCKET_MAX_PAYLOAD_BYTES } from "./websocket-limits.js";

function createMockLogger() {
  const messages: { level: "debug" | "info" | "warn" | "error"; args: unknown[] }[] = [];
  const logger = {
    messages,
    child: () => logger,
    debug: (...args: unknown[]) => messages.push({ level: "debug", args }),
    info: (...args: unknown[]) => messages.push({ level: "info", args }),
    warn: (...args: unknown[]) => messages.push({ level: "warn", args }),
    error: (...args: unknown[]) => messages.push({ level: "error", args }),
  };
  return logger;
}

type TestLogger = ReturnType<typeof createMockLogger>;

function hasLogMessage(logger: TestLogger, level: "info" | "warn", message: string): boolean {
  return logger.messages.some((entry) => {
    return entry.level === level && entry.args.some((arg) => arg === message);
  });
}

class FakeRelayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  deferClose = false;
  readyState = FakeRelayWebSocket.CONNECTING;
  sent: Array<string | Uint8Array | ArrayBuffer> = [];
  terminateCalls = 0;
  pingCalls = 0;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  private pendingClose: { code: number; reason: string } | null = null;

  constructor(
    readonly url: string,
    readonly options?: unknown,
  ) {}

  on(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: string, listener: (...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeRelayWebSocket.CLOSING;
    this.pendingClose = { code: code ?? 1000, reason: reason ?? "" };
    if (!this.deferClose) {
      this.acknowledgeClose();
    }
  }

  acknowledgeClose() {
    const close = this.pendingClose;
    if (!close) {
      return;
    }
    this.pendingClose = null;
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", close.code, close.reason);
  }

  terminate() {
    this.terminateCalls += 1;
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", 1006, "");
  }

  send(data: string | Uint8Array | ArrayBuffer) {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.sent.push(data);
  }

  ping() {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.pingCalls += 1;
  }

  open() {
    this.readyState = FakeRelayWebSocket.OPEN;
    this.emit("open");
  }

  message(data: unknown) {
    this.emit("message", data);
  }

  pong() {
    this.emit("pong");
  }

  private off(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }

  private emit(event: string, ...args: unknown[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }
}

function createFakeWebSockets() {
  const sockets: FakeRelayWebSocket[] = [];
  return {
    sockets,
    createWebSocket(url: string, options?: unknown) {
      const socket = new FakeRelayWebSocket(url, options);
      sockets.push(socket);
      return socket;
    },
  };
}

function getDataConnectionIds(
  relay: ReturnType<typeof createFakeWebSockets>,
): Array<string | null> {
  return relay.sockets.slice(1).map((socket) => {
    return new URL(socket.url).searchParams.get("connectionId");
  });
}

describe("relay-transport control lifecycle", () => {
  const controllers: Array<{ stop: () => Promise<void> }> = [];
  let relay: ReturnType<typeof createFakeWebSockets>;

  beforeEach(() => {
    relay = createFakeWebSockets();
  });

  afterEach(async () => {
    await Promise.all(controllers.map((controller) => controller.stop()));
    controllers.length = 0;
    vi.useRealTimers();
  });

  test("logs relay_control_connected only after first valid control message", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    expect(control).toBeDefined();

    control.open();
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(false);
    expect(control.pingCalls).toBeGreaterThan(0);

    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(true);
  });

  test("terminates and reconnects when control socket opens but never becomes ready", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const firstControl = relay.sockets[0];
    firstControl.open();

    vi.advanceTimersByTime(8_000);
    expect(hasLogMessage(logger, "warn", "relay_control_ready_timeout_terminating")).toBe(true);
    expect(firstControl.terminateCalls).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(relay.sockets.length).toBeGreaterThanOrEqual(2);
  });

  test("terminates stale control sockets in under one minute", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    logger.messages.length = 0;

    vi.advanceTimersByTime(40_000);
    expect(hasLogMessage(logger, "warn", "relay_control_stale_terminating")).toBe(true);
    expect(control.terminateCalls).toBe(1);
  });

  test("passes stable relay external session metadata when attaching data socket", async () => {
    const logger = createMockLogger();
    const attachedSockets: unknown[] = [];
    const attachedMetadata: unknown[] = [];
    const attachSocket = async (socket: unknown, metadata: unknown) => {
      attachedSockets.push(socket);
      attachedMetadata.push(metadata);
    };
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket,
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    const dataSocket = relay.sockets[1];
    expect(dataSocket).toBeDefined();
    dataSocket.open();

    await Promise.resolve();

    expect(attachedSockets).toEqual([dataSocket]);
    expect(attachedMetadata).toEqual([
      {
        transport: "relay",
        externalSessionKey: "session:clt_test",
      },
    ]);
  });

  test("bounds payload size on relay control and data sockets", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    expect(control.options).toEqual({
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
      maxPayload: 64 * 1024,
    });
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "client_1" }));

    expect(relay.sockets[1]?.options).toEqual({
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
      maxPayload: RELAY_DATA_MAX_PAYLOAD_BYTES,
    });
  });

  test("accounts exactly for encrypted base64 relay data overhead", () => {
    const expectedWireBytes = 4 * Math.ceil((WEBSOCKET_MAX_PAYLOAD_BYTES + 24 + 16) / 3);
    expect(RELAY_DATA_MAX_PAYLOAD_BYTES).toBe(expectedWireBytes);
    expect(getRelayEncryptedPayloadBytes(WEBSOCKET_MAX_PAYLOAD_BYTES)).toBe(
      RELAY_DATA_MAX_PAYLOAD_BYTES,
    );
    expect(isWebSocketPayloadWithinLimit(WEBSOCKET_MAX_PAYLOAD_BYTES)).toBe(true);
    expect(isWebSocketPayloadWithinLimit(WEBSOCKET_MAX_PAYLOAD_BYTES + 1)).toBe(false);
  });

  test("normalizes, deduplicates, validates, and caps synced connection IDs", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const uniqueIds = Array.from({ length: 257 }, (_, index) => `client_${index}`);

    const control = relay.sockets[0];
    control.open();
    control.message(
      JSON.stringify({
        type: "sync",
        connectionIds: [" client_0 ", "invalid id", "x".repeat(129), ...uniqueIds, "client_1"],
      }),
    );

    expect(getDataConnectionIds(relay)).toEqual(uniqueIds.slice(0, 256));
  });

  test("inspects at most 512 raw synced connection IDs", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const connectionIds = Array.from({ length: 2_000 }, (_, index) => {
      if (index === 0) return "seen_id";
      if (index === 1_999) return "beyond_limit";
      return index % 2 === 0 ? "invalid id" : "seen_id";
    });

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds }));

    expect(getDataConnectionIds(relay)).toEqual(["seen_id"]);
  });

  test("caps data sockets independently across connected control messages", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const uniqueIds = Array.from({ length: 257 }, (_, index) => `client_${index}`);

    const control = relay.sockets[0];
    control.open();
    for (const connectionId of uniqueIds) {
      control.message(JSON.stringify({ type: "connected", connectionId }));
    }
    control.message(JSON.stringify({ type: "connected", connectionId: "client_257" }));
    control.message(JSON.stringify({ type: "connected", connectionId: "client_258" }));
    control.message(JSON.stringify({ type: "connected", connectionId: "client_0" }));

    expect(getDataConnectionIds(relay)).toEqual(uniqueIds.slice(0, 256));
    expect(
      logger.messages.filter((entry) => {
        return entry.args.includes("relay_data_socket_capacity_reached");
      }),
    ).toEqual([
      {
        level: "warn",
        args: [
          { connectionCount: 256, maxConnectionIds: 256 },
          "relay_data_socket_capacity_reached",
        ],
      },
    ]);
  });

  test("reuses a closed slot and starts a new saturation warning cycle", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const connectionIds = Array.from({ length: 256 }, (_, index) => `client_${index}`);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds }));
    control.message(JSON.stringify({ type: "connected", connectionId: "overflow_1" }));

    const firstDataSocket = relay.sockets[1];
    control.message(JSON.stringify({ type: "disconnected", connectionId: "client_0" }));
    expect(firstDataSocket.readyState).toBe(FakeRelayWebSocket.CLOSED);
    control.message(JSON.stringify({ type: "connected", connectionId: "replacement" }));
    expect(getDataConnectionIds(relay).at(-1)).toBe("replacement");

    control.message(JSON.stringify({ type: "connected", connectionId: "overflow_2" }));
    expect(
      logger.messages.filter((entry) => {
        return entry.args.includes("relay_data_socket_capacity_reached");
      }),
    ).toHaveLength(2);
  });

  test("counts a closing data socket until close acknowledgement", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);
    const connectionIds = Array.from({ length: 256 }, (_, index) => `client_${index}`);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds }));
    control.message(JSON.stringify({ type: "connected", connectionId: "overflow_1" }));
    const socketCountAtCapacity = relay.sockets.length;
    const closingSocket = relay.sockets[1];
    closingSocket.deferClose = true;

    control.message(JSON.stringify({ type: "disconnected", connectionId: "client_0" }));
    expect(closingSocket.readyState).toBe(FakeRelayWebSocket.CLOSING);
    control.message(JSON.stringify({ type: "connected", connectionId: "client_0" }));
    control.message(JSON.stringify({ type: "connected", connectionId: "replacement" }));

    expect(relay.sockets).toHaveLength(socketCountAtCapacity);
    expect(
      logger.messages.filter((entry) => {
        return entry.args.includes("relay_data_socket_capacity_reached");
      }),
    ).toHaveLength(1);

    closingSocket.acknowledgeClose();
    control.message(JSON.stringify({ type: "connected", connectionId: "replacement" }));
    expect(relay.sockets).toHaveLength(socketCountAtCapacity + 1);
    expect(getDataConnectionIds(relay).at(-1)).toBe("replacement");

    control.message(JSON.stringify({ type: "connected", connectionId: "overflow_2" }));
    expect(
      logger.messages.filter((entry) => {
        return entry.args.includes("relay_data_socket_capacity_reached");
      }),
    ).toHaveLength(2);
  });

  test("applies connection ID validation to connected and disconnected messages", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: " valid_id " }));
    control.message(JSON.stringify({ type: "connected", connectionId: "invalid id" }));
    control.message(JSON.stringify({ type: "connected", connectionId: "x".repeat(129) }));

    expect(getDataConnectionIds(relay)).toEqual(["valid_id"]);
    const validDataSocket = relay.sockets[1];
    expect(validDataSocket.readyState).toBe(FakeRelayWebSocket.CONNECTING);

    control.message(JSON.stringify({ type: "disconnected", connectionId: "valid id" }));
    expect(validDataSocket.readyState).toBe(FakeRelayWebSocket.CONNECTING);
    control.message(JSON.stringify({ type: "disconnected", connectionId: " valid_id " }));
    expect(validDataSocket.readyState).toBe(FakeRelayWebSocket.CLOSED);
  });

  test("uses relayUseTls for control and data socket URLs", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "[::1]:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    expect(relay.sockets[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(relay.sockets[1]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
  });

  test("signs relay server control and data socket URLs when relay auth key is present", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger as unknown as pino.Logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.chisacode.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      daemonRelayAuthKeyPair: generateRelayAuthKeyPair(),
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    const controlUrl = new URL(relay.sockets[0]?.url ?? "");
    const dataUrl = new URL(relay.sockets[1]?.url ?? "");
    expect(controlUrl.searchParams.get("relayAuthPublicKeyB64")).toBeTruthy();
    expect(controlUrl.searchParams.get("relayAuthNonce")).toBeTruthy();
    expect(Number(controlUrl.searchParams.get("relayAuthIssuedAt"))).toBeGreaterThan(0);
    expect(controlUrl.searchParams.get("relayAuthSignatureB64")).toBeTruthy();
    expect(dataUrl.searchParams.get("relayAuthPublicKeyB64")).toBeTruthy();
    expect(dataUrl.searchParams.get("relayAuthNonce")).toBeTruthy();
    expect(Number(dataUrl.searchParams.get("relayAuthIssuedAt"))).toBeGreaterThan(0);
    expect(dataUrl.searchParams.get("relayAuthSignatureB64")).toBeTruthy();
  });
});
