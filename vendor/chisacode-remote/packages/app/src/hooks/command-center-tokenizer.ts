function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function tokenizeCommandCenterQuery(query: string | null | undefined): string[] {
  return (
    trimNonEmpty(query)
      ?.toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 0) ?? []
  );
}
