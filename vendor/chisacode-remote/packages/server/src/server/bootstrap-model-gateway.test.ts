import {
  createServer,
  request as createHttpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestChisaCodeDaemon } from "./test-utils/chisacode-daemon.js";

const upstreamServers: Array<{ close: () => Promise<void> }> = [];

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function observeResponseData(response: IncomingMessage, onData: () => void): void {
  response.on("data", onData);
  response.on("error", () => undefined);
}

function createGatewayConfig(baseUrl: string) {
  return {
    zai: {
      id: "zai",
      label: "ZAI",
      enabled: true,
      models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
      upstreams: {
        anthropic: {
          enabled: false,
          baseUrl: "",
          apiKey: "",
        },
        chatCompletions: {
          enabled: true,
          baseUrl,
          apiKey: "sk-chat",
        },
        responses: {
          enabled: false,
          baseUrl: "",
          apiKey: "",
        },
      },
    },
  };
}

interface GatedSseUpstreamOptions {
  firstChunk: string;
  finalChunk?: string;
  status?: number;
}

async function createGatedSseUpstream(options: GatedSseUpstreamOptions) {
  const finishGate = createDeferred();
  const activeResponses = new Set<ServerResponse>();
  let released = false;
  let closedWhileGated = false;
  let firstChunkWritten = false;

  const server = createServer((req, res) => {
    activeResponses.add(res);
    res.on("close", () => {
      activeResponses.delete(res);
      if (!released) {
        closedWhileGated = true;
      }
    });
    req.resume();
    req.on("end", () => {
      res.writeHead(options.status ?? 200, { "content-type": "text/event-stream" });
      res.write(options.firstChunk, () => {
        firstChunkWritten = true;
      });
      void finishGate.promise.then(() => {
        if (!res.destroyed && !res.writableEnded) {
          res.end(options.finalChunk ?? "data: [DONE]\n\n");
        }
        return undefined;
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("gated SSE upstream did not bind a TCP port");
  }

  function release(): void {
    if (released) {
      return;
    }
    released = true;
    finishGate.resolve();
  }

  const handle = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    release,
    isReleased: () => released,
    wasFirstChunkWritten: () => firstChunkWritten,
    wasClosedWhileGated: () => closedWhileGated,
    close: async (): Promise<void> => {
      release();
      for (const response of activeResponses) {
        response.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
  upstreamServers.push(handle);
  return handle;
}

async function readStreamingResponse(
  responsePromise: Promise<Response>,
  onText: (text: string) => void,
): Promise<Response> {
  const response = await responsePromise;
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("gateway response did not expose a readable body");
  }
  const decoder = new TextDecoder();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      onText(decoder.decode());
      return response;
    }
    onText(decoder.decode(result.value, { stream: true }));
  }
}

async function createJsonUpstream() {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl_1",
          model: "glm-5",
          choices: [
            {
              message: { role: "assistant", content: "hi" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test upstream did not bind a TCP port");
  }
  const handle = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  upstreamServers.push(handle);
  return handle;
}

describe("model gateway bootstrap routes", () => {
  afterEach(async () => {
    await Promise.all(upstreamServers.splice(0).map((server) => server.close()));
  });

  test("protects gateway routes with the internal token and forwards known gateways", async () => {
    const upstream = await createJsonUpstream();
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
          upstreams: {
            anthropic: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
            chatCompletions: {
              enabled: true,
              baseUrl: upstream.baseUrl,
              apiKey: "sk-chat",
            },
            responses: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
          },
        },
      },
    });
    try {
      const missingAuth = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "glm-5", messages: [] }),
        },
      );
      expect(missingAuth.status).toBe(401);

      const unknown = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/unknown/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer internal-token",
          },
          body: JSON.stringify({ model: "glm-5", messages: [] }),
        },
      );
      expect(unknown.status).toBe(404);

      const response = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer internal-token",
          },
          body: JSON.stringify({
            model: "glm-5",
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        type: "message",
        content: [{ type: "text", text: "hi" }],
      });
      expect(upstream.requests).toEqual([
        {
          url: "/chat/completions",
          authorization: "Bearer sk-chat",
          body: {
            model: "glm-5",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      ]);
    } finally {
      await daemonHandle.close();
    }
  });

  test("accepts large gateway requests without the default JSON body limit", async () => {
    const upstream = await createJsonUpstream();
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
          upstreams: {
            anthropic: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
            chatCompletions: {
              enabled: true,
              baseUrl: upstream.baseUrl,
              apiKey: "sk-chat",
            },
            responses: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
          },
        },
      },
    });
    try {
      const largeContent = "x".repeat(33 * 1024 * 1024);
      const response = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer internal-token",
          },
          body: JSON.stringify({
            model: "glm-5",
            messages: [{ role: "user", content: largeContent }],
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(upstream.requests).toHaveLength(1);
    } finally {
      await daemonHandle.close();
    }
  });

  test("applies model override routes and accepts Anthropic x-api-key auth", async () => {
    const upstream = await createJsonUpstream();
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
          upstreams: {
            anthropic: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
            chatCompletions: {
              enabled: true,
              baseUrl: upstream.baseUrl,
              apiKey: "sk-chat",
            },
            responses: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
          },
        },
      },
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/model-overrides/GPT6.0/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": "internal-token",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(upstream.requests[0]?.body).toMatchObject({
        model: "GPT6.0",
      });
    } finally {
      await daemonHandle.close();
    }
  });

  test("streams same-format SSE chunks before the upstream response completes", async () => {
    const upstream = await createGatedSseUpstream({
      firstChunk: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
    });
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: createGatewayConfig(upstream.baseUrl),
    });
    let received = "";
    let downstreamResponse: Response | null = null;
    const responsePromise = fetch(
      `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer internal-token",
        },
        body: JSON.stringify({
          model: "glm-5",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      },
    ).then((response) => {
      downstreamResponse = response;
      return response;
    });
    const readPromise = readStreamingResponse(responsePromise, (text) => {
      received += text;
    });

    try {
      await vi.waitFor(() => expect(upstream.wasFirstChunkWritten()).toBe(true));
      await vi.waitFor(() => expect(received).toContain('"content":"first"'));
      expect(upstream.isReleased()).toBe(false);
      expect(downstreamResponse?.status).toBe(200);
      expect(downstreamResponse?.headers.get("content-type")).toContain("text/event-stream");
      expect(downstreamResponse?.headers.get("content-length")).toBeNull();
    } finally {
      upstream.release();
      await readPromise.finally(() => daemonHandle.close());
    }
  });

  test("streams converted SSE chunks before the upstream response completes", async () => {
    const upstream = await createGatedSseUpstream({
      firstChunk: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
    });
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: createGatewayConfig(upstream.baseUrl),
    });
    let received = "";
    const responsePromise = fetch(
      `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer internal-token",
        },
        body: JSON.stringify({
          model: "glm-5",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      },
    );
    const readPromise = readStreamingResponse(responsePromise, (text) => {
      received += text;
    });

    try {
      await vi.waitFor(() => expect(upstream.wasFirstChunkWritten()).toBe(true));
      await vi.waitFor(() => {
        expect(received).toContain("event: content_block_delta");
        expect(received).toContain('"text":"first"');
      });
      expect(upstream.isReleased()).toBe(false);
    } finally {
      upstream.release();
      await readPromise.finally(() => daemonHandle.close());
    }
  });

  test("streams non-OK SSE responses without rewriting their status", async () => {
    const upstream = await createGatedSseUpstream({
      status: 429,
      firstChunk: 'data: {"error":{"message":"rate limited"}}\n\n',
    });
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: createGatewayConfig(upstream.baseUrl),
    });
    let received = "";
    let downstreamResponse: Response | null = null;
    const responsePromise = fetch(
      `http://127.0.0.1:${daemonHandle.port}/api/model-gateways/zai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer internal-token",
        },
        body: JSON.stringify({ model: "glm-5", messages: [], stream: true }),
      },
    ).then((response) => {
      downstreamResponse = response;
      return response;
    });
    const readPromise = readStreamingResponse(responsePromise, (text) => {
      received += text;
    });

    try {
      await vi.waitFor(() => expect(upstream.wasFirstChunkWritten()).toBe(true));
      await vi.waitFor(() => expect(received).toContain("rate limited"));
      expect(upstream.isReleased()).toBe(false);
      expect(downstreamResponse?.status).toBe(429);
    } finally {
      upstream.release();
      await readPromise.finally(() => daemonHandle.close());
    }
  });

  test("cancels the upstream response when the downstream TCP socket closes", async () => {
    const upstream = await createGatedSseUpstream({
      firstChunk: 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
    });
    const daemonHandle = await createTestChisaCodeDaemon({
      modelGatewayToken: "internal-token",
      modelGateways: createGatewayConfig(upstream.baseUrl),
    });
    const requestBody = JSON.stringify({
      model: "glm-5",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    let downstreamChunkSeen = false;
    let downstreamError: Error | null = null;
    const markDownstreamChunkSeen = (): void => {
      downstreamChunkSeen = true;
    };
    const clientRequest = createHttpRequest(
      {
        host: "127.0.0.1",
        port: daemonHandle.port,
        path: "/api/model-gateways/zai/v1/chat/completions",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(requestBody),
          authorization: "Bearer internal-token",
        },
      },
      (response) => {
        observeResponseData(response, markDownstreamChunkSeen);
      },
    );
    clientRequest.on("error", (error) => {
      if (!clientRequest.destroyed) {
        downstreamError = error;
      }
    });
    clientRequest.end(requestBody);

    try {
      await vi.waitFor(() => expect(upstream.wasFirstChunkWritten()).toBe(true));
      await vi.waitFor(() => expect(downstreamChunkSeen).toBe(true));
      expect(downstreamError).toBeNull();
      expect(upstream.wasClosedWhileGated()).toBe(false);
      clientRequest.destroy();
      await vi.waitFor(() => expect(upstream.wasClosedWhileGated()).toBe(true));
      expect(upstream.isReleased()).toBe(false);
    } finally {
      clientRequest.destroy();
      upstream.release();
      await daemonHandle.close();
    }
  });
});
