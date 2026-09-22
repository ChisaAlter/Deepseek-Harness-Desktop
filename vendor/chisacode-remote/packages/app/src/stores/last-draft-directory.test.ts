import { describe, expect, it } from "vitest";
import {
  createLastDraftDirectoryStore,
  type LastDraftDirectoryStorage,
} from "./last-draft-directory";

class DelayedDraftDirectoryStorage implements LastDraftDirectoryStorage {
  private finishRead: (value: string | null) => void = () => {};
  private readonly pendingRead = new Promise<string | null>((resolve) => {
    this.finishRead = resolve;
  });
  private saved: string | null = null;

  read(): Promise<string | null> {
    return this.pendingRead;
  }

  async write(value: string): Promise<void> {
    this.saved = value;
  }

  finishHydrationWith(raw: string | null) {
    this.finishRead(raw);
  }

  getSaved(): string | null {
    return this.saved;
  }
}

describe("last draft directory", () => {
  it("hydrates the saved draft directory per server", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();

    storage.finishHydrationWith(
      JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/pi-desktop" } }),
    );
    await hydration;

    expect(store.getDirectory("server-a")).toBe("C:/Ai/pi-desktop");
    expect(store.getDirectory("server-b")).toBeNull();
    expect(store.isHydrated()).toBe(true);
  });

  it("remembers a new directory for a server and persists it", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith(null);
    await hydration;

    store.remember("server-a", "C:/Ai/pi-desktop");

    expect(store.getDirectory("server-a")).toBe("C:/Ai/pi-desktop");
    expect(storage.getSaved()).toBe(
      JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/pi-desktop" } }),
    );
  });

  it("keeps a newer directory when storage hydration finishes late", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();

    store.remember("server-a", "C:/Ai/new");
    storage.finishHydrationWith(JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/old" } }));
    await hydration;

    expect(store.getDirectory("server-a")).toBe("C:/Ai/new");
    expect(storage.getSaved()).toBe(
      JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/new" } }),
    );
  });

  it("ignores blank directories so an unselected draft does not wipe memory", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith(
      JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/pi-desktop" } }),
    );
    await hydration;

    store.remember("server-a", "   ");

    expect(store.getDirectory("server-a")).toBe("C:/Ai/pi-desktop");
  });

  it("forgets a single server without affecting others", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith(
      JSON.stringify({
        directoryByServer: { "server-a": "C:/Ai/a", "server-b": "C:/Ai/b" },
      }),
    );
    await hydration;

    store.forget("server-a");

    expect(store.getDirectory("server-a")).toBeNull();
    expect(store.getDirectory("server-b")).toBe("C:/Ai/b");
    expect(storage.getSaved()).toBe(
      JSON.stringify({ directoryByServer: { "server-b": "C:/Ai/b" } }),
    );
  });

  it("clears storage when the last server is forgotten", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith(JSON.stringify({ directoryByServer: { "server-a": "C:/Ai/a" } }));
    await hydration;

    store.forget("server-a");

    expect(store.getDirectory("server-a")).toBeNull();
    expect(storage.getSaved()).toBe("");
  });

  it("survives malformed stored payloads", async () => {
    const storage = new DelayedDraftDirectoryStorage();
    const store = createLastDraftDirectoryStore(storage);
    const hydration = store.hydrate();
    storage.finishHydrationWith("not-json");
    await hydration;

    expect(store.getDirectory("server-a")).toBeNull();
    expect(store.isHydrated()).toBe(true);
  });
});
