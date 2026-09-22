import { describe, expect, it } from "vitest";
import { buildScriptHostname } from "./script-hostname.js";

describe("buildScriptHostname", () => {
  it("builds default branch hostnames with script and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "chisacode",
        branchName: null,
        scriptName: "web",
      }),
    ).toBe("web.chisacode.localhost");
  });

  it("omits the branch label for main and master", () => {
    expect(
      buildScriptHostname({
        projectSlug: "chisacode",
        branchName: "main",
        scriptName: "web",
      }),
    ).toBe("web.chisacode.localhost");
    expect(
      buildScriptHostname({
        projectSlug: "chisacode",
        branchName: "master",
        scriptName: "web",
      }),
    ).toBe("web.chisacode.localhost");
  });

  it("builds non-default branch hostnames with script, branch, and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "chisacode",
        branchName: "feature-auth",
        scriptName: "web",
      }),
    ).toBe("web.feature-auth.chisacode.localhost");
  });

  it("slugifies script, default branch project, and non-default branch labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "ChisaCode App",
        branchName: "Feature/Auth Flow",
        scriptName: "Web/API @ Dev",
      }),
    ).toBe("web-api-dev.feature-auth-flow.chisacode-app.localhost");
  });

  it("accepts already slugified labels because slugify is idempotent", () => {
    expect(
      buildScriptHostname({
        projectSlug: "chisacode-app",
        branchName: "feature-auth-flow",
        scriptName: "web-api-dev",
      }),
    ).toBe("web-api-dev.feature-auth-flow.chisacode-app.localhost");
  });

  it("uses untitled as the hostname-label fallback when labels collapse to empty", () => {
    expect(
      buildScriptHostname({
        projectSlug: "日本語",
        branchName: "***",
        scriptName: "---",
      }),
    ).toBe("untitled.untitled.untitled.localhost");
  });
});
