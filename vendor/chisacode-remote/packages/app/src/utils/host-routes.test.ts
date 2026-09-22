import { describe, expect, it } from "vitest";
import {
  buildHostAgentDetailRoute,
  buildHostNewWorkspaceRoute,
  buildHostRootRoute,
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
  decodeFilePathFromPathSegment,
  decodeWorkspaceIdFromPathSegment,
  encodeFilePathForPathSegment,
  encodeWorkspaceIdForPathSegment,
  isWorkspaceScreenOpenIntent,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostWorkspaceRouteFromPathname,
  parseSettingsHostRouteFromPathname,
  parseWorkspaceOpenIntent,
  mapPathnameToServer,
  normalizeSettingsReturnToRoute,
  SETTINGS_SECTION_SLUGS,
} from "./host-routes";

describe("parseHostAgentRouteFromPathname", () => {
  it("continues parsing detail routes", () => {
    expect(parseHostAgentRouteFromPathname("/h/local/agent/abc123")).toEqual({
      serverId: "local",
      agentId: "abc123",
    });
  });
});

describe("settings host routes", () => {
  it("parses a settings host route", () => {
    expect(parseSettingsHostRouteFromPathname("/settings/hosts/srv%20one")).toBe("srv one");
  });

  it("builds a settings host route", () => {
    expect(buildSettingsHostRoute("srv one")).toBe("/settings/hosts/srv%20one");
  });

  it("includes the skills and MCP settings sections", () => {
    expect(SETTINGS_SECTION_SLUGS).toContain("skills");
    expect(buildSettingsSectionRoute("skills")).toBe("/settings/skills");
    expect(SETTINGS_SECTION_SLUGS).toContain("mcp");
    expect(buildSettingsSectionRoute("mcp")).toBe("/settings/mcp");
  });

  it("preserves an internal return route on settings links", () => {
    expect(buildSettingsRoute({ returnTo: "/h/srv/agent/agent-1" })).toBe(
      "/settings?returnTo=%2Fh%2Fsrv%2Fagent%2Fagent-1",
    );
    expect(buildSettingsSectionRoute("general", { returnTo: "/h/srv/workspace/ws-1" })).toBe(
      "/settings/general?returnTo=%2Fh%2Fsrv%2Fworkspace%2Fws-1",
    );
  });

  it("rejects unsafe or looping settings return routes", () => {
    expect(normalizeSettingsReturnToRoute("https://example.com")).toBeNull();
    expect(normalizeSettingsReturnToRoute("//example.com/path")).toBeNull();
    expect(normalizeSettingsReturnToRoute("/settings/general")).toBeNull();
    expect(normalizeSettingsReturnToRoute("/h/srv/agent/agent-1")).toBe("/h/srv/agent/agent-1");
  });

  it("maps a stale settings host route to another host settings route", () => {
    expect(mapPathnameToServer("/settings/hosts/server-1", "server-2")).toBe(
      "/settings/hosts/server-2",
    );
  });
});

