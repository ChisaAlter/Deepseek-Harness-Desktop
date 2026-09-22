import { describe, expect, it } from "vitest";

import { formatClaudeUserFacingErrorText } from "./user-facing-error-text.js";

describe("formatClaudeUserFacingErrorText", () => {
  it("rewrites account protection scheduler 503 into actionable Chinese copy", () => {
    const raw =
      "API Error: 503 account protection scheduler is temporarily unavailable. This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (127.0.0.1:6767).";

    const formatted = formatClaudeUserFacingErrorText(raw);

    expect(formatted).toContain("模型暂时不可用（HTTP 503）");
    expect(formatted).toContain("账号保护调度器临时故障");
    expect(formatted).not.toContain("选错了模型");
    expect(formatted).toContain("127.0.0.1:6767");
    expect(formatted).not.toContain("API Error:");
  });

  it("rewrites invalid credentials errors", () => {
    const raw =
      'API Error: 401 {"error":"Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=xai-grok-cli, upstream=PermissionDenied, reason=no auth context)"}';

    const formatted = formatClaudeUserFacingErrorText(raw);

    expect(formatted).toContain("模型鉴权失败（HTTP 401）");
    expect(formatted).toContain("API Key");
  });

  it("rewrites generic API Error lines while preserving detail", () => {
    const raw = "API Error: 502 bad gateway from upstream";
    const formatted = formatClaudeUserFacingErrorText(raw);

    expect(formatted).toContain("模型请求失败（HTTP 502）");
    expect(formatted).toContain("bad gateway from upstream");
  });

  it("leaves ordinary assistant text unchanged", () => {
    expect(formatClaudeUserFacingErrorText("你好，我可以帮你看这个项目。")).toBe(
      "你好，我可以帮你看这个项目。",
    );
  });
});
