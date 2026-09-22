import type { ToolCallDetail, ToolCallIconName } from "@chisacode/protocol/agent-types";
import { isChisaCodeToolName } from "@chisacode/protocol/tool-name-normalization";

/** Canonical tool-call icon name used by UI icon resolvers */
export type ToolCallIcon = ToolCallIconName | "chisacode";

const TOOL_DETAIL_ICON_NAMES: Record<ToolCallDetail["type"], ToolCallIcon> = {
  shell: "square_terminal",
  read: "eye",
  edit: "pencil",
  write: "pencil",
  search: "search",
  fetch: "search",
  worktree_setup: "square_terminal",
  sub_agent: "bot",
  plain_text: "wrench",
  plan: "brain",
  unknown: "wrench",
};

/**
 * Resolves the icon name for a tool call from its name and optional detail
 * @param toolName Tool name from the agent protocol
 * @param detail Optional structured tool-call detail
 * @returns Canonical icon name for the tool call
 */
export function resolveToolCallIconName(toolName: string, detail?: ToolCallDetail): ToolCallIcon {
  const lowerName = toolName.trim().toLowerCase();

  if (detail?.type === "plain_text" && detail.icon) {
    return detail.icon;
  }

  // Thoughts are rendered through ToolCall with unknown detail payloads.
  if (lowerName === "thinking" && (!detail || detail.type === "unknown")) {
    return "brain";
  }
  if (lowerName === "speak") {
    return "mic_vocal";
  }
  if (isChisaCodeToolName(lowerName)) {
    return "chisacode";
  }
  if (lowerName === "task") {
    return "bot";
  }

  if (detail) {
    return TOOL_DETAIL_ICON_NAMES[detail.type];
  }
  return "wrench";
}
