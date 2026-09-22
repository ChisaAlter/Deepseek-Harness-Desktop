import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

/**
 * Resolves the status-dot color for a sidebar state bucket
 * @param input Theme tokens, status bucket, and optional inactive-done treatment
 * @returns Theme color string, or null when no dot should be shown
 */
export function getStatusDotColor(input: {
  theme: Theme;
  bucket: SidebarStateBucket;
  showDoneAsInactive?: boolean;
}): string | null {
  const { theme, bucket, showDoneAsInactive = false } = input;

  if (bucket === "needs_input") {
    return theme.colors.palette.amber[500];
  }
  if (bucket === "failed") {
    return theme.colors.palette.red[500];
  }
  if (bucket === "running") {
    return theme.colors.palette.blue[500];
  }
  if (bucket === "attention") {
    return theme.colors.palette.green[500];
  }
  if (bucket === "done") {
    return showDoneAsInactive ? theme.colors.border : null;
  }
  return null;
}

/**
 * Whether a status-dot bucket should use emphasized/high-attention styling
 * @param bucket Sidebar status bucket, if any
 * @returns True for needs_input and attention buckets
 */
export function isEmphasizedStatusDotBucket(
  bucket: SidebarStateBucket | null | undefined,
): boolean {
  return bucket === "needs_input" || bucket === "attention";
}
