import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { exports: Record<string, unknown> };

/**
 * Every public schema subpath introduced by the Cindy integration must be
 * listed in the explicit `exports` map (no wildcard fallback exists). A missing
 * entry breaks external consumers with `ERR_PACKAGE_PATH_NOT_EXPORTED` after
 * build/publish and defeats per-domain tree-shaking.
 */
test("Cindy schema subpaths are exported from the protocol package", () => {
  const required = [
    "./cindy/messages",
    "./goal/rpc-schemas",
    "./learn/rpc-schemas",
    "./team/rpc-schemas",
    "./snapshot/rpc-schemas",
    "./migration/rpc-schemas",
    "./project-context/rpc-schemas",
  ];
  for (const subpath of required) {
    expect(packageJson.exports, `missing exports entry for ${subpath}`).toHaveProperty(subpath);
  }
});

test("cindyModules client capability is registered", async () => {
  const { CLIENT_CAPS } = await import("./client-capabilities.js");
  expect(CLIENT_CAPS.cindyModules).toBe("cindy_modules");
});
