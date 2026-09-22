import { describe, expect, it } from "vitest";

import { renderJson } from "./json";
import { renderYaml } from "./yaml";
import type { AnyCommandResult, OutputOptions } from "./types";

const options: OutputOptions = {
  format: "json",
  quiet: false,
  noHeaders: false,
  noColor: false,
};

function rowResult(
  collapseIdenticalRows: boolean | undefined,
): AnyCommandResult<{ key: string; value: string }> {
  return {
    type: "list",
    data: [
      { key: "k1", value: "v1" },
      { key: "k2", value: "v2" },
    ],
    schema: {
      idField: "key",
      columns: [{ header: "KEY", field: "key" }],
      serialize: () => ({ status: "ok" }),
      collapseIdenticalRows,
    },
  };
}

describe("renderJson/renderYaml collapseIdenticalRows", () => {
  it("collapses identical rows to one object when the schema opts in", () => {
    const json = renderJson(rowResult(true), options);
    expect(JSON.parse(json)).toEqual({ status: "ok" });

    const yaml = renderYaml(rowResult(true), options);
    expect(yaml).toContain("status: ok");
    expect(yaml.split("\n").filter((line) => line.includes("status:"))).toHaveLength(1);
  });

  it("keeps every row when the schema does not opt in (no silent row loss)", () => {
    const json = renderJson(rowResult(false), options);
    expect(JSON.parse(json)).toEqual([{ status: "ok" }, { status: "ok" }]);

    const yaml = renderYaml(rowResult(false), options);
    expect(yaml.split("\n").filter((line) => line.includes("status: ok"))).toHaveLength(2);
  });

  it("keeps every row when the flag is unset (default)", () => {
    const json = renderJson(rowResult(undefined), options);
    expect(JSON.parse(json)).toEqual([{ status: "ok" }, { status: "ok" }]);
  });
});
