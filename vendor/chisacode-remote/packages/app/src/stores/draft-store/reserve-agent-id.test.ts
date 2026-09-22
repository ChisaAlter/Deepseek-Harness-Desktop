import { describe, expect, it } from "vitest";
import { resolveReservedDraftAgentId } from "./state";

describe("resolveReservedDraftAgentId", () => {
  it("mints a new id when none is reserved yet", () => {
    let mintCalls = 0;
    const result = resolveReservedDraftAgentId(undefined, () => {
      mintCalls += 1;
      return "uuid-1";
    });

    expect(result).toEqual({ agentId: "uuid-1", minted: true });
    expect(mintCalls).toBe(1);
  });

  it("keeps the existing id stable across retries", () => {
    const mint = () => "should-not-be-called";
    const first = resolveReservedDraftAgentId("draft-agent-42", mint);
    const second = resolveReservedDraftAgentId("draft-agent-42", mint);

    expect(first).toEqual({ agentId: "draft-agent-42", minted: false });
    expect(second.agentId).toBe("draft-agent-42");
  });

  it("mints a fresh id for a different draft", () => {
    const first = resolveReservedDraftAgentId(undefined, () => "agent-a");
    const second = resolveReservedDraftAgentId(undefined, () => "agent-b");

    expect(first.agentId).toBe("agent-a");
    expect(second.agentId).toBe("agent-b");
  });
});
