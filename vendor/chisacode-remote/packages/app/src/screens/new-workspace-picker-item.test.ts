import { describe, expect, it } from "vitest";
import type { GitHubSearchItem } from "@chisacode/protocol/messages";
import {
  pickerItemToCheckoutRequest,
  pickerItemToWorktreeSlug,
  pickerOptionToRenderModel,
  type PickerItem,
} from "./new-workspace-picker-item";

const prItem: GitHubSearchItem = {
  kind: "pr",
  number: 42,
  title: "Add picker",
  url: "https://example.com/pull/42",
  state: "open",
  body: null,
  labels: [],
  baseRefName: "main",
  headRefName: "feature/picker",
};

describe("pickerItemToCheckoutRequest", () => {
  it("returns undefined for no selection (null)", () => {
    expect(pickerItemToCheckoutRequest(null)).toBeUndefined();
  });

  it("maps a branch row to branch-off with the branch name", () => {
    const item: PickerItem = { kind: "branch", name: "dev" };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "branch-off",
      refName: "dev",
    });
  });

  it("maps a github-pr row to checkout using the head ref and pr number", () => {
    const item: PickerItem = {
      kind: "github-pr",
      item: prItem,
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "checkout",
      refName: "feature/picker",
      githubPrNumber: 42,
    });
  });

  it("creates a new branch from the current base and uses its name as the worktree slug", () => {
    const item: PickerItem = {
      kind: "new-branch",
      name: "feat/sidebar-actions",
      baseRefName: "main",
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "branch-off",
      refName: "main",
    });
    expect(pickerItemToWorktreeSlug(item, "generated-name")).toBe("feat/sidebar-actions");
  });

  it("keeps the generated worktree slug for existing branch selections", () => {
    expect(pickerItemToWorktreeSlug({ kind: "branch", name: "dev" }, "generated-name")).toBe(
      "generated-name",
    );
  });

  it("handles a github-pr with a null baseRef", () => {
    const item: PickerItem = {
      kind: "github-pr",
      item: {
        ...prItem,
        number: 7,
        title: "Orphan branch",
        baseRefName: null,
        headRefName: "orphan",
      },
    };
    expect(pickerItemToCheckoutRequest(item)).toEqual({
      action: "checkout",
      refName: "orphan",
      githubPrNumber: 7,
    });
  });
});

describe("pickerOptionToRenderModel", () => {
  it("renders a custom branch value as a visible create-branch row", () => {
    expect(
      pickerOptionToRenderModel(
        {
          id: "feat/sidebar-actions",
          label: 'Create branch "feat/sidebar-actions"',
          description: "Create from the current branch",
        },
        undefined,
      ),
    ).toEqual({
      testID: "new-workspace-ref-picker-new-branch-feat/sidebar-actions",
      label: 'Create branch "feat/sidebar-actions"',
      description: "Create from the current branch",
      isBranch: true,
    });
  });
});
