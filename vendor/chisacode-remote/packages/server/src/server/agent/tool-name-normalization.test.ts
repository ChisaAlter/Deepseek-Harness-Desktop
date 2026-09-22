import { describe, expect, it } from "vitest";

import {
  getChisaCodeToolLeafName,
  isChisaCodeToolName,
} from "@chisacode/protocol/tool-name-normalization";

describe("isChisaCodeToolName", () => {
  it("detects Claude Code format", () => {
    expect(isChisaCodeToolName("mcp__chisacode__create_agent")).toBe(true);
    expect(isChisaCodeToolName("mcp__chisacode__list_agents")).toBe(true);
  });

  it("detects chisacode_voice variant", () => {
    expect(isChisaCodeToolName("mcp__chisacode_voice__create_agent")).toBe(true);
    expect(isChisaCodeToolName("chisacode_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isChisaCodeToolName("mcp__chisacode_voice__speak")).toBe(false);
    expect(isChisaCodeToolName("mcp__chisacode__speak")).toBe(false);
    expect(isChisaCodeToolName("chisacode.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isChisaCodeToolName("chisacode.create_agent")).toBe(true);
  });

  it("rejects non-chisacode tools", () => {
    expect(isChisaCodeToolName("Bash")).toBe(false);
    expect(isChisaCodeToolName("Read")).toBe(false);
    expect(isChisaCodeToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getChisaCodeToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getChisaCodeToolLeafName("mcp__chisacode__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getChisaCodeToolLeafName("chisacode.create_agent")).toBe("create_agent");
    expect(getChisaCodeToolLeafName("chisacode.list_agents")).toBe("list_agents");
  });

  it("returns null for non-chisacode tools", () => {
    expect(getChisaCodeToolLeafName("Bash")).toBeNull();
  });
});
