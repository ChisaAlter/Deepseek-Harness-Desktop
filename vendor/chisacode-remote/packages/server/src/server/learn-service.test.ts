import { describe, expect, test } from "vitest";

import {
  canTransition,
  createLearnRun,
  DEFAULT_LEARN_CONFIG,
  isBusyStatus,
  isExpired,
  sweepExpiredRuns,
  transitionRun,
  validateProposals,
  type LearnProposal,
} from "./learn-service.js";

const NOW = 1000000;

describe("canTransition", () => {
  test("allows valid forward transitions", () => {
    expect(canTransition("collecting", "distilling")).toBe(true);
    expect(canTransition("distilling", "staging")).toBe(true);
    expect(canTransition("staging", "awaiting-review")).toBe(true);
    expect(canTransition("awaiting-review", "applied")).toBe(true);
    expect(canTransition("awaiting-review", "discarded")).toBe(true);
  });

  test("allows cancel from collecting/distilling", () => {
    expect(canTransition("collecting", "cancelled")).toBe(true);
    expect(canTransition("distilling", "cancelled")).toBe(true);
  });

  test("allows fail from any active stage", () => {
    expect(canTransition("collecting", "failed")).toBe(true);
    expect(canTransition("distilling", "failed")).toBe(true);
    expect(canTransition("staging", "failed")).toBe(true);
    expect(canTransition("awaiting-review", "failed")).toBe(true);
  });

  test("rejects invalid transitions", () => {
    expect(canTransition("collecting", "applied")).toBe(false);
    expect(canTransition("applied", "collecting")).toBe(false);
    expect(canTransition("failed", "distilling")).toBe(false);
    expect(canTransition("discarded", "awaiting-review")).toBe(false);
  });
});

describe("isBusyStatus", () => {
  test("collecting/distilling/staging are busy", () => {
    expect(isBusyStatus("collecting")).toBe(true);
    expect(isBusyStatus("distilling")).toBe(true);
    expect(isBusyStatus("staging")).toBe(true);
  });

  test("awaiting-review and terminals are not busy", () => {
    expect(isBusyStatus("awaiting-review")).toBe(false);
    expect(isBusyStatus("applied")).toBe(false);
    expect(isBusyStatus("failed")).toBe(false);
  });
});

describe("createLearnRun", () => {
  test("creates run in collecting state", () => {
    const run = createLearnRun("run-1", NOW);
    expect(run.id).toBe("run-1");
    expect(run.status).toBe("collecting");
    expect(run.proposals).toEqual([]);
    expect(run.createdAt).toBe(NOW);
  });
});

describe("transitionRun", () => {
  test("transitions with patch", () => {
    const run = createLearnRun("r1", NOW);
    const updated = transitionRun(run, "distilling", NOW + 100, {
      evidence: { diff: "diff", files: ["a.ts"] },
    });
    expect(updated.status).toBe("distilling");
    expect(updated.evidence?.files).toEqual(["a.ts"]);
    expect(updated.updatedAt).toBe(NOW + 100);
  });

  test("throws on invalid transition", () => {
    const run = createLearnRun("r1", NOW);
    expect(() => transitionRun(run, "applied", NOW)).toThrow("Invalid");
  });
});

describe("validateProposals", () => {
  const validProposal: LearnProposal = {
    filename: "skills/auth-pattern.md",
    content: "# Auth Pattern\n\nAlways validate tokens.",
    fingerprint: "abc123",
  };

  test("accepts valid proposals", () => {
    const { valid, errors } = validateProposals([validProposal]);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test("rejects oversized proposals", () => {
    const big: LearnProposal = {
      ...validProposal,
      content: "x".repeat(DEFAULT_LEARN_CONFIG.maxProposalTotalBytes + 1),
    };
    const { valid, errors } = validateProposals([big]);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("exceeds limit");
  });

  test("rejects excluded paths", () => {
    const excluded: LearnProposal = {
      ...validProposal,
      filename: "node_modules/pkg/skill.md",
    };
    const { valid, errors } = validateProposals([excluded]);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("excluded path");
  });

  test("rejects empty content", () => {
    const empty: LearnProposal = { ...validProposal, content: "" };
    const { valid } = validateProposals([empty]);
    expect(valid).toBe(false);
  });

  test("rejects duplicate fingerprints", () => {
    const dup: LearnProposal = { ...validProposal, filename: "other.md" };
    const { valid, errors } = validateProposals([validProposal, dup]);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("Duplicate");
  });
});

describe("isExpired / sweepExpiredRuns", () => {
  test("expires awaiting-review runs past expiresAt", () => {
    const run = {
      ...createLearnRun("r1", NOW),
      status: "awaiting-review" as const,
      expiresAt: NOW + 100,
    };
    expect(isExpired(run, NOW + 200)).toBe(true);
    expect(isExpired(run, NOW + 50)).toBe(false);
  });

  test("sweep marks expired runs as discarded", () => {
    const runs = [
      { ...createLearnRun("r1", NOW), status: "awaiting-review" as const, expiresAt: NOW + 100 },
      { ...createLearnRun("r2", NOW), status: "awaiting-review" as const, expiresAt: NOW + 9999 },
    ];
    const swept = sweepExpiredRuns(runs, NOW + 200);
    expect(swept[0].status).toBe("discarded");
    expect(swept[1].status).toBe("awaiting-review");
  });
});
