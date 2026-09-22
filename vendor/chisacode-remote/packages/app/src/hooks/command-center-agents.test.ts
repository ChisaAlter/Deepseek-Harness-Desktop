import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  compareCommandCenterAgents,
  matchesCommandCenterAgent,
  resolveCommandCenterAgentTarget,
} from "./command-center-agents";

function agent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "local",
    serverLabel: "Local",
    title: "Polish workspace flow",
    status: "idle",
    lastActivityAt: new Date(0),
    cwd: "/repo/chisacode",
    provider: "codex",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    createdAt: new Date(0),
    labels: {},
    ...overrides,
  };
}

describe("matchesCommandCenterAgent", () => {
  it("matches title, cwd, and id with normalized queries", () => {
    expect(matchesCommandCenterAgent(agent(), " workspace ")).toBe(true);
    expect(matchesCommandCenterAgent(agent(), "CHISACODE")).toBe(true);
    expect(matchesCommandCenterAgent(agent(), "agent-1")).toBe(true);
  });

  it("splits punctuation while preserving unicode query tokens", () => {
    expect(matchesCommandCenterAgent(agent(), "agent-1")).toBe(true);
    expect(matchesCommandCenterAgent(agent({ title: "优化工作区体验" }), "工作区")).toBe(true);
    expect(matchesCommandCenterAgent(agent({ title: "优化工作区体验" }), "不存在")).toBe(false);
  });

  it("matches server context for multi-host command center results", () => {
    expect(
      matchesCommandCenterAgent(
        agent({
          serverId: "remote-prod",
          serverLabel: "Production host",
        }),
        "production",
      ),
    ).toBe(true);
    expect(
      matchesCommandCenterAgent(
        agent({
          serverId: "remote-prod",
          serverLabel: "",
        }),
        "remote-prod",
      ),
    ).toBe(true);
  });

  it("matches multi-word queries across searchable agent fields", () => {
    expect(matchesCommandCenterAgent(agent(), "chisacode polish")).toBe(true);
    expect(matchesCommandCenterAgent(agent(), "chisacode missing")).toBe(false);
  });

  it("matches provider and status for quick agent filtering", () => {
    expect(
      matchesCommandCenterAgent(agent({ provider: "codex", status: "running" }), "codex"),
    ).toBe(true);
    expect(
      matchesCommandCenterAgent(agent({ provider: "claude", status: "running" }), "running"),
    ).toBe(true);
  });

  it("matches multi-word queries across provider and workspace fields", () => {
    expect(matchesCommandCenterAgent(agent({ provider: "codex" }), "codex workspace")).toBe(true);
    expect(matchesCommandCenterAgent(agent({ provider: "claude" }), "codex workspace")).toBe(false);
  });

  it("does not require cwd when matching an agent title", () => {
    expect(matchesCommandCenterAgent(agent({ cwd: "" }), "polish")).toBe(true);
  });
});

describe("resolveCommandCenterAgentTarget", () => {
  it("trims agent navigation identifiers", () => {
    expect(
      resolveCommandCenterAgentTarget(agent({ serverId: " local ", id: " agent-1 " })),
    ).toEqual({
      serverId: "local",
      agentId: "agent-1",
    });
  });

  it("returns null for incomplete navigation identifiers", () => {
    expect(resolveCommandCenterAgentTarget(agent({ serverId: " ", id: "agent-1" }))).toBeNull();
    expect(resolveCommandCenterAgentTarget(agent({ serverId: "local", id: " " }))).toBeNull();
  });
});

describe("compareCommandCenterAgents", () => {
  it("keeps sorting stable when an agent has an invalid activity timestamp", () => {
    const valid = agent({ id: "valid", lastActivityAt: new Date(10) });
    const invalid = agent({ id: "invalid", lastActivityAt: new Date(Number.NaN) });

    expect(compareCommandCenterAgents(valid, invalid)).toBeLessThan(0);
    expect(Number.isNaN(compareCommandCenterAgents(valid, invalid))).toBe(false);
  });
});
