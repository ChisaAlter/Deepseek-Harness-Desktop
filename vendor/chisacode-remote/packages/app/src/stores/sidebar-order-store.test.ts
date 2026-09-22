import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarOrderStore } from "./sidebar-order-store";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

describe("sidebar order store project group state", () => {
  beforeEach(() => {
    storage.clear();
    useSidebarOrderStore.setState({
      projectOrderByServerId: {},
      workspaceOrderByServerAndProject: {},
      sessionGroupOrderByServerId: {},
      sessionOrderByServerAndGroup: {},
      pinnedSessionGroupKeysByServerId: {},
      hiddenSessionGroupKeysByServerId: {},
      sidebarViewMode: "by-project",
    });
  });

  it("pins and unpins project groups without duplicating keys", () => {
    const store = useSidebarOrderStore.getState();

    store.setSessionGroupPinned("server-1", "/repo/project", true);
    store.setSessionGroupPinned("server-1", "/repo/project", true);

    expect(useSidebarOrderStore.getState().getPinnedSessionGroupKeys("server-1")).toEqual([
      "/repo/project",
    ]);

    useSidebarOrderStore.getState().setSessionGroupPinned("server-1", "/repo/project", false);
    expect(useSidebarOrderStore.getState().getPinnedSessionGroupKeys("server-1")).toEqual([]);
  });

  it("persists project group removal independently for each host", () => {
    const store = useSidebarOrderStore.getState();

    store.setSessionGroupHidden("server-1", "/repo/project", true);
    store.setSessionGroupHidden("server-2", "/repo/other", true);

    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/project",
    ]);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-2")).toEqual([
      "/repo/other",
    ]);

    useSidebarOrderStore.getState().setSessionGroupHidden("server-1", "/repo/project", false);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([]);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-2")).toEqual([
      "/repo/other",
    ]);
  });

  it("setHiddenSessionGroupKeys replaces the full hidden list, dedupes, and is a no-op when unchanged", () => {
    const store = useSidebarOrderStore.getState();

    // Seed two hidden keys for server-1.
    store.setSessionGroupHidden("server-1", "/repo/a", true);
    store.setSessionGroupHidden("server-1", "/repo/b", true);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/a",
      "/repo/b",
    ]);

    // Reconcile: /repo/a now has agents again, so only /repo/b stays hidden.
    store.setHiddenSessionGroupKeys("server-1", ["/repo/b"]);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/b",
    ]);

    // Dedupes and trims; the reconcile effect passes the same list every render,
    // so the no-op guard must not produce a new state reference (verified by
    // asserting the stored array is unchanged, not a fresh duplicate).
    const before = useSidebarOrderStore.getState().hiddenSessionGroupKeysByServerId["server-1"];
    store.setHiddenSessionGroupKeys("server-1", ["/repo/b", "/repo/b", "  ", ""]);
    expect(useSidebarOrderStore.getState().hiddenSessionGroupKeysByServerId["server-1"]).toBe(
      before,
    );
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/b",
    ]);

    // Empty serverId is ignored.
    store.setHiddenSessionGroupKeys("  ", ["/repo/x"]);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("  ")).toEqual([]);
  });

  it("clearHiddenSessionGroupKeys removes every hidden key for a host but leaves others intact", () => {
    const store = useSidebarOrderStore.getState();

    store.setSessionGroupHidden("server-1", "/repo/a", true);
    store.setSessionGroupHidden("server-1", "/repo/b", true);
    store.setSessionGroupHidden("server-2", "/repo/other", true);

    useSidebarOrderStore.getState().clearHiddenSessionGroupKeys("server-1");

    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([]);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-2")).toEqual([
      "/repo/other",
    ]);

    // Clearing an already-empty list is a no-op (no new state reference).
    const before = useSidebarOrderStore.getState().hiddenSessionGroupKeysByServerId;
    useSidebarOrderStore.getState().clearHiddenSessionGroupKeys("server-1");
    expect(useSidebarOrderStore.getState().hiddenSessionGroupKeysByServerId).toBe(before);

    // Empty serverId is ignored.
    useSidebarOrderStore.getState().clearHiddenSessionGroupKeys("  ");
  });

  it("persists sidebar view mode and ignores invalid values", () => {
    const store = useSidebarOrderStore.getState();

    expect(useSidebarOrderStore.getState().sidebarViewMode).toBe("by-project");

    store.setSidebarViewMode("by-status");
    expect(useSidebarOrderStore.getState().sidebarViewMode).toBe("by-status");

    store.setSidebarViewMode("by-status");
    expect(useSidebarOrderStore.getState().sidebarViewMode).toBe("by-status");

    store.setSidebarViewMode("by-project");
    expect(useSidebarOrderStore.getState().sidebarViewMode).toBe("by-project");

    // Invalid mode is ignored at runtime even if TypeScript is bypassed.
    store.setSidebarViewMode("unknown" as "by-project");
    expect(useSidebarOrderStore.getState().sidebarViewMode).toBe("by-project");
  });

  it("reconcile pattern un-hides a group once it contains agents again (regression: permanently blank sidebar)", () => {
    // Reproduces the root cause: "Remove project" added /repo/a to the hidden
    // blacklist; when a new conversation lands back in /repo/a, the sidebar
    // stayed blank because the blacklist was only ever appended to. The
    // reconcile in SidebarSessionList prunes any hidden key whose group now
    // has agents, so the sidebar self-heals.
    const store = useSidebarOrderStore.getState();
    store.setSessionGroupHidden("server-1", "/repo/a", true);
    store.setSessionGroupHidden("server-1", "/repo/b", true);
    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/a",
      "/repo/b",
    ]);

    // Simulate the reconcile effect: currentGroupKeys = ["/repo/a"] (has agents),
    // so /repo/a must be dropped from the hidden list.
    const currentGroupKeys = new Set(["/repo/a"]);
    const storedHidden = useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1");
    const nextHidden = storedHidden.filter((key) => !currentGroupKeys.has(key));
    store.setHiddenSessionGroupKeys("server-1", nextHidden);

    expect(useSidebarOrderStore.getState().getHiddenSessionGroupKeys("server-1")).toEqual([
      "/repo/b",
    ]);
  });
});
