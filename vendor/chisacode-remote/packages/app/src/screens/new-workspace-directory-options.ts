import type { ComboboxOption } from "@/components/ui/combobox";
import { shortenPath } from "@/utils/shorten-path";
import { buildWorkingDirectorySuggestions } from "@/utils/working-directory-suggestions";

export const NEW_WORKSPACE_ADD_PROJECT_OPTION_ID = "__chisacode_add_new_project__";

export function buildNewWorkspaceDirectoryOptions(input: {
  recommendedPaths: string[];
  serverPaths: string[];
  query: string;
  selectedDirectory: string | null;
  canPickLocalDirectory: boolean;
}): ComboboxOption[] {
  const suggestions = buildWorkingDirectorySuggestions({
    recommendedPaths: input.recommendedPaths,
    serverPaths: input.serverPaths,
    query: input.query,
  });
  const selected = input.selectedDirectory;
  const withSelected =
    selected && !suggestions.includes(selected) ? [selected, ...suggestions] : suggestions;

  const options: ComboboxOption[] = withSelected.map((path) => ({
    id: path,
    label: shortenPath(path),
    description: path,
    kind: "directory",
  }));

  if (input.canPickLocalDirectory) {
    options.push({
      id: NEW_WORKSPACE_ADD_PROJECT_OPTION_ID,
      label: "添加新项目",
      description: "选择本机文件夹",
      kind: "directory",
    });
  }

  return options;
}
