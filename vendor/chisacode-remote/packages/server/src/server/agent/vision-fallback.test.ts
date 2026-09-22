import { describe, expect, test, vi } from "vitest";

import {
  applyVisionFallbackToPrompt,
  buildVisionDescribeRequestBody,
  extractChatCompletionText,
  extractPromptImages,
  injectImageDescriptionsIntoPrompt,
  primaryModelNeedsVisionFallback,
  resolveVisionGatewayChatUrl,
} from "./vision-fallback.js";
import type { ModelGatewayConfig } from "./provider-launch-config.js";

const SAMPLE_GATEWAY: ModelGatewayConfig = {
  id: "vision",
  label: "Vision",
  enabled: true,
  models: [{ id: "vision-model", label: "Vision", supportsImages: true }],
  upstreams: {
    anthropic: { enabled: false, baseUrl: "", apiKey: "" },
    chatCompletions: {
      enabled: true,
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    },
    responses: { enabled: false, baseUrl: "", apiKey: "" },
  },
};

describe("vision-fallback", () => {
  test("primaryModelNeedsVisionFallback only skips when supportsImages is true", () => {
    expect(primaryModelNeedsVisionFallback(true)).toBe(false);
    expect(primaryModelNeedsVisionFallback(false)).toBe(true);
    expect(primaryModelNeedsVisionFallback(undefined)).toBe(true);
  });

  test("extractPromptImages collects image blocks", () => {
    expect(extractPromptImages("plain")).toEqual([]);
    expect(
      extractPromptImages([
        { type: "text", text: "hi" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ]),
    ).toEqual([{ type: "image", data: "abc", mimeType: "image/png" }]);
  });

  test("injectImageDescriptionsIntoPrompt replaces images with text", () => {
    const result = injectImageDescriptionsIntoPrompt(
      [
        { type: "text", text: "look" },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      ["a red button"],
    );
    expect(result).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[Image 1 description]\na red button" },
    ]);
  });

  test("resolveVisionGatewayChatUrl accepts origin and route base", () => {
    expect(resolveVisionGatewayChatUrl("http://127.0.0.1:6767", "vision")).toBe(
      "http://127.0.0.1:6767/api/model-gateways/vision/v1/chat/completions",
    );
    expect(
      resolveVisionGatewayChatUrl("http://127.0.0.1:6767/api/model-gateways/vision", "vision"),
    ).toBe("http://127.0.0.1:6767/api/model-gateways/vision/v1/chat/completions");
  });

  test("buildVisionDescribeRequestBody embeds data URL", () => {
    const body = buildVisionDescribeRequestBody({
      modelId: "vision-model",
      image: { type: "image", data: "YWJj", mimeType: "image/png" },
    });
    expect(body.model).toBe("vision-model");
    const messages = body.messages as Array<{ content: unknown }>;
    const user = messages[1]?.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(user[1]?.image_url?.url).toBe("data:image/png;base64,YWJj");
  });

  test("extractChatCompletionText reads assistant content", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "  hello  " } }],
      }),
    ).toBe("hello");
  });

  test("applyVisionFallbackToPrompt describes images via requestGateway", async () => {
    const requestGateway = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "screenshot of login form" } }],
      }),
    );

    const result = await applyVisionFallbackToPrompt({
      prompt: [
        { type: "text", text: "fix this" },
        { type: "image", data: "YWJj", mimeType: "image/png" },
      ],
      primarySupportsImages: false,
      visionFallback: { provider: "vision-opencode", modelId: "openai/vision-model" },
      modelGateways: { vision: SAMPLE_GATEWAY },
      requestGateway,
    });

    expect(result.applied).toBe(true);
    expect(result.descriptions).toEqual(["screenshot of login form"]);
    expect(result.prompt).toEqual([
      { type: "text", text: "fix this" },
      { type: "text", text: "[Image 1 description]\nscreenshot of login form" },
    ]);
    expect(requestGateway).toHaveBeenCalledOnce();
    const call = requestGateway.mock.calls[0]?.[0];
    expect(call?.requestBody.model).toBe("vision-model");
  });

  test("applyVisionFallbackToPrompt no-ops when primary supports images", async () => {
    const requestGateway = vi.fn();
    const prompt = [
      { type: "text" as const, text: "see" },
      { type: "image" as const, data: "x", mimeType: "image/png" },
    ];
    const result = await applyVisionFallbackToPrompt({
      prompt,
      primarySupportsImages: true,
      visionFallback: { provider: "vision-opencode", modelId: "vision-model" },
      modelGateways: { vision: SAMPLE_GATEWAY },
      requestGateway,
    });
    expect(result.applied).toBe(false);
    expect(result.prompt).toBe(prompt);
    expect(requestGateway).not.toHaveBeenCalled();
  });
});