describe("workspace route parsing", () => {
  it("keeps URL-safe workspace IDs unencoded", () => {
    expect(encodeWorkspaceIdForPathSegment("164")).toBe("164");
    expect(decodeWorkspaceIdFromPathSegment("164")).toBe("164");
  });

  it("encodes non-URL-safe workspace IDs as base64url", () => {
    expect(encodeWorkspaceIdForPathSegment("/tmp/repo")).toBe("b64_L3RtcC9yZXBv");
    expect(decodeWorkspaceIdFromPathSegment("L3RtcC9yZXBv")).toBe("/tmp/repo");
  });

  it("decodes non-canonical base64url workspace IDs used by older links", () => {
    expect(decodeWorkspaceIdFromPathSegment("L1VzZXJzL21vYm91ZHJhL2Rldi9wYXNlby")).toBe(
      "/Users/moboudra/dev/paseo",
    );
  });

  it("encodes file paths as base64url (no padding)", () => {
    const encoded = encodeFilePathForPathSegment("src/index.ts");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFilePathFromPathSegment(encoded)).toBe("src/index.ts");
  });

  it("parses workspace route with a plain workspace id", () => {
    expect(parseHostWorkspaceRouteFromPathname("/h/local/workspace/164")).toEqual({
      serverId: "local",
      workspaceId: "164",
    });
  });

  it("parses workspace route with legacy base64 path", () => {
    expect(parseHostWorkspaceRouteFromPathname("/h/local/workspace/L3RtcC9yZXBv")).toEqual({
      serverId: "local",
      workspaceId: "/tmp/repo",
    });
  });

  it("does not treat /tab routes as valid workspace routes", () => {
    expect(
      parseHostWorkspaceRouteFromPathname("/h/local/workspace/L3RtcC9yZXBv/tab/draft_abc123"),
    ).toBeNull();
  });

  it("builds plain workspace routes for URL-safe ids", () => {
    expect(buildHostWorkspaceRoute("local", "164")).toBe("/h/local/workspace/164");
  });

  it("builds base64url workspace routes for legacy paths", () => {
    expect(buildHostWorkspaceRoute("local", "/tmp/repo")).toBe(
      "/h/local/workspace/b64_L3RtcC9yZXBv",
    );
  });

  it("builds host root routes", () => {
    expect(buildHostRootRoute("local")).toBe("/h/local");
  });

  it("parses workspace open intent from pathname query", () => {
    expect(
      parseHostWorkspaceOpenIntentFromPathname("/h/local/workspace/164?open=agent%3Aagent-1"),
    ).toEqual({
      kind: "agent",
      agentId: "agent-1",
    });
    expect(parseWorkspaceOpenIntent("Agent:Agent-Case")).toEqual({
      kind: "agent",
      agentId: "Agent-Case",
    });
    expect(parseWorkspaceOpenIntent("terminal:term-1")).toEqual({
      kind: "terminal",
      terminalId: "term-1",
    });
    expect(parseWorkspaceOpenIntent("terminal:new")).toEqual({
      kind: "terminal-new",
    });
    expect(parseWorkspaceOpenIntent("terminal:NEW")).toEqual({
      kind: "terminal-new",
    });
    expect(parseWorkspaceOpenIntent(" terminal ")).toEqual({
      kind: "terminal-new",
    });
    expect(parseWorkspaceOpenIntent("changes:review")).toEqual({
      kind: "changes",
    });
    expect(parseWorkspaceOpenIntent("Changes:Review")).toEqual({
      kind: "changes",
    });
    expect(parseWorkspaceOpenIntent(" changes ")).toEqual({
      kind: "changes",
    });
    expect(parseWorkspaceOpenIntent("changes:unknown")).toBeNull();
    expect(parseWorkspaceOpenIntent("draft:new")).toEqual({
      kind: "draft",
      draftId: "new",
    });
    expect(parseWorkspaceOpenIntent("file:c3JjL2luZGV4LnRz")).toEqual({
      kind: "file",
      path: "src/index.ts",
    });
    expect(parseWorkspaceOpenIntent("setup:L3RtcC9yZXBv")).toEqual({
      kind: "setup",
      workspaceId: "/tmp/repo",
    });
  });

  it("classifies workspace screen-level open intents", () => {
    expect(isWorkspaceScreenOpenIntent({ kind: "changes" })).toBe(true);
    expect(isWorkspaceScreenOpenIntent({ kind: "terminal-new" })).toBe(true);
    expect(isWorkspaceScreenOpenIntent({ kind: "agent", agentId: "agent-1" })).toBe(false);
    expect(isWorkspaceScreenOpenIntent({ kind: "draft", draftId: "new" })).toBe(false);
  });

  it("uses the plain workspace route when workspace context is provided", () => {
    expect(buildHostAgentDetailRoute("local", "agent-1", "164")).toBe(
      "/h/local/workspace/164?open=agent%3Aagent-1",
    );
  });

  it("builds workspace routes with a one-shot open intent", () => {
    expect(buildHostWorkspaceOpenRoute("local", "164", "draft:new")).toBe(
      "/h/local/workspace/164?open=draft%3Anew",
    );
  });

  it("trims optional new-workspace query params", () => {
    expect(
      buildHostNewWorkspaceRoute("local", "/repo", {
        displayName: "  Repo  ",
        projectId: "   ",
      }),
    ).toBe("/h/local/new?dir=%2Frepo&name=Repo");
  });

  it("builds the singleton new-conversation route without a source directory", () => {
    expect(buildHostNewWorkspaceRoute("local", "   ")).toBe("/h/local/new");
  });

  it("trims the new-workspace source directory", () => {
    expect(buildHostNewWorkspaceRoute("local", "  /repo  ")).toBe("/h/local/new?dir=%2Frepo");
  });

  it("round-trips URL-safe IDs through encode/decode", () => {
    const ids = ["1", "40", "164", "9999", "workspace-1", "opaque_id.v2~test"];
    for (const id of ids) {
      const encoded = encodeWorkspaceIdForPathSegment(id);
      const decoded = decodeWorkspaceIdFromPathSegment(encoded);
      expect(decoded).toBe(id);
    }
  });

  it("round-trips opaque IDs with reserved characters through base64 encoding", () => {
    const id = "  team/setup:id#1  ";
    const encoded = encodeWorkspaceIdForPathSegment(id);
    expect(encoded).toBe("b64_dGVhbS9zZXR1cDppZCMx");
    expect(decodeWorkspaceIdFromPathSegment(encoded)).toBe("team/setup:id#1");
  });
});

describe("projects settings routes", () => {
  it("buildProjectsSettingsRoute returns /settings/projects", () => {
    expect(buildProjectsSettingsRoute()).toBe("/settings/projects");
  });

  it("buildProjectSettingsRoute encodes a remote project key as a single segment", () => {
    expect(buildProjectSettingsRoute("remote:github.com/acme/app")).toBe(
      "/settings/projects/remote%3Agithub.com%2Facme%2Fapp",
    );
  });

  it("buildProjectSettingsRoute encodes a local repo-root key", () => {
    expect(buildProjectSettingsRoute("/Users/me/dev/chisacode")).toBe(
      "/settings/projects/%2FUsers%2Fme%2Fdev%2Fchisacode",
    );
  });

  it("project keys round-trip through decodeURIComponent", () => {
    const projectKey = "remote:github.com/acme/app";
    const route = buildProjectSettingsRoute(projectKey);
    const segment = route.slice("/settings/projects/".length);
    expect(decodeURIComponent(segment)).toBe(projectKey);
  });
});
