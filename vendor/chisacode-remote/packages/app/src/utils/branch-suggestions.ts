/** Selectable branch option for combo/autocomplete UIs */
export interface BranchComboOption {
  id: string;
  label: string;
}

/**
 * Normalizes a git ref-like name into a short branch option id
 * @param input Branch, HEAD, or refs/* string to normalize
 * @returns Short branch name, or null for empty/HEAD values
 */
export function normalizeBranchOptionName(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed || trimmed === "HEAD") {
    return null;
  }

  let normalized = trimmed;
  if (normalized.startsWith("refs/heads/")) {
    normalized = normalized.slice("refs/heads/".length);
  } else if (normalized.startsWith("refs/remotes/")) {
    normalized = normalized.slice("refs/remotes/".length);
  }
  if (normalized.startsWith("origin/")) {
    normalized = normalized.slice("origin/".length);
  }

  return normalized.length > 0 && normalized !== "HEAD" ? normalized : null;
}

/**
 * Builds a deduplicated list of branch combo options from related branch fields
 * @param input Suggested branches plus current/base/typed/worktree branch labels
 * @returns Unique branch options sorted by first-seen insertion order
 */
export function buildBranchComboOptions(input: {
  suggestedBranches?: string[];
  currentBranch?: string | null;
  baseRef?: string | null;
  typedBaseBranch?: string | null;
  worktreeBranchLabels?: string[];
}): BranchComboOption[] {
  const branchSet = new Set<string>();
  const addBranch = (name: string | null | undefined) => {
    const normalized = normalizeBranchOptionName(name);
    if (normalized) {
      branchSet.add(normalized);
    }
  };

  for (const branch of input.suggestedBranches ?? []) {
    addBranch(branch);
  }
  addBranch(input.currentBranch ?? null);
  addBranch(input.baseRef ?? null);
  addBranch(input.typedBaseBranch ?? null);
  for (const label of input.worktreeBranchLabels ?? []) {
    addBranch(label);
  }

  return Array.from(branchSet).map((name) => ({ id: name, label: name }));
}
