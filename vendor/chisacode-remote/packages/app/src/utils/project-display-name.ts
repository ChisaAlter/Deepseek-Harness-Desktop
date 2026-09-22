/**
 * Derives a human-readable project name from a project id or path
 * @param projectId Project key such as a path or remote:github.com/owner/repo id
 * @returns Short display name for UI labels
 */
export function projectDisplayNameFromProjectId(projectId: string): string {
  const githubRemotePrefix = "remote:github.com/";
  if (projectId.startsWith(githubRemotePrefix)) {
    return projectId.slice(githubRemotePrefix.length) || projectId;
  }

  const segments = projectId.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectId;
}

/**
 * Extracts the leaf label used for project icon placeholder text
 * @param displayName Project display name, possibly including path segments
 * @returns Final path segment, or empty string when the name is blank
 */
export function projectIconPlaceholderLabelFromDisplayName(displayName: string): string {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    return "";
  }

  const segments = trimmedDisplayName.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmedDisplayName;
}
