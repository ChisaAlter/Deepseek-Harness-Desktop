// Intentional module public surface: aggregates the subagent domain's
// stable API (selection, archive, tab policies). Not a convenience barrel —
// consumers depend on this as the canonical import boundary.
export type { SubagentRow } from "./select";
export { selectSubagentsForParent, useSubagentsForParent } from "./select";
export { useArchiveSubagent, type UseArchiveSubagentInput } from "./use-archive-subagent";
export { resolveCloseAgentTabPolicy, type CloseAgentTabPolicy } from "./close-tab-policy";
export { shouldAutoOpenAgentTab } from "./auto-open-tab-policy";
