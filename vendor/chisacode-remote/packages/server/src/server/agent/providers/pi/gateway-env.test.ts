import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PI_CODING_AGENT_DIR_ENV, preparePiGatewayEnv } from "./gateway-env.js";

const modeMask = 0o777;

function modeOf(path: string): number {
  return statSync(path).mode & modeMask;
}

describe("preparePiGatewayEnv", () => {
  let tempHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(process.cwd(), ".tmp-pi-gateway-"));
    previousHome = process.env.CHISACODE_HOME;
    process.env.CHISACODE_HOME = tempHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.CHISACODE_HOME;
    else process.env.CHISACODE_HOME = previousHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("leaves env unchanged when gateway credentials are incomplete or explicit", () => {
    const missingKey = { OPENAI_BASE_URL: "https://gateway.example/v1" };
    expect(preparePiGatewayEnv(missingKey)).toBe(missingKey);
    const missingUrl = { OPENAI_API_KEY: "secret" };
    expect(preparePiGatewayEnv(missingUrl)).toBe(missingUrl);
    const explicit = {
      OPENAI_API_KEY: "secret",
      OPENAI_BASE_URL: "https://gateway.example/v1",
      [PI_CODING_AGENT_DIR_ENV]: "C:/custom/pi",
    };
    expect(preparePiGatewayEnv(explicit)).toBe(explicit);
    expect(preparePiGatewayEnv(undefined)).toBeUndefined();
  });

  it("creates an isolated private Pi config without persisting the secret", () => {
    const env = { OPENAI_API_KEY: "super-secret", OPENAI_BASE_URL: "https://gateway.example/v1" };
    const result = preparePiGatewayEnv(env);
    expect(result).not.toBe(env);
    expect(result?.[PI_CODING_AGENT_DIR_ENV]).toContain(join("provider-runtime", "pi"));
    const agentDir = result?.[PI_CODING_AGENT_DIR_ENV];
    if (!agentDir) throw new Error("Expected managed Pi agent directory");
    const modelsPath = join(agentDir, "models.json");
    const content = readFileSync(modelsPath, "utf8");
    expect(content).toContain("https://gateway.example/v1");
    expect(content).toContain("$OPENAI_API_KEY");
    expect(content).not.toContain("super-secret");
    expect(readdirSync(agentDir)).toEqual(["models.json"]);
    if (process.platform !== "win32") {
      expect(modeOf(agentDir)).toBe(0o700);
      expect(modeOf(modelsPath)).toBe(0o600);
    }
  });

  it("isolates different gateway base URLs and reuses the same identity", () => {
    const first = preparePiGatewayEnv({ OPENAI_API_KEY: "a", OPENAI_BASE_URL: "https://one.test" });
    const same = preparePiGatewayEnv({ OPENAI_API_KEY: "b", OPENAI_BASE_URL: "https://one.test" });
    const second = preparePiGatewayEnv({
      OPENAI_API_KEY: "a",
      OPENAI_BASE_URL: "https://two.test",
    });
    expect(first?.[PI_CODING_AGENT_DIR_ENV]).toBe(same?.[PI_CODING_AGENT_DIR_ENV]);
    expect(first?.[PI_CODING_AGENT_DIR_ENV]).not.toBe(second?.[PI_CODING_AGENT_DIR_ENV]);
  });

  it("uses the normal home fallback when CHISACODE_HOME is blank", () => {
    process.env.CHISACODE_HOME = " ";
    const result = preparePiGatewayEnv({
      OPENAI_API_KEY: "a",
      OPENAI_BASE_URL: "https://fallback.test",
    });
    expect(result?.[PI_CODING_AGENT_DIR_ENV]).toBe(
      join(
        homedir(),
        ".chisacode",
        "provider-runtime",
        "pi",
        result?.[PI_CODING_AGENT_DIR_ENV]?.split(/[\\/]/).pop() ?? "",
      ),
    );
  });
});
