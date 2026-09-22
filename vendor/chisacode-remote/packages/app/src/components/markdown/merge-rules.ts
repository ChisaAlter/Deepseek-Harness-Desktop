import type { RenderRules } from "react-native-markdown-display";

/**
 * Layer ChisaCode/domain rules on top of shared Paseo-style base rules.
 * Extension keys win; base rules fill the rest.
 * @param base Shared markdown rule set
 * @param extension Domain overrides (file links, generative UI, etc.)
 * @returns Merged RenderRules
 */
export function mergeMarkdownRules(
  base: RenderRules,
  extension: RenderRules | undefined,
): RenderRules {
  if (!extension) {
    return base;
  }
  return { ...base, ...extension };
}
