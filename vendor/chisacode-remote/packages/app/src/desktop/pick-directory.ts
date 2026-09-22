import { getDesktopHost } from "@/desktop/host";

export async function pickDirectory(): Promise<string | null> {
  const open = getDesktopHost()?.dialog?.open;
  if (typeof open !== "function") {
    throw new Error("Desktop dialog open() is unavailable in this environment.");
  }

  const selection = await open({
    directory: true,
    multiple: false,
  });

  if (selection === null) {
    return null;
  }

  if (typeof selection === "string") {
    return selection;
  }

  throw new Error("Unexpected directory picker response.");
}
