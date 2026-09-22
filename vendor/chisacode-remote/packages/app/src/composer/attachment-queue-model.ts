export function resolveGithubItemKindLabel(kind: "pr" | "issue"): "PR" | "issue" {
  return kind === "pr" ? "PR" : "issue";
}

export function formatGithubItemLabel(item: { number: number; title: string }): string {
  return `#${item.number} ${item.title}`;
}
