import { describe, expect, it } from "vitest";
import {
  deriveDateGroup,
  deriveProjectDisplayName,
  deriveProjectName,
  deriveRemoteProjectKey,
  groupAgents,
  parseRepoNameFromRemoteUrl,
  parseRepoShortNameFromRemoteUrl,
} from "./agent-grouping";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

function makeAgent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  const now = new Date();
  return {
    id: overrides.id ?? "a1",
    serverId: overrides.serverId ?? "s1",
    serverLabel: (overrides as { serverLabel?: string }).serverLabel ?? "server",
    title: overrides.title ?? null,
    status: overrides.status ?? ("running" as AggregatedAgent["status"]),
    lastActivityAt: overrides.lastActivityAt ?? now,
    cwd: overrides.cwd ?? "/tmp/repo",
    provider: overrides.provider ?? ("openai" as AggregatedAgent["provider"]),
    requiresAttention: overrides.requiresAttention ?? false,
    attentionReason: overrides.attentionReason ?? null,
    attentionTimestamp: overrides.attentionTimestamp ?? null,
  } as AggregatedAgent;
}

describe("deriveRemoteProjectKey", () => {
  it("normalizes GitHub SSH and HTTPS to the same key", () => {
    const ssh = "git@github.com:owner/repo.git";
    const https = "https://github.com/owner/repo";
    expect(deriveRemoteProjectKey(ssh)).toBe("remote:github.com/owner/repo");
    expect(deriveRemoteProjectKey(https)).toBe("remote:github.com/owner/repo");
  });

  it("includes host for non-GitHub remotes", () => {
    const gitlab = "git@gitlab.example.com:group/repo.git";
    expect(deriveRemoteProjectKey(gitlab)).toBe("remote:gitlab.example.com/group/repo");
  });

  it("normalizes GitHub path casing for stable grouping", () => {
    expect(deriveRemoteProjectKey("https://github.com/Owner/Repo.git")).toBe(
      "remote:github.com/owner/repo",
    );
  });

  it("ignores query and hash suffixes when deriving remote keys", () => {
    expect(deriveRemoteProjectKey("git@gitlab.example.com:group/repo.git?ref=main#readme")).toBe(
      "remote:gitlab.example.com/group/repo",
    );
  });
});

describe("deriveProjectName", () => {
  it("drops the owner prefix from GitHub remote keys (by-project group titles)", () => {
    expect(deriveProjectName("remote:github.com/ayasealter/ChisaTerminal")).toBe("ChisaTerminal");
    expect(deriveProjectName("remote:github.com/getchisacode/chisacode")).toBe("chisacode");
    expect(deriveProjectName("/Users/me/dev/chisacode")).toBe("chisacode");
  });
});

describe("deriveProjectDisplayName", () => {
  it("shows the repo basename (not owner/repo) for GitHub remote keys", () => {
    expect(
      deriveProjectDisplayName({
        projectKey: "remote:github.com/getchisacode/chisacode",
        projectName: "chisacode",
      }),
    ).toBe("chisacode");
    // Nested owner paths also collapse to the repo basename.
    expect(
      deriveProjectDisplayName({
        projectKey: "remote:github.com/ayasealter/ChisaTerminal",
        projectName: "ChisaTerminal",
      }),
    ).toBe("ChisaTerminal");
  });

  it("shows remote path for non-GitHub remote keys", () => {
    expect(
      deriveProjectDisplayName({
        projectKey: "remote:gitlab.example.com/group/repo",
        projectName: "repo",
      }),
    ).toBe("group/repo");
  });

  it("falls back to projectName for local keys", () => {
    expect(
      deriveProjectDisplayName({
        projectKey: "/Users/me/dev/chisacode",
        projectName: "chisacode",
      }),
    ).toBe("chisacode");
  });
});

describe("repo name parsing", () => {
  it("strips query, hash, and .git suffix from repo display names", () => {
    expect(parseRepoNameFromRemoteUrl("https://github.com/Owner/Repo.git?ref=main#readme")).toBe(
      "Owner/Repo",
    );
    expect(parseRepoNameFromRemoteUrl("git@github.com:Owner/Repo.git?ref=main#readme")).toBe(
      "Owner/Repo",
    );
  });

  it("derives short repo names from cleaned remote URLs", () => {
    expect(parseRepoShortNameFromRemoteUrl("https://github.com/Owner/Repo.git/")).toBe("Repo");
  });
});

describe("deriveDateGroup", () => {
  it("places invalid activity dates in the oldest bucket", () => {
    expect(deriveDateGroup(new Date(Number.NaN))).toBe("更早");
  });
});

describe("groupAgents", () => {
  it("groups active agents by remote URL when available", () => {
    const agents = [
      makeAgent({ id: "a1", cwd: "/Users/me/dev/chisacode" }),
      makeAgent({ id: "a2", cwd: "/Users/me/dev/chisacode-fix/worktree" }),
    ];

    const { activeGroups } = groupAgents(agents, {
      getRemoteUrl: () => "git@github.com:getchisacode/chisacode.git",
    });

    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0]?.agents.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("falls back to cwd grouping when remote URL is unavailable", () => {
    const agents = [
      makeAgent({ id: "a1", cwd: "/Users/me/dev/chisacode" }),
      makeAgent({ id: "a2", cwd: "/Users/me/dev/chisacode-fix/worktree" }),
    ];

    const { activeGroups } = groupAgents(agents, {
      getRemoteUrl: () => null,
    });

    expect(activeGroups).toHaveLength(2);
  });

  it("does not treat invalid activity timestamps as recently active", () => {
    const { activeGroups, inactiveGroups } = groupAgents([
      makeAgent({
        id: "invalid",
        status: "closed",
        lastActivityAt: new Date(Number.NaN),
      }),
      makeAgent({
        id: "old",
        status: "closed",
        lastActivityAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ]);

    expect(activeGroups).toHaveLength(0);
    expect(
      inactiveGroups.find((group) => group.label === "更早")?.agents.map((agent) => agent.id),
    ).toEqual(["old", "invalid"]);
  });
});
