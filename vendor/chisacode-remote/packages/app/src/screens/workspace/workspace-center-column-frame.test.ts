import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace center frame ownership", () => {
  it("leaves the workspace separator to the app frame and sidebar", () => {
    const source = readFileSync(new URL("./workspace-center-column.tsx", import.meta.url), "utf8");
    const centerContentStyle = source.match(/centerContent:\s*\{([\s\S]*?)\n  \},/u)?.[1];

    expect(centerContentStyle).toBeDefined();
    expect(centerContentStyle).not.toContain("borderLeftWidth");
    expect(centerContentStyle).not.toContain("borderLeftColor");
  });
});
