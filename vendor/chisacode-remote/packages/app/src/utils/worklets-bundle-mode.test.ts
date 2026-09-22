import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const metroConfig = require("../../metro.config.cjs");

describe("Worklets Bundle Mode Metro configuration", () => {
  it("assigns reserved IDs for Windows module paths", () => {
    const createModuleId = metroConfig.serializer.createModuleIdFactory();
    const workletsRoot = path.win32.join("C:\\repo", "node_modules", "react-native-worklets");

    expect(createModuleId(path.win32.join(workletsRoot, "src", "index.ts"))).toBe(-2);
    expect(createModuleId(path.win32.join(workletsRoot, ".worklets", "12345.js"))).toBe(12345);
  });
});
