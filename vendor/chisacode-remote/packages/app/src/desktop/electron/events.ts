import { getDesktopHost } from "@/desktop/host";

export type DesktopEventUnlisten = () => void;

/**
 * Subscribes to a desktop IPC event. The Electron bridge (preload +
 * main `sendRendererEvent`) forwards the raw event payload directly with no
 * envelope wrapping — the event name is encoded in the IPC channel, not in a
 * payload wrapper — so the handler receives the payload as-is. This avoids the
 * previous heuristic that unwrapped any object owning a `payload` key, which
 * could mis-strip legitimate event data.
 * @param event The desktop event name to subscribe to
 * @param handler Callback receiving the raw event payload
 * @returns A promise resolving to an unlisten function
 * @throws {Error} If the desktop event API is unavailable
 */
export async function listenToDesktopEvent<TPayload>(
  event: string,
  handler: (payload: TPayload) => void,
): Promise<DesktopEventUnlisten> {
  const listen = getDesktopHost()?.events?.on;
  if (typeof listen !== "function") {
    throw new Error("Desktop event API is unavailable.");
  }

  const unlisten = await listen(event, (rawEvent: unknown) => {
    handler(rawEvent as TPayload);
  });

  return typeof unlisten === "function" ? unlisten : () => {};
}
