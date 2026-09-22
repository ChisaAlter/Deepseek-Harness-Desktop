import type { ComponentType } from "react";
import {
  Bot,
  Brain,
  Eye,
  MicVocal,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react-native";
import type { ToolCallDetail } from "@chisacode/protocol/agent-types";
import { ChisaCodeLogo } from "@/components/icons/chisacode-logo";
import { resolveToolCallIconName, type ToolCallIcon } from "./tool-call-icon-name";

/** React component type used to render a tool-call icon */
export type ToolCallIconComponent = ComponentType<{ size?: number; color?: string }>;

const ICON_COMPONENTS: Record<ToolCallIcon, ToolCallIconComponent> = {
  wrench: Wrench,
  square_terminal: SquareTerminal,
  eye: Eye,
  pencil: Pencil,
  search: Search,
  bot: Bot,
  sparkles: Sparkles,
  brain: Brain,
  mic_vocal: MicVocal,
  chisacode: ChisaCodeLogo,
};

/**
 * Maps a tool-call icon name to its React component
 * @param name Canonical tool-call icon id
 * @returns Component used to render the icon
 */
export function componentForToolCallIcon(name: ToolCallIcon): ToolCallIconComponent {
  return ICON_COMPONENTS[name];
}

/**
 * Resolves the React icon component for a tool call name and optional detail
 * @param toolName Tool name from the agent protocol
 * @param detail Optional tool-call detail used to refine the icon choice
 * @returns Component used to render the tool-call icon
 */
export function resolveToolCallIcon(
  toolName: string,
  detail?: ToolCallDetail,
): ToolCallIconComponent {
  return componentForToolCallIcon(resolveToolCallIconName(toolName, detail));
}
