/**
 * ChisaCodeClient public method contract tests.
 *
 * Verifies that the public API surface exported from @chisacode/client matches the
 * documented ChisaCodeClient interface: method names, namespaces, and return types.
 */
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createChisaCodeClient } from "./index.js";
import type { ChisaCodeClient } from "./index.js";

const RPC_PROVIDER_METHODS = new Set([
  "listModels",
  "listModes",
  "listFeatures",
  "listAvailable",
  "snapshot",
  "refresh",
  "diagnostic",
  "toolingAction",
  "listPresets",
  "subscribe",
]);

// ---------------------------------------------------------------------------
// FakeWebSocket for connected-client tests
// ---------------------------------------------------------------------------

type FakeWebSocketHandler = (...args: unknown[]) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 1;
  sent: Array<string | ArrayBuffer | Uint8Array> = [];
  onopen: FakeWebSocketHandler | null = null;
  onmessage: FakeWebSocketHandler | null = null;
  onclose: FakeWebSocketHandler | null = null;
  onerror: FakeWebSocketHandler | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.onopen?.();
  }

  message(data: string): void {
    this.onmessage?.(data);
  }
}

function sessionMessage(message: object): string {
  return JSON.stringify({ type: "session", message });
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances.length = 0;
});

// ---------------------------------------------------------------------------
// Static type and shape checks
// ---------------------------------------------------------------------------

describe("ChisaCodeClient type-level API shape", () => {
  test("createChisaCodeClient returns ChisaCodeClient", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expectTypeOf(client).toMatchTypeOf<ChisaCodeClient>();
  });

  test("client has expected top-level namespaces", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.workspaces).toBe("object");
    expect(typeof client.agents).toBe("object");
    expect(typeof client.providers).toBe("object");
    expect(typeof client.presets).toBe("object");
    expect(typeof client.config).toBe("object");
  });

  test("client has expected top-level methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.connect).toBe("function");
    expect(typeof client.close).toBe("function");
    expect(typeof client.ensureConnected).toBe("function");
    expect(typeof client.getConnectionState).toBe("function");
  });

  test("workspaces namespace has expected methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.workspaces.list).toBe("function");
    expect(typeof client.workspaces.ref).toBe("function");
    expect(typeof client.workspaces.open).toBe("function");
    expect(typeof client.workspaces.create).toBe("function");
    expect(typeof client.workspaces.archive).toBe("function");
    expect(typeof client.workspaces.subscribe).toBe("function");
  });

  test("agents namespace has expected methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.agents.ref).toBe("function");
    expect(typeof client.agents.create).toBe("function");
    expect(typeof client.agents.subscribe).toBe("function");
  });

  test("providers namespace has expected methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(Object.keys(client.providers).filter((key) => !RPC_PROVIDER_METHODS.has(key))).toEqual([
      "codex",
      "claude",
      "opencode",
      "pi",
      "kimi",
      "grokbuild",
      "dsh",
      "config",
    ]);
    // Provider RPC methods
    expect(typeof client.providers.listModels).toBe("function");
    expect(typeof client.providers.listModes).toBe("function");
    expect(typeof client.providers.listFeatures).toBe("function");
    expect(typeof client.providers.listAvailable).toBe("function");
    expect(typeof client.providers.snapshot).toBe("function");
    expect(typeof client.providers.refresh).toBe("function");
    expect(typeof client.providers.diagnostic).toBe("function");
    expect(typeof client.providers.toolingAction).toBe("function");
    expect(typeof client.providers.listPresets).toBe("function");
    expect(typeof client.providers.subscribe).toBe("function");
  });

  test("presets namespace has expected methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.presets.list).toBe("function");
  });

  test("config namespace has expected methods", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(typeof client.config.get).toBe("function");
    expect(typeof client.config.patch).toBe("function");
  });

  test("provider config builders return correct shapes", () => {
    const client = createChisaCodeClient({ url: "ws://test" });
    expect(client.providers.codex()).toEqual({ provider: "codex" });
    expect(client.providers.codex({ model: "gpt-5.4" })).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
    expect(client.providers.claude({ modeId: "build" })).toEqual({
      provider: "claude",
      modeId: "build",
    });
    expect(client.providers.config("custom", { model: "custom-model" })).toEqual({
      provider: "custom",
      model: "custom-model",
    });
  });
});

// ---------------------------------------------------------------------------
// Runtime lifecycle tests (connected client via FakeWebSocket)
// ---------------------------------------------------------------------------

describe("ChisaCodeClient runtime lifecycle", () => {
  test("connect and getConnectionState cycle", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createChisaCodeClient({
      url: "ws://daemon.test",
      reconnect: { enabled: false },
    });

    expect(client.getConnectionState()).toEqual({ status: "idle" });

    const connectPromise = client.connect();
    expect(client.getConnectionState()).toEqual({
      status: "connecting",
      attempt: 0,
    });

    const ws = FakeWebSocket.instances[0];
    ws.open();

    // hello message
    const hello = JSON.parse(ws.sent[0] as string);
    expect(hello).toMatchObject({ type: "hello", protocolVersion: 1 });

    ws.message(
      sessionMessage({
        type: "status",
        payload: { status: "server_info", serverId: "srv_api_test", hostname: null, version: null },
      }),
    );

    await connectPromise;
    expect(client.getConnectionState()).toEqual({ status: "connected" });

    await client.close();
    expect(client.getConnectionState()).toEqual({ status: "disposed" });
  });

  test("close does not error when called twice", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createChisaCodeClient({
      url: "ws://daemon.test",
      reconnect: { enabled: false },
    });

    const connectPromise = client.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message(
      sessionMessage({
        type: "status",
        payload: {
          status: "server_info",
          serverId: "srv_close_test",
          hostname: null,
          version: null,
        },
      }),
    );
    await connectPromise;

    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  test("connect resolves immediately when already connected", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createChisaCodeClient({
      url: "ws://daemon.test",
      reconnect: { enabled: false },
    });

    const connectPromise = client.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message(
      sessionMessage({
        type: "status",
        payload: {
          status: "server_info",
          serverId: "srv_dedup_test",
          hostname: null,
          version: null,
        },
      }),
    );
    await connectPromise;

    await expect(client.connect()).resolves.toBeUndefined();
    await client.close();
  });

  test("connect returns existing promise when connecting", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = createChisaCodeClient({
      url: "ws://daemon.test",
      reconnect: { enabled: false },
      connectTimeoutMs: 30000,
    });

    const p1 = client.connect();
    const p2 = client.connect();
    expect(p1).toBeInstanceOf(Promise);
    expect(p2).toBeInstanceOf(Promise);
    // Dedup contract: a concurrent connect must not create extra transports.
    // The underlying connectPromise is shared, but because connect() is async
    // each call wraps the return in a new Promise. Instead verify that only one
    // WebSocket was created.
    expect(FakeWebSocket.instances.length).toBe(1);

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message(
      sessionMessage({
        type: "status",
        payload: {
          status: "server_info",
          serverId: "srv_shared_test",
          hostname: null,
          version: null,
        },
      }),
    );
    await p1;
    await client.close();
  });
});
