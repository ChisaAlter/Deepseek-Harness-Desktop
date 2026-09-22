/** Status bucket used to decide whether a synced status loader should render */
export type StatusLoaderBucket = "needs_input" | "failed" | "running" | "attention" | "done";

/**
 * Whether the status loader animation should render for the given bucket
 * @param input Status bucket currently shown for an agent/workspace
 * @returns True only for the running bucket
 */
export function shouldRenderSyncedStatusLoader(input: {
  bucket: StatusLoaderBucket | null | undefined;
}): boolean {
  return input.bucket === "running";
}
