import { getDesktopHost } from "@/desktop/host";

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const invoke = getDesktopHost()?.invoke;
  if (typeof invoke !== "function") {
    throw new Error("Desktop invoke() is unavailable in this environment.");
  }
  return (await invoke(command, args)) as T;
}
