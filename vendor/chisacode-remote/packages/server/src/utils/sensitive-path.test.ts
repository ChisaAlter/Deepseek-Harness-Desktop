import { describe, expect, test } from "vitest";

import { detectSensitivePath, filterSensitivePaths } from "./sensitive-path.js";

describe("detectSensitivePath", () => {
  test("returns null for safe paths", () => {
    expect(detectSensitivePath("src/index.ts")).toBeNull();
    expect(detectSensitivePath("packages/server/src/utils/path.ts")).toBeNull();
    expect(detectSensitivePath("README.md")).toBeNull();
    expect(detectSensitivePath("")).toBeNull();
    expect(detectSensitivePath(".")).toBeNull();
  });

  test("detects .git internals", () => {
    expect(detectSensitivePath(".git")).toBe("git-internal-path");
    expect(detectSensitivePath(".git/config")).toBe("git-internal-path");
    expect(detectSensitivePath("repo/.git/HEAD")).toBe("git-internal-path");
  });

  test("detects .env files", () => {
    expect(detectSensitivePath(".env")).toBe("env-file");
    expect(detectSensitivePath(".env.local")).toBe("env-file");
    expect(detectSensitivePath("config/.env.production")).toBe("env-file");
  });

  test("allows .env templates by default", () => {
    expect(detectSensitivePath(".env.example")).toBeNull();
    expect(detectSensitivePath(".env.sample")).toBeNull();
    expect(detectSensitivePath(".env.template")).toBeNull();
  });

  test("rejects .env templates when allowEnvTemplates is false", () => {
    const opts = { allowEnvTemplates: false };
    expect(detectSensitivePath(".env.example", opts)).toBe("env-file");
    expect(detectSensitivePath(".env.sample", opts)).toBe("env-file");
  });

  test("detects sensitive directories", () => {
    expect(detectSensitivePath(".ssh/id_rsa")).toBe("sensitive-directory");
    expect(detectSensitivePath(".aws/credentials")).toBe("sensitive-directory");
    expect(detectSensitivePath(".azure/config")).toBe("sensitive-directory");
    expect(detectSensitivePath(".kube/config")).toBe("sensitive-directory");
    expect(detectSensitivePath("home/.ssh/known_hosts")).toBe("sensitive-directory");
  });

  test("detects sensitive basenames", () => {
    expect(detectSensitivePath(".npmrc")).toBe("sensitive-basename");
    expect(detectSensitivePath(".netrc")).toBe("sensitive-basename");
    expect(detectSensitivePath(".git-credentials")).toBe("sensitive-basename");
    expect(detectSensitivePath("credentials")).toBe("sensitive-basename");
    expect(detectSensitivePath("credentials.json")).toBe("sensitive-basename");
    expect(detectSensitivePath("service-account.json")).toBe("sensitive-basename");
    expect(detectSensitivePath("config/.pypirc")).toBe("sensitive-basename");
  });

  test("detects private keys", () => {
    expect(detectSensitivePath("id_rsa")).toBe("private-key-path");
    expect(detectSensitivePath("id_ed25519")).toBe("private-key-path");
    expect(detectSensitivePath("keys/id_ecdsa")).toBe("private-key-path");
    expect(detectSensitivePath("id_dsa")).toBe("private-key-path");
  });

  test("detects sensitive extensions", () => {
    expect(detectSensitivePath("server.pem")).toBe("sensitive-extension");
    expect(detectSensitivePath("certs/tls.key")).toBe("sensitive-extension");
    expect(detectSensitivePath("app.p12")).toBe("sensitive-extension");
    expect(detectSensitivePath("store.jks")).toBe("sensitive-extension");
    expect(detectSensitivePath("passwords.kdbx")).toBe("sensitive-extension");
    expect(detectSensitivePath("keystore.keystore")).toBe("sensitive-extension");
  });

  test("detects known credential file paths", () => {
    expect(detectSensitivePath(".docker/config.json")).toBe("sensitive-path");
    // basename "credentials" matches SENSITIVE_BASENAMES before SENSITIVE_PATH_RE
    expect(detectSensitivePath(".gem/credentials")).toBe("sensitive-basename");
    expect(detectSensitivePath(".config/gh/hosts.yml")).toBe("sensitive-path");
    expect(detectSensitivePath(".pip/pip.conf")).toBe("sensitive-path");
    expect(detectSensitivePath(".config/gcloud/application_default_credentials.json")).toBe(
      "sensitive-path",
    );
  });

  test("detects credential config dirs when opted in", () => {
    const opts = { excludeCredentialConfigDirs: true };
    // hosts.yml matches SENSITIVE_PATH_RE first, so use a non-listed file
    expect(detectSensitivePath(".config/gh/config.yml", opts)).toBe("sensitive-config-directory");
    expect(detectSensitivePath(".config/gcloud/something", opts)).toBe(
      "sensitive-config-directory",
    );
  });

  test("does not flag credential config dirs by default", () => {
    // .config/gh/hosts.yml matches sensitive-path first via SENSITIVE_PATH_RE
    expect(detectSensitivePath(".config/gh/some-other-file")).toBeNull();
  });

  test("detects secret directories", () => {
    expect(detectSensitivePath("secrets/api-key.txt")).toBe("secret-directory");
    expect(detectSensitivePath("app/secret/config")).toBe("secret-directory");
  });

  test("detects credentials directories", () => {
    expect(detectSensitivePath("credentials/aws.json")).toBe("credentials-directory");
    expect(detectSensitivePath("app/credential/store")).toBe("credentials-directory");
  });

  test("detects secret config files", () => {
    expect(detectSensitivePath("secrets.json")).toBe("secret-config-path");
    expect(detectSensitivePath("credentials.yml")).toBe("secret-config-path");
    expect(detectSensitivePath("config/secret.toml")).toBe("secret-config-path");
  });

  test("normalizes backslashes", () => {
    expect(detectSensitivePath(".ssh\\id_rsa")).toBe("sensitive-directory");
    // key.pem matches sensitive-extension before secret-directory
    expect(detectSensitivePath("secrets\\key.pem")).toBe("sensitive-extension");
    expect(detectSensitivePath("secrets\\config.txt")).toBe("secret-directory");
  });

  test("is case insensitive", () => {
    expect(detectSensitivePath(".SSH/id_rsa")).toBe("sensitive-directory");
    expect(detectSensitivePath(".ENV")).toBe("env-file");
    expect(detectSensitivePath("ID_RSA")).toBe("private-key-path");
    expect(detectSensitivePath("SERVER.PEM")).toBe("sensitive-extension");
  });

  test("does not false-positive on safe lookalikes", () => {
    expect(detectSensitivePath("src/secretary.ts")).toBeNull();
    expect(detectSensitivePath("docs/credentials-guide.md")).toBeNull();
    expect(detectSensitivePath("keynote.txt")).toBeNull();
    expect(detectSensitivePath("environment.ts")).toBeNull();
  });
});

