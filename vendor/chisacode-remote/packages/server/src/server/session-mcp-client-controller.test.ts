import { describe, expect, test, vi } from "vitest";
import type { MCPClient } from "@ai-sdk/mcp";
import { SessionMcpClientController } from "./session-mcp-client-controller.js";
import { asSessionLogger } from "./test-utils/session-stubs.js";
import { asInternals } from "./test-utils/class-mocks.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createClient(input?: { toolsRejects?: boolean }) {
  return asInternals<MCPClient>({
    tools: input?.toolsRejects
      ? vi.fn(async () => {
          throw new Error("tools failed");
        })
      : vi.fn(async () => ({})),
    close: vi.fn(async () => undefined),
  });
}

describe("SessionMcpClientController", () => {
  test("skips client creation when the MCP base URL is disabled", async () => {
    const createClientFactory = vi.fn();
    const controller = new SessionMcpClientController({
      mcpBaseUrl: null,
      sessionLogger: asSessionLogger({ info: vi.fn() }),
      createClient: createClientFactory,
    });

    await controller.start();
    expect(createClientFactory).not.toHaveBeenCalled();
  });

  test("closes a client that resolves after session disposal", async () => {
    const deferred = createDeferred<MCPClient>();
    const client = createClient();
    const createClientFactory = vi.fn(async () => deferred.promise);
    const controller = new SessionMcpClientController({
      mcpBaseUrl: "http://127.0.0.1:6767/mcp",
      sessionLogger: asSessionLogger({ error: vi.fn(), trace: vi.fn() }),
      createClient: createClientFactory,
    });

    const start = controller.start();
    await vi.waitFor(() => expect(createClientFactory).toHaveBeenCalledTimes(1));
    await controller.dispose();
    deferred.resolve(client);
    await start;

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.tools).not.toHaveBeenCalled();
  });

  test("closes the client when the tools handshake fails", async () => {
    const client = createClient({ toolsRejects: true });
    const logger = asSessionLogger({ error: vi.fn(), trace: vi.fn() });
    const controller = new SessionMcpClientController({
      mcpBaseUrl: "http://127.0.0.1:6767/mcp",
      sessionLogger: logger,
      createClient: vi.fn(async () => client),
    });

    await controller.start();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to initialize Agent MCP",
    );
  });
});
