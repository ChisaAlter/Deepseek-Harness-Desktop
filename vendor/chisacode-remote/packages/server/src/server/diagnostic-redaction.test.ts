import { describe, expect, test } from "vitest";

import { redactDiagnosticArgv, redactDiagnosticText } from "./diagnostic-redaction.js";

describe("diagnostic redaction", () => {
  test("redacts assignments, bearer tokens, URL credentials, and secret query values", () => {
    const source = [
      "OPENAI_API_KEY=sk-live-secret",
      '"password":"hunter2"',
      "Authorization: Bearer abc.def.ghi",
      "https://user:pass@example.test/path?token=query-secret&mode=full",
    ].join("\n");

    const redacted = redactDiagnosticText(source);

    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("user:pass");
    expect(redacted).not.toContain("query-secret");
    expect(redacted).toContain("mode=full");
  });

  test("redacts configured home paths across Windows and slash-normalized forms", () => {
    const redacted = redactDiagnosticText(
      "C:\\Users\\alice\\.chisacode\\daemon.log C:/Users/alice/project",
      {
        paths: [
          { value: "C:\\Users\\alice\\.chisacode", replacement: "<chisacode-home>" },
          { value: "C:\\Users\\alice", replacement: "<home>" },
        ],
      },
    );

    expect(redacted).toBe("<chisacode-home>\\daemon.log <home>/project");
  });

  test("redacts split and assigned command-line secrets", () => {
    expect(
      redactDiagnosticArgv([
        "provider-cli",
        "--api-key",
        "secret-one",
        "--token=secret-two",
        "--mode",
        "safe",
      ]),
    ).toEqual(["provider-cli", "--api-key", "[redacted]", "--token=[redacted]", "--mode", "safe"]);
  });
});
