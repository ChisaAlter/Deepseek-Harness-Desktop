import type { AgentMode, AgentSessionConfig } from "../../agent-sdk-types.js";

export const CODEX_MODES: AgentMode[] = [
  {
    id: "auto",
    label: "Default Permissions",
    description: "Edit files and run commands with Codex's default approval flow.",
  },
  {
    id: "auto-review",
    label: "Auto-review",
    description:
      "Same workspace-write permissions as Default, but eligible `on-request` approvals are routed through the auto-reviewer subagent.",
  },
  {
    id: "full-access",
    label: "Full Access",
    description: "Edit files, run commands, and access the network without additional prompts.",
  },
];

export const DEFAULT_CODEX_MODE_ID = "auto";

interface CodexModePreset {
  approvalPolicy: string;
  sandbox: string;
  networkAccess?: boolean;
  approvalsReviewer?: "auto_review";
}

/**
 * On Windows, Codex's restricted sandboxes currently fail process launch with
 * `CreateProcessAsUserW failed: 5` (access denied). Prefer full-access sandbox
 * there so write/shell tools can actually execute; keep restricted sandboxes
 * on platforms where they work.
 */
const WINDOWS_WRITABLE_SANDBOX =
  process.platform === "win32" ? "danger-full-access" : "workspace-write";

export const MODE_PRESETS: Record<string, CodexModePreset> = {
  "read-only": {
    approvalPolicy: "on-request",
    // Still restricted when the user explicitly chooses read-only. On Windows
    // this may fail shell launch; the mode remains available for opt-in safety.
    sandbox: "read-only",
  },
  auto: {
    approvalPolicy: process.platform === "win32" ? "never" : "on-request",
    sandbox: WINDOWS_WRITABLE_SANDBOX,
    ...(process.platform === "win32" ? { networkAccess: true } : {}),
  },
  "auto-review": {
    approvalPolicy: process.platform === "win32" ? "never" : "on-request",
    sandbox: WINDOWS_WRITABLE_SANDBOX,
    ...(process.platform === "win32"
      ? { networkAccess: true }
      : { approvalsReviewer: "auto_review" }),
  },
  "full-access": {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    networkAccess: true,
  },
};

function isAutoReviewReviewer(value: string | undefined): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

export function applyApprovalsReviewerParam(
  params: Record<string, unknown>,
  preset: CodexModePreset,
): void {
  if (preset.approvalsReviewer) {
    params.approvalsReviewer = preset.approvalsReviewer;
  }
}

export function shouldPromoteThreadResponseToAutoReview(params: {
  approvalsReviewer: string | undefined;
  approvalPolicy: string;
  sandbox: string;
}): boolean {
  return (
    isAutoReviewReviewer(params.approvalsReviewer) &&
    params.approvalPolicy === "on-request" &&
    params.sandbox === "workspace-write"
  );
}

export function validateCodexMode(modeId: string): void {
  if (!(modeId in MODE_PRESETS)) {
    const validModes = Object.keys(MODE_PRESETS).join(", ");
    throw new Error(`Invalid Codex mode "${modeId}". Valid modes are: ${validModes}`);
  }
}

export function normalizeCodexThinkingOptionId(
  thinkingOptionId: string | null | undefined,
): string | undefined {
  if (typeof thinkingOptionId !== "string") {
    return undefined;
  }
  const normalized = thinkingOptionId.trim();
  if (!normalized || normalized === "default") {
    return undefined;
  }
  return normalized;
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectSchemaNode(schema: Record<string, unknown>): boolean {
  const type = schema.type;
  return (
    isSchemaRecord(schema.properties) ||
    type === "object" ||
    (Array.isArray(type) && type.includes("object"))
  );
}

function normalizeCodexOutputSchemaNode(schema: unknown, schemaPath: string): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry, index) =>
      normalizeCodexOutputSchemaNode(entry, `${schemaPath}[${index}]`),
    );
  }
  if (!isSchemaRecord(schema)) {
    return schema;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    normalized[key] = normalizeCodexOutputSchemaNode(value, `${schemaPath}.${key}`);
  }

  if (!isObjectSchemaNode(normalized)) {
    return normalized;
  }

  if (normalized.additionalProperties === undefined) {
    normalized.additionalProperties = false;
  } else if (normalized.additionalProperties !== false) {
    throw new Error(
      `Codex structured outputs require ${schemaPath} to set additionalProperties to false for object schemas.`,
    );
  }

  const properties = isSchemaRecord(normalized.properties) ? normalized.properties : null;
  if (!properties) {
    return normalized;
  }

  const propertyKeys = Object.keys(properties);
  const existingRequired = Array.isArray(normalized.required)
    ? normalized.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  normalized.required = Array.from(new Set([...existingRequired, ...propertyKeys]));
  return normalized;
}

