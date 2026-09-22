import { describe, expect, it } from "vitest";

import { parseDuration } from "./duration";

describe("parseDuration", () => {
  it("treats a plain number as seconds", () => {
    expect(parseDuration("90")).toBe(90_000);
    expect(parseDuration("0")).toBe(0);
  });

  it("parses single units", () => {
    expect(parseDuration("5m")).toBe(5 * 60 * 1000);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1h")).toBe(60 * 60 * 1000);
  });

  it("parses compound durations", () => {
    expect(parseDuration("2h30m")).toBe(2 * 60 * 60 * 1000 + 30 * 60 * 1000);
    expect(parseDuration("1m5s")).toBe(60_000 + 5_000);
  });

  it("parses fractional units correctly instead of silently matching the integer part", () => {
    // Regression: "1.5h" used to match "5h" (unanchored regex) = 5 hours.
    expect(parseDuration("1.5h")).toBe(1.5 * 60 * 60 * 1000);
    expect(parseDuration("2.5m")).toBe(2.5 * 60 * 1000);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseDuration("  5m  ")).toBe(5 * 60 * 1000);
  });

  it("rejects trailing garbage instead of silently dropping it", () => {
    // Regression: "5m30" used to parse as 5 minutes and silently drop "30".
    expect(() => parseDuration("5m30")).toThrow(/Invalid duration format/);
    expect(() => parseDuration("10x")).toThrow(/Invalid duration format/);
    expect(() => parseDuration("m")).toThrow(/Invalid duration format/);
    expect(() => parseDuration("")).toThrow(/Invalid duration format/);
  });
});
