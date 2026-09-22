import type { CreateChisaCodeWorktreeInput } from "@chisacode/client/internal/daemon-client";
import type { GitHubSearchItem } from "@chisacode/protocol/messages";

export type PickerItem =
  | { kind: "branch"; name: string }
  | { kind: "new-branch"; name: string; baseRefName: string | null }
  | {
      kind: "github-pr";
      item: GitHubSearchItem;
    };

export type PickerCheckoutRequest = Pick<
  CreateChisaCodeWorktreeInput,
  "action" | "refName" | "githubPrNumber"
>;

interface PickerOptionLike {
  id: string;
  label: string;
  description?: string;
}

export interface PickerOptionRenderModel {
  testID: string;
  label: string;
  description?: string;
  isBranch: boolean;
}

export function pickerItemToCheckoutRequest(
  item: PickerItem | null,
): PickerCheckoutRequest | undefined {
  if (!item) return undefined;
  switch (item.kind) {
    case "branch":
      return { action: "branch-off", refName: item.name };
    case "new-branch":
      return { action: "branch-off", refName: item.baseRefName ?? undefined };
    case "github-pr":
      return {
        action: "checkout",
        refName: item.item.headRefName ?? "",
        githubPrNumber: item.item.number,
      };
  }
}

export function pickerItemToWorktreeSlug(item: PickerItem | null, fallback: string): string {
  return item?.kind === "new-branch" ? item.name : fallback;
}

export function pickerOptionToRenderModel(
  option: PickerOptionLike,
  item: PickerItem | undefined,
  description?: string,
): PickerOptionRenderModel {
  if (!item) {
    return {
      testID: `new-workspace-ref-picker-new-branch-${option.id}`,
      label: option.label,
      description: option.description,
      isBranch: true,
    };
  }

  if (item.kind !== "github-pr") {
    return {
      testID: `new-workspace-ref-picker-branch-${item.name}`,
      label: option.label,
      description,
      isBranch: true,
    };
  }

  return {
    testID: `new-workspace-ref-picker-pr-${item.item.number}`,
    label: option.label,
    description,
    isBranch: false,
  };
}