export function normalizeCodexOutputSchema(schema: unknown): Record<string, unknown> {
  if (!isSchemaRecord(schema)) {
    throw new Error("Codex structured outputs require a JSON object schema.");
  }

  const normalized = normalizeCodexOutputSchemaNode(schema, "$");
  if (!isSchemaRecord(normalized) || !isObjectSchemaNode(normalized)) {
    throw new Error("Codex structured outputs require a root object schema.");
  }

  return normalized;
}

function toSandboxPolicy(type: string, networkAccess?: boolean): Record<string, unknown> {
  switch (type) {
    case "read-only":
      return { type: "readOnly" };
    case "workspace-write":
      return { type: "workspaceWrite", networkAccess: networkAccess ?? false };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    default:
      return { type: "workspaceWrite", networkAccess: networkAccess ?? false };
  }
}

export interface CodexTurnStartParamsResult {
  params: Record<string, unknown>;
  thinkingOptionId?: string;
  approvalPolicy: string;
  sandboxPolicyType: string;
  hasOutputSchema: boolean;
  hasDeveloperInstructions: boolean;
  hasCodexConfig: boolean;
}

export function buildCodexTurnStartParams(input: {
  threadId: string | null;
  userInput: unknown;
  modeId: string;
  config: Pick<
    AgentSessionConfig,
    "approvalPolicy" | "sandboxMode" | "networkAccess" | "model" | "thinkingOptionId" | "cwd"
  >;
  serviceTier: "fast" | null;
  collaborationMode: { mode: string; settings: Record<string, unknown> } | null;
  outputSchema?: unknown;
  developerInstructions: string | null | undefined;
  codexConfig: Record<string, unknown> | null;
}): CodexTurnStartParamsResult {
  const preset = MODE_PRESETS[input.modeId] ?? MODE_PRESETS[DEFAULT_CODEX_MODE_ID];
  const approvalPolicy = input.config.approvalPolicy ?? preset.approvalPolicy;
  const sandboxPolicyType = input.config.sandboxMode ?? preset.sandbox;
  const params: Record<string, unknown> = {
    threadId: input.threadId,
    input: input.userInput,
    approvalPolicy,
    sandboxPolicy: toSandboxPolicy(
      sandboxPolicyType,
      typeof input.config.networkAccess === "boolean"
        ? input.config.networkAccess
        : preset.networkAccess,
    ),
  };
  applyApprovalsReviewerParam(params, preset);

  if (input.config.model) params.model = input.config.model;
  const thinkingOptionId = normalizeCodexThinkingOptionId(input.config.thinkingOptionId);
  if (thinkingOptionId) params.effort = thinkingOptionId;
  if (input.serviceTier) params.serviceTier = input.serviceTier;
  if (input.collaborationMode) {
    params.collaborationMode = {
      mode: input.collaborationMode.mode,
      settings: input.collaborationMode.settings,
    };
  }
  if (input.config.cwd) params.cwd = input.config.cwd;
  if (input.outputSchema) params.outputSchema = normalizeCodexOutputSchema(input.outputSchema);
  if (input.developerInstructions) params.developerInstructions = input.developerInstructions;
  if (input.codexConfig) params.config = input.codexConfig;

  return {
    params,
    thinkingOptionId,
    approvalPolicy,
    sandboxPolicyType,
    hasOutputSchema: Boolean(input.outputSchema),
    hasDeveloperInstructions: Boolean(input.developerInstructions),
    hasCodexConfig: Boolean(input.codexConfig),
  };
}