describe("filterSensitivePaths", () => {
  test("partitions safe and sensitive paths, carrying the detector name", () => {
    const result = filterSensitivePaths([
      "src/app.ts",
      ".env",
      "config/settings.json",
      ".ssh/id_rsa",
      "README.md",
    ]);
    expect(result.safe).toEqual(["src/app.ts", "config/settings.json", "README.md"]);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded.find((e) => e.path === ".env")?.detector).toBe("env-file");
    expect(result.excluded.find((e) => e.path === ".ssh/id_rsa")?.detector).toBe(
      "sensitive-directory",
    );
  });

  test("returns all safe when no sensitive paths are present", () => {
    const result = filterSensitivePaths(["a.ts", "b.ts"]);
    expect(result.safe).toEqual(["a.ts", "b.ts"]);
    expect(result.excluded).toEqual([]);
  });

  test("returns all excluded when every path is sensitive", () => {
    const result = filterSensitivePaths([".env", "secrets/token.txt"]);
    expect(result.safe).toEqual([]);
    expect(result.excluded).toHaveLength(2);
  });

  test("forwards options to the detector", () => {
    // allowEnvTemplates=false rejects .env.example, which is allowed by default.
    const result = filterSensitivePaths([".env.example"], {
      allowEnvTemplates: false,
    });
    expect(result.safe).toEqual([]);
    expect(result.excluded).toHaveLength(1);
  });
});
