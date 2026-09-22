export function agentHistoryQueryKey(
  serverId: string | null,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = options?.includeArchived ?? true;
  // Keep the default key stable for archive/pin cache patches that use the exact key.
  if (includeArchived) {
    return ["agentHistory", serverId] as const;
  }
  return ["agentHistory", serverId, "activeOnly"] as const;
}

/** Exact keys for every agent-history variant used by the app. */
export function agentHistoryQueryKeys(serverId: string | null) {
  return [
    agentHistoryQueryKey(serverId),
    agentHistoryQueryKey(serverId, { includeArchived: false }),
  ] as const;
}
