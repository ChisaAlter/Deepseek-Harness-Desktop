import { describe, expect, it } from "vitest";

import { parsePartialJsonObject } from "./partial-json.js";

describe("parsePartialJsonObject", () => {
  it("parses complete objects", () => {
    expect(parsePartialJsonObject('{"command":"pwd","cwd":"/tmp/repo"}')).toEqual({
      value: {
        command: "pwd",
        cwd: "/tmp/repo",
      },
      complete: true,
    });
  });

  it("does not emit incomplete string values", () => {
    expect(parsePartialJsonObject('{"command":"echo ')).toEqual({
      value: {},
      complete: false,
    });
  });

  it("returns only complete prefix fields from incomplete objects", () => {
    expect(parsePartialJsonObject('{"file_path":"src/message.tsx","old_string":"before')).toEqual({
      value: {
        file_path: "src/message.tsx",
      },
      complete: false,
    });
  });

  it("does not emit incomplete nested values", () => {
    expect(parsePartialJsonObject('{"payload":{"path":"src/index.ts","content":"hello')).toEqual({
      value: {},
      complete: false,
    });
  });

  it("returns null for non-object payloads", () => {
    expect(parsePartialJsonObject('"text"')).toBeNull();
  });
});
