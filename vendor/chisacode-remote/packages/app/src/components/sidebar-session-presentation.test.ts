import { describe, expect, it } from "vitest";
import { resolveSidebarSessionGroupPresentation } from "./sidebar-session-presentation";

describe("resolveSidebarSessionGroupPresentation", () => {
  it("uses plain compact labels for desktop workbench groups", () => {
    expect(resolveSidebarSessionGroupPresentation(false)).toEqual({
      showCollapseIndicator: false,
      showWorkspaceIcon: true,
      showAddButton: false,
      variant: "workbench",
    });
  });

  it("keeps workspace controls on compact native layouts", () => {
    expect(resolveSidebarSessionGroupPresentation(true)).toEqual({
      showCollapseIndicator: true,
      showWorkspaceIcon: true,
      showAddButton: true,
      variant: "default",
    });
  });
});
