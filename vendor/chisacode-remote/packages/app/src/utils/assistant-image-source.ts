import { fileUriToPath } from "@/attachments/utils";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";

/** How an assistant markdown image source should be loaded */
export type AssistantImageSourceResolution =
  | { kind: "direct"; uri: string }
  | { kind: "file_rpc"; cwd: string; path: string };

/**
 * Resolves an assistant image source into a direct URI or daemon file read target
 * @param input Image source string and optional workspace root for relative paths
 * @returns Direct URI or file RPC target, or null when the source is invalid
 */
export function resolveAssistantImageSource(input: {
  source: string;
  workspaceRoot?: string;
}): AssistantImageSourceResolution | null {
  const source = input.source.trim();
  if (!source) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(source)) {
    return { kind: "direct", uri: source };
  }

  const sourcePath = source.startsWith("file://") ? fileUriToPath(source) : source;
  if (!sourcePath) {
    return null;
  }

  const readTarget = resolveFilePreviewReadTarget({
    path: sourcePath,
    workspaceRoot: input.workspaceRoot,
  });
  if (!readTarget) {
    return null;
  }

  return {
    kind: "file_rpc",
    cwd: readTarget.cwd,
    path: readTarget.path,
  };
}
