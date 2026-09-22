import { describe, expect, test, vi } from "vitest";

import {
  handleModelGatewayRequest,
  listModelGatewayModels,
  runModelGatewayTest,
  runSyntheticModelTest,
} from "./model-gateway.js";
import type { ModelGatewayConfig } from "@chisacode/protocol/provider-config";

function makeGateway(overrides: Partial<ModelGatewayConfig> = {}): ModelGatewayConfig {
  return {
    id: "zai",
    label: "ZAI",
    enabled: true,
    models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
    syntheticModels: [],
    upstreams: {
      anthropic: {
        enabled: false,
        baseUrl: "",
        apiKey: "",
      },
      chatCompletions: {
        enabled: true,
        baseUrl: "https://api.z.ai/v1",
        apiKey: "sk-chat",
      },
      responses: {
        enabled: false,
        baseUrl: "",
        apiKey: "",
      },
    },
    ...overrides,
  };
}

function makeGatewayWithOnly(
  format: "anthropic" | "chatCompletions" | "responses",
): ModelGatewayConfig {
  return makeGateway({
    upstreams: {
      anthropic: {
        enabled: format === "anthropic",
        baseUrl: format === "anthropic" ? "https://api.anthropic.test/v1" : "",
        apiKey: format === "anthropic" ? "sk-anthropic" : "",
      },
      chatCompletions: {
        enabled: format === "chatCompletions",
        baseUrl: format === "chatCompletions" ? "https://api.chat.test/v1" : "",
        apiKey: format === "chatCompletions" ? "sk-chat" : "",
      },
      responses: {
        enabled: format === "responses",
        baseUrl: format === "responses" ? "https://api.responses.test/v1" : "",
        apiKey: format === "responses" ? "sk-responses" : "",
      },
    },
  });
}

