import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonTransport } from "./daemon-client-transport.js";

import { DaemonConnectionController } from "./daemon-client-connection-controller.js";

function createTransportHarness() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let openHandler: () => void = () => {};
  let closeHandler: (event?: unknown) => void = () => {};
  let errorHandler: (event?: unknown) => void = () => {};
  let messageHandler: (data: unknown) => void = () => {};
  const close = vi.fn();
  const transport: DaemonTransport = {
    send: (data) => sent.push(data),
    close,
    onOpen: (handler) => {
      openHandler = handler;
      return () => {};
    },
    onClose: (handler) => {
      closeHandler = handler;
      return () => {};
    },
    onError: (handler) => {
      errorHandler = handler;
      return () => {};
    },
    onMessage: (handler) => {
      messageHandler = handler;
      return () => {};
    },
  };
  return {
    transport,
    sent,
    close,
    open: () => openHandler(),
    closeEvent: (event?: unknown) => closeHandler(event),
    error: (event?: unknown) => errorHandler(event),
    message: (data: unknown) => messageHandler(data),
  };
}

function createController(options?: { connectTimeoutMs?: number; reconnectEnabled?: boolean }) {
  const transport = createTransportHarness();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const callbacks = { onMessage: vi.fn(), onConnected: vi.fn(), onReset: vi.fn() };
  const factory = vi.fn(() => transport.transport);
  const controller = new DaemonConnectionController(
    {
      url: "ws://test",
      clientId: "client-1",
      connectTimeoutMs: options?.connectTimeoutMs,
      reconnect: { enabled: options?.reconnectEnabled ?? false },
      transportFactory: factory,
    },
    logger,
    callbacks,
  );
  return { controller, transport, logger, callbacks, factory };
}

async function connectController(harness: ReturnType<typeof createController>): Promise<void> {
  const pending = harness.controller.connect();
  harness.transport.open();
  harness.controller.markConnected();
  await pending;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DaemonConnectionController", () => {
  it("owns hello handshake, connection state, and strict session sends", async () => {
    const harness = createController();
    const states: string[] = [];
    const unsubscribe = harness.controller.subscribe((state) => states.push(state.status));

    const pending = harness.controller.connect();
    expect(harness.controller.getState()).toEqual({ status: "connecting", attempt: 0 });
    harness.transport.open();
    expect(JSON.parse(String(harness.transport.sent[0]))).toMatchObject({
      type: "hello",
      clientId: "client-1",
      capabilities: { generative_ui: true },
    });

    harness.controller.markConnected();
    await expect(pending).resolves.toBeUndefined();
    expect(harness.callbacks.onConnected).toHaveBeenCalledOnce();
    harness.controller.sendSessionMessageStrict({ type: "abort_request" });
    expect(JSON.parse(String(harness.transport.sent[1]))).toEqual({
      type: "session",
      message: { type: "abort_request" },
    });
    expect(states).toEqual(["idle", "connecting", "connected"]);

    unsubscribe();
    await harness.controller.close();
  });

  it("rejects a timed-out connect and emits one reset boundary", async () => {
    vi.useFakeTimers();
    const harness = createController({ connectTimeoutMs: 100 });
    const pending = harness.controller.connect();
    const rejection = expect(pending).rejects.toThrow("Connection timed out");

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(harness.controller.getState()).toEqual({
      status: "disconnected",
      reason: "Connection timed out",
    });
    expect(harness.callbacks.onReset).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Connection timed out" }),
      false,
    );
    expect(harness.transport.close).toHaveBeenCalledWith(1_001, "Connection timed out");
    await harness.controller.close();
  });

  it("carries the client-reported device name on the first-pairing relay auth payload", async () => {
    const transport = createTransportHarness();
    transport.transport.getRelaySecurityContext = () => ({
      clientPublicKeyB64: "client-pub",
      authChallenge: "challenge-1",
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const controller = new DaemonConnectionController(
      {
        url: "ws://test",
        clientId: "client-1",
        reconnect: { enabled: false },
        transportFactory: () => transport.transport,
        relayDeviceAuth: {
          version: 1,
          serverId: "srv_1",
          deviceId: "dev_phone_1",
          pairingToken: "token_value_1234567890",
          deviceName: "iPhone · iOS 18.2",
        },
      },
      logger,
      { onMessage: vi.fn(), onConnected: vi.fn(), onReset: vi.fn() },
    );
    const pending = controller.connect();
    transport.open();
    expect(JSON.parse(String(transport.sent[0])).relayDeviceAuth).toMatchObject({
      version: 1,
      deviceId: "dev_phone_1",
      pairingToken: "token_value_1234567890",
      deviceName: "iPhone · iOS 18.2",
    });
    controller.markConnected();
    await expect(pending).resolves.toBeUndefined();
    await controller.close();
  });

  it("coalesces liveness probes and resolves them from one pong", async () => {
    const harness = createController();
    await connectController(harness);
    harness.transport.sent.length = 0;

    const first = harness.controller.checkLiveness({ timeoutMs: 1_000 });
    const second = harness.controller.checkLiveness({ timeoutMs: 1_000 });
    expect(first).toBe(second);
    expect(harness.transport.sent).toEqual([JSON.stringify({ type: "ping" })]);

    harness.controller.resolvePong();
    await expect(first).resolves.toMatchObject({ rttMs: expect.any(Number) });
    await expect(second).resolves.toMatchObject({ rttMs: expect.any(Number) });
    await harness.controller.close();
  });
});
