import type { Logger } from "pino";

import type { AgentPromptContentBlock, AgentPromptInput } from "./agent-sdk-types.js";
import type { ModelGatewayConfig, ModelGatewayConfigs } from "./provider-launch-config.js";

export interface VisionFallbackModelRef {
  provider: string;
  modelId: string;
}

export interface VisionImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

const VISION_DESCRIBE_SYSTEM_PROMPT = [
  "You describe images for a coding assistant that cannot see images.",
  "Return a concise structured description covering:",
  "- overall scene / UI layout",
  "- visible text (OCR when readable)",
  "- important UI controls, errors, or code snippets",
  "- anything a developer would need to act on the image",
  "Do not refuse. Do not add preamble about being an AI. Plain text only.",
].join("\n");

/**
 * Collects image blocks from a prompt input.
 */
export function extractPromptImages(prompt: AgentPromptInput): VisionImageBlock[] {
  if (typeof prompt === "string") {
    return [];
  }
  const images: VisionImageBlock[] = [];
  for (const block of prompt) {
    if (block.type === "image") {
      images.push(block);
    }
  }
  return images;
}

/**
 * Returns true when the primary model is known not to accept images.
 * Unknown / undefined is treated as unsupported so a configured fallback can help.
 */
export function primaryModelNeedsVisionFallback(supportsImages: boolean | undefined): boolean {
  return supportsImages !== true;
}

/**
 * Replaces image blocks with text descriptions while keeping non-image blocks.
 * @param prompt Original prompt (string or content blocks)
 * @param descriptions Per-image descriptions in the same order as extractPromptImages
 * @returns Prompt safe for a non-vision primary model
 */
export function injectImageDescriptionsIntoPrompt(
  prompt: AgentPromptInput,
  descriptions: string[],
): AgentPromptInput {
  if (typeof prompt === "string") {
    if (descriptions.length === 0) {
      return prompt;
    }
    const rendered = renderDescriptionBlocks(descriptions);
    return prompt.trim().length > 0 ? `${prompt.trim()}\n\n${rendered}` : rendered;
  }

  const next: AgentPromptContentBlock[] = [];
  let imageIndex = 0;
  for (const block of prompt) {
    if (block.type === "image") {
      const description = descriptions[imageIndex] ?? "(no description)";
      imageIndex += 1;
      next.push({
        type: "text",
        text: formatSingleImageDescription(imageIndex, description),
      });
      continue;
    }
    next.push(block);
  }
  return next;
}

function formatSingleImageDescription(index: number, description: string): string {
  return `[Image ${index} description]\n${description.trim()}`;
}

function renderDescriptionBlocks(descriptions: string[]): string {
  return descriptions
    .map((description, index) => formatSingleImageDescription(index + 1, description))
    .join("\n\n");
}

/**
 * Resolves a gateway + raw model id for a generated provider id like `grok-codex`.
 */
export function resolveGatewayForProviderId(
  providerId: string,
  gateways: ModelGatewayConfigs | undefined,
): { gateway: ModelGatewayConfig; rawModelId: string } | null {
  if (!gateways) {
    return null;
  }
  for (const gateway of Object.values(gateways)) {
    const faces = [
      `${gateway.id}-claude`,
      `${gateway.id}-codex`,
      `${gateway.id}-opencode`,
      `${gateway.id}-pi`,
      `${gateway.id}-kimi`,
      `${gateway.id}-grokbuild`,
      `${gateway.id}-dsh`,
    ];
    if (!faces.includes(providerId) && providerId !== gateway.id) {
      continue;
    }
    return { gateway, rawModelId: "" };
  }
  return null;
}

/**
 * Builds a chat-completions body for a one-shot image description call.
 */
export function buildVisionDescribeRequestBody(params: {
  modelId: string;
  image: VisionImageBlock;
}): Record<string, unknown> {
  const dataUrl = params.image.data.startsWith("data:")
    ? params.image.data
    : `data:${params.image.mimeType};base64,${params.image.data}`;
  return {
    model: params.modelId,
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: "system", content: VISION_DESCRIBE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image for a coding agent.",
          },
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  };
}

/**
 * Extracts assistant text from a chat-completions style JSON body.
 */
