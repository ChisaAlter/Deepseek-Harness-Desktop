import { homedir } from "node:os";

import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { ProviderSnapshotEntry } from "../agent/agent-sdk-types.js";
import type { SessionOutboundMessage } from "../messages.js";
import type { ProviderHandlerContext } from "./session-context.js";
import { ProviderHandler } from "./provider-handler.js";

function createHandlerContext(
  emitted: SessionOutboundMessage[],
  options: { supportsCustomModeIcons?: boolean } = {},
): {
  context: ProviderHandlerContext;
  emitChange: (entries: ProviderSnapshotEntry[], cwd: string) => void;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} {
  let listener: ((entries: ProviderSnapshotEntry[], cwd: string) => void) | undefined;
  const on = vi.fn((_event: "change", nextListener: typeof listener) => {
    listener = nextListener;
    return manager;
  });
  const off = vi.fn((_event: "change", nextListener: typeof listener) => {
    if (listener === nextListener) {
      listener = undefined;
    }
    return manager;
  });
  const manager = { on, off };
  const context = {
    sessionLogger: pino({ level: "silent" }),
    emit: (message: SessionOutboundMessage) => emitted.push(message),
    supports: () => options.supportsCustomModeIcons === true,
    isProviderVisibleToClient: (provider: string) => provider !== "hidden-provider",
    providerSnapshotManager: manager,
    daemonConfigStore: {
      get: () => ({ modelGateways: {} }),
    },
  } as unknown as ProviderHandlerContext;

  return {
    context,
    on,
    off,
    emitChange: (entries, cwd) => listener?.(entries, cwd),
  };
}

function entry(provider: string, overrides: Partial<ProviderSnapshotEntry> = {}) {
  return {
    provider,
    status: "ready" as const,
    enabled: true,
    modes: [{ id: "custom", label: "Custom", icon: "Sparkles" }],
    ...overrides,
  } satisfies ProviderSnapshotEntry;
}

describe("ProviderHandler provider snapshot push", () => {
  it("registers one listener and projects home updates with legacy mode icons", () => {
    const emitted: SessionOutboundMessage[] = [];
    const { context, on, emitChange } = createHandlerContext(emitted);
    const handler = new ProviderHandler(context);

    handler.start();
    handler.start();
    emitChange([entry("codex"), entry("hidden-provider")], homedir());

    expect(on).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([
      {
        type: "providers_snapshot_update",
        payload: {
          entries: [
            expect.objectContaining({
              provider: "codex",
              modes: [{ id: "custom", label: "Custom", icon: "ShieldCheck" }],
            }),
          ],
          generatedAt: expect.any(String),
        },
      },
    ]);
  });

  it("keeps custom mode icons for capable clients and sends workspace cwd", () => {
    const emitted: SessionOutboundMessage[] = [];
    const { context, emitChange } = createHandlerContext(emitted, {
      supportsCustomModeIcons: true,
    });
    const handler = new ProviderHandler(context);
    handler.start();

    emitChange([entry("pi")], "/workspace/project");

    expect(emitted[0]).toMatchObject({
      type: "providers_snapshot_update",
      payload: {
        cwd: "/workspace/project",
        entries: [entry("pi")],
      },
    });
  });

  it("removes the exact listener on dispose and ignores later updates", () => {
    const emitted: SessionOutboundMessage[] = [];
    const { context, on, off, emitChange } = createHandlerContext(emitted);
    const handler = new ProviderHandler(context);
    handler.start();
    handler.dispose();
    handler.dispose();
    emitChange([entry("codex")], homedir());

    expect(off).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledWith("change", expect.any(Function));
    expect(emitted).toHaveLength(0);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it("returns an RPC error payload for an unknown model gateway test", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const { context } = createHandlerContext(emitted);
    const handler = new ProviderHandler(context);

    await handler.handleModelGatewayTestRequest({
      type: "model_gateway.test.request",
      requestId: "gateway-test-unknown",
      gatewayId: "missing",
      modelId: "glm-5",
    });

    expect(emitted).toEqual([
      {
        type: "model_gateway.test.response",
        payload: {
          requestId: "gateway-test-unknown",
          gatewayId: "missing",
          modelId: "glm-5",
          result: null,
          error: "Unknown model gateway",
        },
      },
    ]);
  });
  it("contains projection failures without throwing to the manager", () => {
    const emitted: SessionOutboundMessage[] = [];
    const { context, emitChange } = createHandlerContext(emitted);
    const handler = new ProviderHandler(context);
    handler.start();
    vi.spyOn(context, "emit").mockImplementation(() => {
      throw new Error("transport closed");
    });

    expect(() => emitChange([entry("codex")], homedir())).not.toThrow();
  });
});
