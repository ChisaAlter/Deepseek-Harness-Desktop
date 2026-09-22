export interface BranchPickerDetail {
  name: string;
  committerDate: number;
}

/**
 * Puts the already-known current branch at the top of the picker so the menu
 * is never empty while the full local/remote suggestion list is still loading.
 */
export function seedCurrentBranchDetails(
  currentBranch: string | null,
  details: ReadonlyArray<BranchPickerDetail>,
): BranchPickerDetail[] {
  const trimmed = currentBranch?.trim() ?? "";
  if (!trimmed) {
    return [...details];
  }
  if (details.some((detail) => detail.name === trimmed)) {
    return [...details];
  }
  return [{ name: trimmed, committerDate: Number.MAX_SAFE_INTEGER }, ...details];
}

/**
 * Empty-state copy for the Soft Home branch picker.
 * GitHub PR search must not keep the list on "searching" after local branches exist.
 */
export function resolveBranchPickerEmptyText(input: {
  hasBranchOptions: boolean;
  branchesFetching: boolean;
  searchingLabel: string;
  noMatchLabel: string;
}): string {
  if (input.hasBranchOptions) {
    return input.noMatchLabel;
  }
  if (input.branchesFetching) {
    return input.searchingLabel;
  }
  return input.noMatchLabel;
}
