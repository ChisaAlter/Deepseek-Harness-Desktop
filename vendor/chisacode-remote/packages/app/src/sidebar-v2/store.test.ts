import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_LABEL_SETTLED_AT,
  SIDEBAR_LABEL_SETTLED_OVERRIDE,
  SIDEBAR_LABEL_SNOOZED_AT,
  SIDEBAR_LABEL_SNOOZED_UNTIL,
} from "./snooze";
import { DEFAULT_SERVER_UI_STATE, sidebarV2ThreadKey, useSidebarV2Store } from "./store";

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
    clear: vi.fn(async () => {
      storage.clear();
    }),
  },
}));

describe("useSidebarV2Store", () => {
  beforeEach(() => {
    storage.clear();
    useSidebarV2Store.setState({
      serverUiStateByServerId: {},
      searchQuery: "",
      selectedThreadKeys: [],
      localUnreadCompletedAtByKey: {},
    });
  });

  it("returns default per-server UI state until mutated", () => {
    expect(useSidebarV2Store.getState().getServerUiState("server-a")).toEqual(
      DEFAULT_SERVER_UI_STATE,
    );

    useSidebarV2Store.getState().setSettledShelfExpanded("server-a", false);
    useSidebarV2Store.getState().setSnoozedShelfExpanded("server-a", true);
    useSidebarV2Store.getState().setSettledVisibleCount("server-a", 35);
    useSidebarV2Store.getState().setScopeProjectKey("server-a", "proj-1");

    expect(useSidebarV2Store.getState().getServerUiState("server-a")).toEqual({
      scopeProjectKey: "proj-1",
      settledShelfExpanded: false,
      snoozedShelfExpanded: true,
      settledVisibleCount: 35,
    });

    useSidebarV2Store.getState().resetSettledVisibleCount("server-a");
    expect(useSidebarV2Store.getState().getServerUiState("server-a").settledVisibleCount).toBe(
      DEFAULT_SERVER_UI_STATE.settledVisibleCount,
    );
  });

  it("tracks search query and clears multi-selection when the query changes", () => {
    useSidebarV2Store.setState({
      selectedThreadKeys: ["server-a:a1", "server-a:a2"],
      searchQuery: "",
    });

    useSidebarV2Store.getState().setSearchQuery("gateway");
    expect(useSidebarV2Store.getState().searchQuery).toBe("gateway");
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual([]);

    useSidebarV2Store.getState().setThreadsSelected(["server-a:a1"]);
    useSidebarV2Store.getState().clearSearch();
    expect(useSidebarV2Store.getState().searchQuery).toBe("");
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual(["server-a:a1"]);
  });

  it("supports toggle, bulk, and range multi-selection", () => {
    const ordered = ["server-a:a1", "server-a:a2", "server-a:a3", "server-a:a4"];

    useSidebarV2Store.getState().toggleThreadSelected("server-a:a2");
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual(["server-a:a2"]);

    useSidebarV2Store.getState().toggleThreadSelected("server-a:a2");
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual([]);

    useSidebarV2Store.getState().setThreadsSelected(["server-a:a1", "server-a:a3"]);
    useSidebarV2Store.getState().rangeSelectThreads("server-a:a4", ordered);
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual(["server-a:a3", "server-a:a4"]);

    useSidebarV2Store.getState().clearSelection();
    expect(useSidebarV2Store.getState().selectedThreadKeys).toEqual([]);
  });

  it("tracks local unread stamps and builds settle/snooze label maps", () => {
    const key = sidebarV2ThreadKey("server-a", "a1");
    useSidebarV2Store.getState().markThreadUnread(key, "2026-08-10T12:00:00.000Z");
    expect(useSidebarV2Store.getState().localUnreadCompletedAtByKey[key]).toBe(
      "2026-08-10T12:00:00.000Z",
    );

    useSidebarV2Store.getState().clearThreadUnread(key);
    expect(useSidebarV2Store.getState().localUnreadCompletedAtByKey[key]).toBeUndefined();

    expect(
      useSidebarV2Store.getState().buildSettledLabels("2026-08-10T12:00:00.000Z", true),
    ).toEqual({
      [SIDEBAR_LABEL_SETTLED_AT]: "2026-08-10T12:00:00.000Z",
      [SIDEBAR_LABEL_SETTLED_OVERRIDE]: "settled",
    });
    expect(
      useSidebarV2Store.getState().buildSettledLabels("2026-08-10T12:00:00.000Z", false),
    ).toEqual({
      [SIDEBAR_LABEL_SETTLED_AT]: "",
      [SIDEBAR_LABEL_SETTLED_OVERRIDE]: "",
    });
    expect(
      useSidebarV2Store
        .getState()
        .buildSnoozedLabels("2026-08-10T13:00:00.000Z", "2026-08-10T12:00:00.000Z"),
    ).toEqual({
      [SIDEBAR_LABEL_SNOOZED_UNTIL]: "2026-08-10T13:00:00.000Z",
      [SIDEBAR_LABEL_SNOOZED_AT]: "2026-08-10T12:00:00.000Z",
    });
    expect(useSidebarV2Store.getState().clearSnoozedLabels()).toEqual({
      [SIDEBAR_LABEL_SNOOZED_UNTIL]: "",
      [SIDEBAR_LABEL_SNOOZED_AT]: "",
    });
  });
});