export function extractChatCompletionText(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

export type VisionGatewayRequester = (input: {
  gateway: ModelGatewayConfig;
  requestBody: Record<string, unknown>;
}) => Promise<Response>;

export interface ApplyVisionFallbackParams {
  prompt: AgentPromptInput;
  primarySupportsImages: boolean | undefined;
  visionFallback: VisionFallbackModelRef | null | undefined;
  modelGateways: ModelGatewayConfigs | undefined;
  /** In-process gateway request (preferred). */
  requestGateway?: VisionGatewayRequester;
  /** HTTP fallback when requestGateway is not provided. */
  modelGatewayBaseUrl?: string;
  modelGatewayToken?: string;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export interface ApplyVisionFallbackResult {
  prompt: AgentPromptInput;
  applied: boolean;
  descriptions: string[];
}

/**
 * When the primary model cannot see images and a vision fallback is configured,
 * describes each image via the model gateway chat-completions route and injects
 * text descriptions into the prompt (dropping raw image blocks for the primary).
 */
export async function applyVisionFallbackToPrompt(
  params: ApplyVisionFallbackParams,
): Promise<ApplyVisionFallbackResult> {
  const images = extractPromptImages(params.prompt);
  if (
    images.length === 0 ||
    !primaryModelNeedsVisionFallback(params.primarySupportsImages) ||
    !params.visionFallback?.provider ||
    !params.visionFallback.modelId
  ) {
    return { prompt: params.prompt, applied: false, descriptions: [] };
  }

  const gatewayMatch = resolveGatewayIdFromProvider(params.visionFallback.provider);
  const gateway = gatewayMatch ? params.modelGateways?.[gatewayMatch.gatewayId] : undefined;
  if (!gateway || gateway.enabled === false) {
    params.logger?.warn(
      { provider: params.visionFallback.provider },
      "Vision fallback skipped: gateway not found or disabled",
    );
    return { prompt: params.prompt, applied: false, descriptions: [] };
  }

  const modelId = stripGatewayModelPrefix(params.visionFallback.modelId);
  const descriptions: string[] = [];
  const request = buildGatewayRequester(params, gateway);

  if (!request) {
    params.logger?.warn("Vision fallback skipped: no gateway request transport");
    return { prompt: params.prompt, applied: false, descriptions: [] };
  }

  for (const [index, image] of images.entries()) {
    try {
      const response = await request(
        buildVisionDescribeRequestBody({
          modelId,
          image,
        }),
      );
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        params.logger?.warn(
          {
            status: response.status,
            errorText: errorText.slice(0, 200),
            imageIndex: index,
          },
          "Vision fallback describe request failed",
        );
        descriptions.push(`(vision fallback failed for image ${index + 1})`);
        continue;
      }
      const body: unknown = await response.json();
      const text = extractChatCompletionText(body);
      descriptions.push(text || `(empty vision description for image ${index + 1})`);
    } catch (error) {
      params.logger?.warn(
        { err: error, imageIndex: index },
        "Vision fallback describe request errored",
      );
      descriptions.push(`(vision fallback error for image ${index + 1})`);
    }
  }

  const nextPrompt = injectImageDescriptionsIntoPrompt(params.prompt, descriptions);
  params.logger?.info(
    {
      imageCount: images.length,
      visionProvider: params.visionFallback.provider,
      visionModel: params.visionFallback.modelId,
    },
    "Applied vision fallback image descriptions",
  );
  return { prompt: nextPrompt, applied: true, descriptions };
}

function buildGatewayRequester(
  params: ApplyVisionFallbackParams,
  gateway: ModelGatewayConfig,
): ((requestBody: Record<string, unknown>) => Promise<Response>) | null {
  if (params.requestGateway) {
    return (requestBody) =>
      params.requestGateway!({
        gateway,
        requestBody,
      });
  }
  if (!params.modelGatewayBaseUrl || !params.modelGatewayToken) {
    return null;
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = resolveVisionGatewayChatUrl(params.modelGatewayBaseUrl, gateway.id);
  return (requestBody) =>
    fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.modelGatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
}

function resolveGatewayIdFromProvider(
  providerId: string,
): { gatewayId: string; face: string | null } | null {
  const suffixes = [
    "-claude",
    "-codex",
    "-opencode",
    "-pi",
    "-kimi",
    "-grokbuild",
    "-dsh",
  ] as const;
  for (const suffix of suffixes) {
    if (providerId.endsWith(suffix)) {
      return {
        gatewayId: providerId.slice(0, -suffix.length),
        face: suffix.slice(1),
      };
    }
  }
  if (providerId.length > 0) {
    return { gatewayId: providerId, face: null };
  }
  return null;
}

function stripGatewayModelPrefix(modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash > 0 && slash < modelId.length - 1) {
    return modelId.slice(slash + 1);
  }
  return modelId;
}

/**
 * Builds the chat-completions URL for a gateway.
 * Accepts either a daemon origin (`http://host:port`) or a provider route base
 * (`http://host:port/api/model-gateways/{id}`).
 */
export function resolveVisionGatewayChatUrl(baseUrl: string, gatewayId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base.includes("/api/model-gateways/")) {
    return `${base}/v1/chat/completions`;
  }
  return `${base}/api/model-gateways/${encodeURIComponent(gatewayId)}/v1/chat/completions`;
}
