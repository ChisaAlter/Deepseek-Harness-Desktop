import { Bot } from "lucide-react-native";
import type { ComponentType } from "react";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { DshIcon } from "@/components/icons/dsh-icon";
import { KimiIcon } from "@/components/icons/kimi-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import {
  resolveProviderIconName,
  type BuiltinProviderIconName,
} from "@/components/provider-icon-name";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

const BUILTIN_PROVIDER_ICONS: Record<BuiltinProviderIconName, ProviderIconComponent> = {
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  kimi: KimiIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
  // No dedicated brand asset yet; keep a stable non-generic mapping point for
  // Grok Build / `*-grokbuild` faces (falls through Bot only if removed).
  grokbuild: Bot,
  dsh: DshIcon as unknown as ProviderIconComponent,
};

export function getProviderIcon(provider: string): ProviderIconComponent {
  const name = resolveProviderIconName(provider);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  return Bot;
}
