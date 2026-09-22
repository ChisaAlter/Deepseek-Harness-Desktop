import { describe, expect, it } from "vitest";
import {
  collectSidebarDraftSessions,
  resolveLeftSidebarHomeRoute,
  resolveLeftSidebarNewConversationRoute,
} from "./left-sidebar-drafts";

describe("left sidebar drafts", () => {
  it("does not collect unsent workspace draft content for the sidebar session list", () => {
    expect(collectSidebarDraftSessions()).toEqual([]);
  });

  it("opens Soft Home (/new) when the current route is a workspace", () => {
    expect(
      resolveLeftSidebarNewConversationRoute({
        activeServerId: "server-1",
        pathname: "/h/server-1/workspace/workspace-a",
      }),
    ).toBe("/h/server-1/new");
  });

  it("opens Soft Home (/new) outside a workspace route", () => {
    expect(
      resolveLeftSidebarNewConversationRoute({
        activeServerId: "server-1",
        pathname: "/h/server-1/sessions",
      }),
    ).toBe("/h/server-1/new");
  });

  it("seeds the new draft with the last draft directory when no explicit source is given", () => {
    expect(
      resolveLeftSidebarNewConversationRoute({
        activeServerId: "server-1",
        pathname: "/h/server-1/sessions",
        lastDraftDirectory: "/repo/last-draft",
      }),
    ).toBe("/h/server-1/new?dir=%2Frepo%2Flast-draft");
  });

  it("prefers an explicit source directory over the last draft directory", () => {
    expect(
      resolveLeftSidebarNewConversationRoute({
        activeServerId: "server-1",
        pathname: "/h/server-1/sessions",
        sourceDirectory: "/repo/explicit",
        lastDraftDirectory: "/repo/last-draft",
      }),
    ).toBe("/h/server-1/new?dir=%2Frepo%2Fexplicit");
  });

  it("resolves the sidebar home action to Soft Home (/new)", () => {
    expect(resolveLeftSidebarHomeRoute("server-1")).toBe("/h/server-1/new");
  });

  it("does not resolve a sidebar home action without an active host", () => {
    expect(resolveLeftSidebarHomeRoute(null)).toBeNull();
  });
});
