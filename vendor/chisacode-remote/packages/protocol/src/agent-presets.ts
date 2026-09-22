import { z } from "zod/v3";

export const AgentPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  provider: z.string().min(1),
  modeId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  skillIds: z.array(z.string().min(1)).optional(),
  mcpServerIds: z.array(z.string().min(1)).optional(),
  samplePrompts: z.array(z.string().min(1)).optional(),
});

export const AgentPresetsPayloadSchema = z.object({
  presets: z.array(AgentPresetSchema),
});

export type AgentPreset = z.infer<typeof AgentPresetSchema>;

export const BUILTIN_AGENT_PRESETS: AgentPreset[] = [
  {
    id: "code-reviewer",
    label: "Code Reviewer",
    description: "Review code for bugs, regressions, security risks, and missing tests.",
    provider: "default",
    systemPrompt:
      "Review changes with a bug-first code review stance. Prioritize correctness, regressions, security, and test gaps.",
    samplePrompts: ["Review the current diff and list actionable findings."],
  },
  {
    id: "implementation-agent",
    label: "Implementation Agent",
    description: "Implement scoped engineering tasks and verify them with targeted checks.",
    provider: "default",
    systemPrompt:
      "Implement the requested change end to end. Keep edits scoped, follow local patterns, and verify with targeted tests.",
    samplePrompts: ["Implement this plan and run the relevant targeted tests."],
  },
  {
    id: "research-agent",
    label: "Research Agent",
    description: "Investigate code or docs without making changes unless asked.",
    provider: "default",
    modeId: "read-only",
    systemPrompt:
      "Research the codebase and report evidence-backed findings. Do not edit files unless explicitly asked.",
    samplePrompts: ["Map the relevant architecture and compare options."],
  },
  {
    id: "release-helper",
    label: "Release Helper",
    description: "Prepare changelog, test evidence, and release notes.",
    provider: "default",
    systemPrompt:
      "Help prepare a release by collecting changes, test evidence, risks, and user-facing notes.",
    samplePrompts: ["Summarize the release changes and required verification."],
  },
];
