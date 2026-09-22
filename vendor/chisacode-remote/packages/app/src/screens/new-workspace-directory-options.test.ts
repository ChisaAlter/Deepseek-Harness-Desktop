import { describe, expect, it } from "vitest";
import {
  buildNewWorkspaceDirectoryOptions,
  NEW_WORKSPACE_ADD_PROJECT_OPTION_ID,
} from "./new-workspace-directory-options";

describe("buildNewWorkspaceDirectoryOptions", () => {
  it("keeps the selected directory visible and appends the local add-project action", () => {
    const options = buildNewWorkspaceDirectoryOptions({
      recommendedPaths: ["/repo/main"],
      serverPaths: [],
      query: "",
      selectedDirectory: "/repo/feature",
      canPickLocalDirectory: true,
    });

    expect(options.map((option) => option.id)).toEqual([
      "/repo/feature",
      "/repo/main",
      NEW_WORKSPACE_ADD_PROJECT_OPTION_ID,
    ]);
    expect(options.at(-1)).toMatchObject({
      label: "添加新项目",
      description: "选择本机文件夹",
      kind: "directory",
    });
  });

  it("does not append the local add-project action for remote daemons", () => {
    const options = buildNewWorkspaceDirectoryOptions({
      recommendedPaths: ["/repo/main"],
      serverPaths: [],
      query: "",
      selectedDirectory: "/repo/main",
      canPickLocalDirectory: false,
    });

    expect(options.map((option) => option.id)).toEqual(["/repo/main"]);
  });
});