describe("model gateway", () => {
  test("measures successful upstream connectivity for each gateway format", async () => {
    for (const format of ["anthropic", "chatCompletions", "responses"] as const) {
      const calls: Request[] = [];
      const result = await runModelGatewayTest({
        gateway: makeGatewayWithOnly(format),
        modelId: "glm-5",
        fetchImpl: async (input, init) => {
          calls.push(new Request(input, init));
          return Response.json({ choices: [{ message: { content: "ok" } }] }, { status: 200 });
        },
      });

      expect(result).toMatchObject({ ok: true, status: 200, error: null });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(calls).toHaveLength(1);
      expect(await calls[0]?.json()).toMatchObject({ model: "glm-5" });
    }
  });

  test("returns HTTP failures and fetch errors with latency measurements", async () => {
    const httpFailure = await runModelGatewayTest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      modelId: "glm-5",
      fetchImpl: async () => Response.json({ error: "bad key" }, { status: 401 }),
    });
    expect(httpFailure).toMatchObject({
      ok: false,
      status: 401,
      error: "Upstream returned HTTP 401",
    });
    expect(httpFailure.durationMs).toBeGreaterThanOrEqual(0);

    const networkFailure = await runModelGatewayTest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      modelId: "glm-5",
      fetchImpl: async () => {
        throw new Error("socket closed");
      },
    });
    expect(networkFailure).toMatchObject({
      ok: false,
      status: null,
      error: "socket closed",
    });
  });

  test("reports an unconfigured gateway without making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ choices: [] }));
    const result = await runModelGatewayTest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      modelId: "glm-5",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);

    const noUpstream = await runModelGatewayTest({
      gateway: makeGateway({
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: { enabled: false, baseUrl: "", apiKey: "" },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      }),
      modelId: "glm-5",
      fetchImpl,
    });
    expect(noUpstream).toEqual({
      ok: false,
      durationMs: 0,
      status: null,
      error: "No enabled upstream is configured",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("synthesizes a configured model from references and an aggregator", async () => {
    const fetchCalls: Array<{ body: unknown }> = [];
    const response = await handleModelGatewayRequest({
      gateway: makeGateway({
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
          { id: "glm-4.6", label: "GLM 4.6" },
        ],
        syntheticModels: [
          {
            id: "moa-coder",
            label: "MoA Coder",
            references: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
            aggregatorModel: "glm-5",
            rounds: 1,
          },
        ],
      }),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "moa-coder",
        messages: [{ role: "user", content: "hello" }],
      },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        fetchCalls.push({ body });
        let content = "final synthetic answer";
        if (body.model === "glm-5-air") {
          content = "air answer";
        } else if (body.model === "glm-4.6") {
          content = "base answer";
        }
        return new Response(
          JSON.stringify({
            id: `chatcmpl_${body.model}`,
            choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "final synthetic answer" } }],
    });
    expect(fetchCalls.map((call) => (call.body as { model: string }).model)).toEqual([
      "glm-5-air",
      "glm-4.6",
      "glm-5",
    ]);
    const aggregateCall = fetchCalls[2];
    expect(aggregateCall).toBeDefined();
    expect(
      (aggregateCall.body as { messages: Array<{ content: string }> }).messages[0]?.content,
    ).toContain("air answer");
  });

  test("recognizes provider-prefixed synthetic model ids before forwarding upstream", async () => {
    const fetchCalls: Array<{ body: { model: string } }> = [];
    const response = await handleModelGatewayRequest({
      gateway: makeGateway({
        models: [
          { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
          { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
        ],
        syntheticModels: [
          {
            id: "GPT6.0",
            label: "GPT6.0",
            references: [{ model: "deepseek-v4-flash" }],
            aggregatorModel: "deepseek-v4-pro",
            rounds: 1,
          },
        ],
      }),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "openai/GPT6.0",
        messages: [{ role: "user", content: "hello" }],
      },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        fetchCalls.push({ body });
        return Response.json({
          id: `chatcmpl_${body.model}`,
          choices: [
            {
              message: { role: "assistant", content: `${body.model} answer` },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "deepseek-v4-pro answer" } }],
    });
    expect(fetchCalls.map((call) => call.body.model)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
  });

  test("runs a layered MoA synthetic model and returns node traces", async () => {
    const fetchCalls: Array<{ body: { model: string; messages: Array<{ content: string }> } }> = [];
    const result = await runSyntheticModelTest({
      gateway: makeGateway({
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
          { id: "glm-4.6", label: "GLM 4.6" },
        ],
      }),
      syntheticModel: {
        id: "moa-layered",
        label: "MoA Layered",
        references: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
        aggregatorModel: "glm-5",
        rounds: 1,
        moa: {
          defaults: { temperature: 0.4, maxTokens: 128 },
          layers: [
            {
              id: "layer-1",
              label: "Draft",
              nodes: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
            },
            {
              id: "layer-2",
              label: "Refine",
              nodes: [{ model: "glm-5-air", parameters: { temperature: 0.2 } }],
            },
          ],
          aggregator: { model: "glm-5" },
        },
      },
      prompt: "hello",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        fetchCalls.push({ body });
        return Response.json({
          id: `chatcmpl_${body.model}_${fetchCalls.length}`,
          choices: [
            {
              message: {
                role: "assistant",
                content: `${body.model} answer ${fetchCalls.length}`,
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    expect(result.finalText).toBe("glm-5 answer 4");
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]?.nodes.map((node) => node.model)).toEqual(["glm-5-air", "glm-4.6"]);
    expect(result.layers[1]?.nodes).toMatchObject([
      { model: "glm-5-air", status: "success", output: "glm-5-air answer 3" },
    ]);
    expect(fetchCalls.map((call) => call.body.model)).toEqual([
      "glm-5-air",
      "glm-4.6",
      "glm-5-air",
      "glm-5",
    ]);
    expect(fetchCalls[2]?.body.messages[0]?.content).toContain("glm-5-air answer 1");
    expect(fetchCalls[2]?.body.messages[0]?.content).toContain("glm-4.6 answer 2");
    expect(fetchCalls[2]?.body).toMatchObject({ temperature: 0.2, max_tokens: 128 });
  });

  test("caps existing three-layer MoA configs at two layers before aggregation", async () => {
    const fetchCalls: Array<{ body: { model: string } }> = [];
    const result = await runSyntheticModelTest({
      gateway: makeGateway({
        models: [
          { id: "draft-model", label: "Draft" },
          { id: "review-model", label: "Review" },
          { id: "third-model", label: "Third" },
          { id: "decision-model", label: "Decision" },
        ],
      }),
      syntheticModel: {
        id: "legacy-three-layer",
        label: "Legacy Three Layer",
        references: [{ model: "draft-model" }],
        aggregatorModel: "decision-model",
        rounds: 3,
        moa: {
          layers: [
            { id: "layer-1", nodes: [{ model: "draft-model" }] },
            { id: "layer-2", nodes: [{ model: "review-model" }] },
            { id: "layer-3", nodes: [{ model: "third-model" }] },
          ],
          aggregator: { model: "decision-model" },
        },
      },
      prompt: "hello",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        fetchCalls.push({ body });
        return Response.json({
          id: `chatcmpl_${body.model}`,
          choices: [
            {
              message: { role: "assistant", content: `${body.model} answer` },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    expect(result.layers.map((layer) => layer.id)).toEqual(["layer-1", "layer-2"]);
    expect(fetchCalls.map((call) => call.body.model)).toEqual([
      "draft-model",
      "review-model",
      "decision-model",
    ]);
  });

  test("skips empty MoA layers and lets the aggregator decide directly", async () => {
    const fetchCalls: Array<{ body: { model: string; messages: Array<{ content: string }> } }> = [];
    const result = await runSyntheticModelTest({
      gateway: makeGateway({
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
        ],
      }),
      syntheticModel: {
        id: "decision-only",
        label: "Decision Only",
        references: [{ model: "glm-5" }],
        aggregatorModel: "glm-5",
        rounds: 2,
        moa: {
          layers: [
            {
              id: "layer-1",
              label: "Draft",
              nodes: [],
            },
            {
              id: "layer-2",
              label: "Review",
              nodes: [],
            },
          ],
          aggregator: { model: "glm-5" },
        },
      },
      prompt: "hello",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        fetchCalls.push({ body });
        return Response.json({
          id: `chatcmpl_${body.model}`,
          choices: [
            {
              message: {
                role: "assistant",
                content: `${body.model} decision`,
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    expect(result.finalText).toBe("glm-5 decision");
    expect(result.layers).toEqual([
      { id: "layer-1", label: "Draft", nodes: [] },
      { id: "layer-2", label: "Review", nodes: [] },
    ]);
    expect(fetchCalls.map((call) => call.body.model)).toEqual(["glm-5"]);
    expect(fetchCalls[0]?.body.messages[0]?.content).toBe("hello");
  });

  test("uses reasoning_content when chat completion content is empty", async () => {
    const result = await runSyntheticModelTest({
      gateway: makeGateway({
        models: [
          { id: "reasoning-model", label: "Reasoning" },
          { id: "decision-model", label: "Decision" },
        ],
      }),
      syntheticModel: {
        id: "reasoning-fallback",
        label: "Reasoning Fallback",
        references: [{ model: "reasoning-model" }],
        aggregatorModel: "decision-model",
        rounds: 1,
        moa: {
          layers: [{ id: "layer-1", nodes: [{ model: "reasoning-model" }] }],
          aggregator: { model: "decision-model" },
        },
      },
      prompt: "hello",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          id: `chatcmpl_${body.model}`,
          choices: [
            {
              message: {
                role: "assistant",
                content: body.model === "reasoning-model" ? "" : "final",
                reasoning_content:
                  body.model === "reasoning-model" ? "reasoning fallback output" : undefined,
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    expect(result.layers[0]?.nodes[0]).toMatchObject({
      model: "reasoning-model",
      status: "success",
      output: "reasoning fallback output",
    });
    expect(result.finalText).toBe("final");
  });

  test("instructs the aggregator to return only the final user-facing answer", async () => {
    const aggregatePrompts: string[] = [];
    await runSyntheticModelTest({
      gateway: makeGateway({
        models: [
          { id: "draft-model", label: "Draft" },
          { id: "decision-model", label: "Decision" },
        ],
      }),
      syntheticModel: {
        id: "final-only",
        label: "Final Only",
        references: [{ model: "draft-model" }],
        aggregatorModel: "decision-model",
        rounds: 1,
      },
      prompt: "hello",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.model === "decision-model") {
          aggregatePrompts.push(String(body.messages[0]?.content ?? ""));
        }
        return Response.json({
          id: `chatcmpl_${body.model}`,
          choices: [
            {
              message: {
                role: "assistant",
                content: body.model === "draft-model" ? "draft answer" : "final answer",
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    expect(aggregatePrompts[0]).toContain("Return only the final answer");
    expect(aggregatePrompts[0]).toContain("do not include hidden reasoning or analysis");
  });

  test("continues a MoA layer when one node fails and fails when a whole layer fails", async () => {
    const gateway = makeGateway({
      models: [
        { id: "glm-5", label: "GLM 5", isDefault: true },
        { id: "bad-a", label: "Bad A" },
        { id: "bad-b", label: "Bad B" },
      ],
    });
    await expect(
      runSyntheticModelTest({
        gateway,
        syntheticModel: {
          id: "moa-failing",
          label: "MoA Failing",
          references: [{ model: "bad-a" }, { model: "bad-b" }],
          aggregatorModel: "glm-5",
          rounds: 1,
          moa: {
            layers: [
              {
                id: "layer-1",
                nodes: [{ model: "bad-a" }, { model: "bad-b" }],
              },
            ],
            aggregator: { model: "glm-5" },
          },
        },
        prompt: "hello",
        fetchImpl: async () => new Response("{}", { status: 500 }),
      }),
    ).rejects.toThrow('MoA layer "layer-1" produced no successful outputs');
  });
  test("forwards chat completions to a matching chat upstream without conversion", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const response = await handleModelGatewayRequest({
      gateway: makeGateway(),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        messages: [{ role: "user", content: "hello" }],
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            id: "chatcmpl_1",
            choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: "chatcmpl_1",
      choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    });
    expect(fetchCalls).toEqual([
      {
        url: "https://api.z.ai/v1/chat/completions",
        init: expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer sk-chat",
          }),
          body: JSON.stringify({
            model: "glm-5",
            messages: [{ role: "user", content: "hello" }],
          }),
        }),
      },
    ]);
  });

  test("normalizes developer role for matching chat completion upstreams", async () => {
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "deepseek-v4-pro",
        messages: [
          { role: "developer", content: "Use repo context." },
          { role: "user", content: "hello" },
        ],
      },
      fetchImpl: async (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            model: "deepseek-v4-pro",
            messages: [
              { role: "system", content: "Use repo context." },
              { role: "user", content: "hello" },
            ],
          }),
        );
        return Response.json({
          id: "chatcmpl_deepseek",
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        });
      },
    });
  });

  test("caps excessive token limits for Xiaomi chat completion upstreams", async () => {
    await handleModelGatewayRequest({
      gateway: makeGateway({
        upstreams: {
          anthropic: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.xiaomimimo.com/v1",
            apiKey: "sk-chat",
          },
          responses: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
        },
      }),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "mimo-v2.5",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 262_144,
        max_completion_tokens: 262_144,
      },
      fetchImpl: async (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            model: "mimo-v2.5",
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 131_072,
            max_completion_tokens: 131_072,
          }),
        );
        return Response.json({
          id: "chatcmpl_mimo",
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        });
      },
    });
  });

  test("converts an Anthropic Messages request to chat completions when only chat upstream exists", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGateway(),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        system: "Be terse.",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 128,
      },
      fetchImpl: async (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            model: "glm-5",
            messages: [
              { role: "system", content: "Be terse." },
              { role: "user", content: "hello" },
            ],
            max_tokens: 128,
            stream: false,
          }),
        );
        return new Response(
          JSON.stringify({
            id: "chatcmpl_1",
            model: "glm-5",
            choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: "chatcmpl_1",
      type: "message",
      role: "assistant",
      model: "glm-5",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 3,
        output_tokens: 2,
      },
    });
  });

  test("converts streaming chat deltas to Anthropic Messages SSE events", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    const response = await handleModelGatewayRequest({
      gateway: makeGateway(),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
      fetchImpl: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    const text = await response.text();
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain('"text":"hi"');
    expect(text).toContain("event: message_stop");
  });

  test("returns converted streaming responses before the upstream stream completes", async () => {
    const encoder = new TextEncoder();
    let releaseUpstream!: () => void;
    let upstreamReleased = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        releaseUpstream = () => {
          upstreamReleased = true;
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":" there"}}]}\n\n'),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        };
      },
    });
    const responsePromise = handleModelGatewayRequest({
      gateway: makeGateway(),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
      fetchImpl: async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    let responseResolved = false;
    const settledResponsePromise = responsePromise.then((response) => {
      responseResolved = true;
      return response;
    });
    try {
      await vi.waitFor(() => expect(responseResolved).toBe(true));
      expect(upstreamReleased).toBe(false);
    } finally {
      releaseUpstream();
    }

    const response = await settledResponsePromise;
    const text = await response.text();
    expect(text).toContain('"text":"hi"');
    expect(text).toContain('"text":" there"');
    expect(text).toContain("event: message_stop");
  });

  test("forwards the request abort signal to a direct upstream fetch", async () => {
    const abortController = new AbortController();
    let observedSignal: AbortSignal | null = null;
    const response = await handleModelGatewayRequest({
      gateway: makeGateway(),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        messages: [{ role: "user", content: "hello" }],
      },
      signal: abortController.signal,
      fetchImpl: async (_url, init) => {
        observedSignal = init?.signal ?? null;
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      },
    });

    expect(observedSignal).toBe(abortController.signal);
    await response.arrayBuffer();
  });

  test("propagates abort through synthetic nodes without running the aggregator", async () => {
    const abortController = new AbortController();
    let fetchStarted = false;
    let fetchCalls = 0;
    let observedSignal: AbortSignal | null = null;
    const responsePromise = handleModelGatewayRequest({
      gateway: makeGateway({
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
        ],
        syntheticModels: [
          {
            id: "moa-coder",
            label: "MoA Coder",
            references: [{ model: "glm-5-air" }],
            aggregatorModel: "glm-5",
            rounds: 1,
          },
        ],
      }),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "moa-coder",
        messages: [{ role: "user", content: "hello" }],
      },
      signal: abortController.signal,
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        fetchStarted = true;
        observedSignal = init?.signal ?? null;
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("synthetic fetch did not receive an AbortSignal"));
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });

    await vi.waitFor(() => expect(fetchStarted).toBe(true));
    expect(observedSignal).toBe(abortController.signal);
    abortController.abort();
    await expect(responsePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchCalls).toBe(1);
  });

  test("converts a chat completions request to Anthropic Messages when only Anthropic upstream exists", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("anthropic"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        messages: [
          { role: "system", content: "Be terse." },
          { role: "user", content: "hello" },
        ],
        max_tokens: 32,
      },
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.anthropic.test/v1/messages");
        expect(init?.body).toBe(
          JSON.stringify({
            model: "glm-5",
            messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
            system: "Be terse.",
            max_tokens: 32,
            stream: false,
          }),
        );
        return Response.json({
          id: "msg_1",
          model: "glm-5",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 2 },
        });
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: "msg_1",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  });

  test("appends v1 for Anthropic-compatible upstream bases that omit it", async () => {
    await handleModelGatewayRequest({
      gateway: makeGateway({
        upstreams: {
          anthropic: {
            enabled: true,
            baseUrl: "https://api.xiaomimimo.com/anthropic",
            apiKey: "sk-anthropic",
          },
          chatCompletions: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
          responses: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
        },
      }),
      targetFormat: "anthropic",
      requestBody: {
        model: "mimo-v2.5",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 32,
      },
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.xiaomimimo.com/anthropic/v1/messages");
        expect(init?.body).toBe(
          JSON.stringify({
            model: "mimo-v2.5",
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 32,
          }),
        );
        return Response.json({
          id: "msg_1",
          model: "mimo-v2.5",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 2 },
        });
      },
    });
  });

  test("converts a responses request to chat completions when only chat upstream exists", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        instructions: "Be terse.",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
        max_output_tokens: 32,
      },
      fetchImpl: async (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            model: "glm-5",
            messages: [
              { role: "system", content: "Be terse." },
              { role: "user", content: "hello" },
            ],
            max_tokens: 32,
            stream: false,
          }),
        );
        return Response.json({
          id: "chatcmpl_1",
          model: "glm-5",
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: "chatcmpl_1",
      object: "response",
      status: "completed",
      output_text: "hi",
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });
  });

  test("converts Responses developer input to system for chat completion upstreams", async () => {
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "deepseek-v4-pro",
        input: [
          { role: "user", content: [{ type: "input_text", text: "hello" }] },
          { role: "developer", content: [{ type: "input_text", text: "Use repo context." }] },
        ],
      },
      fetchImpl: async (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            model: "deepseek-v4-pro",
            messages: [
              { role: "user", content: "hello" },
              { role: "system", content: "Use repo context." },
            ],
            stream: false,
          }),
        );
        return Response.json({
          id: "chatcmpl_deepseek",
          model: "deepseek-v4-pro",
          choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      },
    });
  });

  test("converts an Anthropic Messages request to Responses when only Responses upstream exists", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("responses"),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        system: "Be terse.",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 32,
      },
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.responses.test/v1/responses");
        expect(init?.body).toBe(
          JSON.stringify({
            model: "glm-5",
            input: [{ type: "message", role: "user", content: "hello" }],
            instructions: "Be terse.",
            max_output_tokens: 32,
            stream: false,
          }),
        );
        return Response.json({
          id: "resp_1",
          model: "glm-5",
          output_text: "hi",
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        });
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: "resp_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });
  });

  test("converts Anthropic streaming deltas to chat completion SSE events", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("anthropic"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
      fetchImpl: async () =>
        new Response(
          'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hi"}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    });

    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain('"content":"hi"');
    expect(text).toContain("data: [DONE]");
  });

  test("converts chat streaming deltas to Responses SSE events", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: "hello",
        stream: true,
      },
      fetchImpl: async () =>
        new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    const text = await response.text();
    expect(text).toContain("event: response.output_item.added");
    expect(text).toContain("event: response.content_part.added");
    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain('"delta":"hi"');
    expect(text).toContain("event: response.output_text.done");
    expect(text).toContain("event: response.output_item.done");
    expect(text).toContain("event: response.completed");
    expect(text).toContain('"output_text":"hi"');
  });

  test("lists gateway models for OpenAI-compatible discovery", () => {
    const listing = listModelGatewayModels(
      makeGateway({
        models: [{ id: "grok-4.5", label: "grok-4.5", isDefault: true }],
      }),
    );
    expect(listing.object).toBe("list");
    const ids = (listing.data as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining(["grok-4.5", "openai/grok-4.5"]));
  });

  test("preserves Responses function_call history when converting to chat completions", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          { type: "message", role: "user", content: "read sample.ts" },
          {
            type: "function_call",
            id: "call_1",
            call_id: "call_1",
            name: "read",
            arguments: '{"path":"sample.ts"}',
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "export function oldName() {}",
          },
        ],
        tools: [
          {
            type: "function",
            name: "read",
            description: "read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          id: "chatcmpl_1",
          object: "chat.completion",
          model: "glm-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "oldName" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });

    expect(upstreamBody).toMatchObject({
      model: "glm-5",
      messages: [
        { role: "user", content: "read sample.ts" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "read", arguments: '{"path":"sample.ts"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "export function oldName() {}",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read",
          },
        },
      ],
    });
  });

  test("keeps function_call and function_call_output adjacent despite empty assistant messages", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          { type: "message", role: "user", content: "read README" },
          {
            type: "function_call",
            call_id: "call_shell",
            name: "shell_command",
            arguments: '{"command":"Get-Content README.md"}',
          },
          // Codex inserts empty assistant messages between call and output.
          {
            type: "message",
            role: "assistant",
            content: [],
          },
          {
            type: "function_call_output",
            call_id: "call_shell",
            output:
              "Exit code: 0\nWall time: 0.5 seconds\nOutput:\nSecret token for read case: TOKEN_ALPHA_7749\n",
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "TOKEN_ALPHA_7749" }],
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const roles = messages.map((m) => m.role);
    // Must be user -> assistant(tool_calls) -> tool -> assistant(text)
    // without an empty assistant splitting the tool pair.
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call_shell", function: { name: "shell_command" } }],
    });
    expect(messages[2]).toMatchObject({
      role: "tool",
      tool_call_id: "call_shell",
    });
    expect(String(messages[2]?.content)).toContain("TOKEN_ALPHA_7749");
    expect(messages[3]).toMatchObject({
      role: "assistant",
      content: "TOKEN_ALPHA_7749",
    });
  });

  test("merges assistant status text into pending tool_calls message", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "shell_command",
            arguments: '{"command":"dir"}',
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Listing files..." }],
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "sample.ts",
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    expect(messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: "Listing files...",
      tool_calls: [{ id: "call_1" }],
    });
    expect(messages[1]).toMatchObject({ role: "tool", content: "sample.ts" });
  });

  test("coerces floating timeout_ms in streamed tool call arguments to integers", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "run" }],
      },
      fetchImpl: async () => {
        const args = JSON.stringify({ command: "echo hi", timeout_ms: 15000.0 });
        const sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_fixed","function":{"name":"shell_command","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    // Arguments are JSON-encoded inside the SSE payload, so quotes are escaped.
    expect(body).toMatch(/timeout_ms\\?":\s*15000\b/);
    expect(body).not.toMatch(/timeout_ms\\?":\s*15000\.0\b/);
  });

  test("preserves object-shaped function_call_output (stdout/stderr) as tool content", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          { type: "message", role: "user", content: "run ls" },
          {
            type: "function_call",
            call_id: "call_shell",
            name: "shell",
            arguments: '{"command":"Get-Content README.md"}',
          },
          {
            type: "function_call_output",
            call_id: "call_shell",
            output: {
              stdout: "Secret token for read case: TOKEN_ALPHA_7749\n",
              stderr: "",
              exit_code: 0,
            },
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_shell");
    expect(String(toolMsg?.content)).toContain("TOKEN_ALPHA_7749");
  });

  test("preserves content-part array function_call_output as tool content", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          {
            type: "function_call",
            call_id: "call_read",
            name: "read_file",
            arguments: "{}",
          },
          {
            type: "function_call_output",
            call_id: "call_read",
            output: [{ type: "output_text", text: "export function oldName() {}" }],
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(String(toolMsg?.content)).toContain("export function oldName");
  });

  test("streams Responses function_call with a single stable call_id when chat omits tool id", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "edit file" }],
      },
      fetchImpl: async () => {
        const sse = [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"shell","arguments":"{\\"c\\":"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    const callIds = [...body.matchAll(/"call_id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    const ids = [...body.matchAll(/"type":"function_call"[^}]*"id"\s*:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    // Fallback: parse function_call items from SSE JSON payloads
    const functionCallIds: string[] = [];
    const functionCallCallIds: string[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          item?: { type?: string; id?: string; call_id?: string };
        };
        if (parsed.item?.type === "function_call") {
          if (parsed.item.id) functionCallIds.push(parsed.item.id);
          if (parsed.item.call_id) functionCallCallIds.push(parsed.item.call_id);
        }
      } catch {
        // ignore
      }
    }
    expect(functionCallCallIds.length).toBeGreaterThan(0);
    expect(functionCallIds.length).toBeGreaterThan(0);
    expect(new Set(functionCallCallIds).size).toBe(1);
    expect(functionCallIds[0]).toBe(functionCallCallIds[0]);
    expect(functionCallCallIds[0]).toMatch(/^call_/);
    void callIds;
    void ids;
  });

  test("preserves Anthropic tool_result history when converting to chat completions", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "read sample.ts" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Read",
                input: { path: "sample.ts" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "export function oldName() {}",
              },
            ],
          },
        ],
        tools: [
          {
            name: "Read",
            description: "Read a file",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          id: "chatcmpl_2",
          object: "chat.completion",
          model: "glm-5",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "oldName" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });

    expect(upstreamBody).toMatchObject({
      model: "glm-5",
      messages: [
        { role: "user", content: "read sample.ts" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: {
                name: "Read",
                arguments: '{"path":"sample.ts"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "toolu_1",
          content: "export function oldName() {}",
        },
      ],
      tools: [
        {
          type: "function",
          function: { name: "Read" },
        },
      ],
    });
  });

  test("sanitizes timeout keys at any nesting depth in tool call arguments", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "run" }],
      },
      fetchImpl: async () => {
        const args = JSON.stringify({
          task: { timeout_ms: 15000.0 },
          items: [{ command_timeout_ms: 2.75 }],
          plain: 1.5,
        });
        const sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_nested","function":{"name":"shell_command","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    // Nested and array-element timeout keys are truncated; unrelated floats survive.
    expect(body).toMatch(/timeout_ms\\?":\s*15000\b/);
    expect(body).not.toMatch(/timeout_ms\\?":\s*15000\.0\b/);
    expect(body).toMatch(/command_timeout_ms\\?":\s*2\b/);
    expect(body).not.toMatch(/command_timeout_ms\\?":\s*2\.75\b/);
    expect(body).toMatch(/plain\\?":\s*1\.5/);
  });

  test("keeps invalid JSON tool arguments untouched", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "run" }],
      },
      fetchImpl: async () => {
        const sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_broken","function":{"name":"shell_command","arguments":"{\\"broken\\""}}]}}]}\n\n`,
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    expect(body).toContain('{\\"broken\\"');
  });

  test("does not reserialize tool arguments without timeout floats", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "run" }],
      },
      fetchImpl: async () => {
        const sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_keep","function":{"name":"shell_command","arguments":"{\\"ratio\\": 1.5}"}}]}}]}\n\n`,
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    // Original spacing survives: no change → original text returned, not re-serialized.
    expect(body).toContain('{\\"ratio\\": 1.5}');
  });

  test("converts server_tool_use and mcp_tool_use like tool_use", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        max_tokens: 128,
        messages: [
          { role: "user", content: "run" },
          {
            role: "assistant",
            content: [
              { type: "server_tool_use", id: "server_1", name: "web_search", input: { q: "x" } },
              { type: "mcp_tool_use", id: "mcp_1", name: "git_status", input: {} },
            ],
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const assistant = messages.find((m) => m.role === "assistant");
    const toolCalls = (assistant?.tool_calls ?? []) as Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.function.name).toBe("web_search");
    expect(toolCalls[0]?.id).toBe("server_1");
    expect(toolCalls[1]?.function.name).toBe("git_status");
    expect(toolCalls[1]?.id).toBe("mcp_1");
  });

  test("skips reasoning items without breaking function_call pairing", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        input: [
          { type: "message", role: "user", content: "run ls" },
          { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
          {
            type: "function_call",
            call_id: "call_shell",
            name: "shell",
            arguments: "{}",
          },
          { type: "reasoning", summary: [{ type: "summary_text", text: "more thinking" }] },
          {
            type: "function_call_output",
            call_id: "call_shell",
            output: "done",
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.role).toBe("tool");
    expect(messages[2]).toMatchObject({ tool_call_id: "call_shell" });
  });

  test("assigns missing tool_calls index to a new call instead of merging into the previous", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "responses",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "run" }],
      },
      fetchImpl: async () => {
        const sse = [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"shell","arguments":"{}"}}]}}]}\n\n',
          // Missing index + new name → must start a NEW tool call, not merge into shell.
          'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}\n\n',
          // Missing index + no name → fragment of the in-flight call (read).
          'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"sample.ts\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    expect(body).toContain('"name":"shell"');
    expect(body).toContain('"name":"read"');
    expect(body).toContain('\\"path\\"');
    expect(body).toContain('\\"sample.ts\\"');
    // Two distinct tool call items are emitted (one per call), each with a
    // stable id echoed in both `id` and `call_id`.
    const callIds = new Set([...body.matchAll(/"call_id":"([^"]+)"/g)].map((match) => match[1]));
    expect(callIds.size).toBe(2);
  });

  test("forwards temperature/top_p/stop_sequences/tool_choice from Anthropic to chat", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        temperature: 0.7,
        top_p: 0.9,
        stop_sequences: ["END"],
        max_tokens: 256,
        tool_choice: { type: "tool", name: "Read" },
        messages: [{ role: "user", content: "hi" }],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const body = upstreamBody as Record<string, unknown>;
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.stop).toEqual(["END"]);
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "Read" } });
    expect(body.max_tokens).toBe(256);
  });

  test("maps chat stop and tool_choice to Anthropic stop_sequences and tool tool_choice", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("anthropic"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        temperature: 0.5,
        stop: "END",
        tool_choice: { type: "function", function: { name: "Read" } },
        messages: [{ role: "user", content: "hi" }],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({ content: [{ type: "text", text: "ok" }] });
      },
    });

    const body = upstreamBody as Record<string, unknown>;
    expect(body.temperature).toBe(0.5);
    expect(body.stop_sequences).toEqual(["END"]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "Read" });
  });

  test("drops stop when targeting Responses and maps tool_choice to {type,name}", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("responses"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        temperature: 0.3,
        stop: "END",
        tool_choice: { type: "function", function: { name: "Read" } },
        messages: [{ role: "user", content: "hi" }],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({ output: [{ type: "message", content: [] }] });
      },
    });

    const body = upstreamBody as Record<string, unknown>;
    expect(body.temperature).toBe(0.3);
    expect(body).not.toHaveProperty("stop");
    expect(body.tool_choice).toEqual({ type: "function", name: "Read" });
  });

  test("converts streaming Anthropic tool_use deltas into chat tool_calls", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("anthropic"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        stream: true,
        messages: [{ role: "user", content: "read sample.ts" }],
      },
      fetchImpl: async () => {
        const sse = [
          `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n`,
          `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
          `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}\n\n`,
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n`,
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"sample.ts\\"}"}}\n\n`,
          `event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n`,
          `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null}}\n\n`,
          `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    expect(body).toContain('"content":"hi"');
    expect(body).toContain('"type":"function"');
    expect(body).toContain('"name":"Read"');
    expect(body).toContain('"arguments":"{\\"path\\":\\"sample.ts\\"}"');
    expect(body).toContain('"finish_reason":"tool_calls"');
  });

  test("converts streaming Responses function_call items into chat tool_calls", async () => {
    const response = await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("responses"),
      targetFormat: "chatCompletions",
      requestBody: {
        model: "glm-5",
        stream: true,
        input: [{ type: "message", role: "user", content: "read sample.ts" }],
      },
      fetchImpl: async () => {
        const sse = [
          `event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"fc_1","name":"Read","arguments":"","status":"in_progress"}}\n\n`,
          `event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"path\\":"}\n\n`,
          `event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"\\"sample.ts\\"}"}\n\n`,
          `event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"fc_1","name":"Read","arguments":"{\\"path\\":\\"sample.ts\\"}","status":"completed"}}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const body = await response.text();
    expect(body).toContain('"type":"function"');
    expect(body).toContain('"name":"Read"');
    expect(body).toContain('"arguments":"{\\"path\\":\\"sample.ts\\"}"');
    expect(body).toContain('"finish_reason":"tool_calls"');
  });

  test("fills missing Anthropic tool_use ids so chat tool_calls stay non-empty", async () => {
    let upstreamBody: unknown;
    await handleModelGatewayRequest({
      gateway: makeGatewayWithOnly("chatCompletions"),
      targetFormat: "anthropic",
      requestBody: {
        model: "glm-5",
        messages: [
          { role: "user", content: "run" },
          {
            role: "assistant",
            content: [{ type: "tool_use", name: "shell", input: { command: "ls" } }],
          },
        ],
      },
      fetchImpl: async (_url, init) => {
        upstreamBody = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        });
      },
    });

    const messages = (upstreamBody as { messages: Array<Record<string, unknown>> }).messages;
    const assistant = messages.find((m) => m.role === "assistant");
    const toolCalls = (assistant?.tool_calls ?? []) as Array<{ id: string }>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.id.length).toBeGreaterThan(0);
    expect(toolCalls[0]?.id).not.toBe("");
  });
});
