import { describe, expect, it } from "vitest";
import { createCli } from "./cli";
import { renderError } from "./output/render";

function withLang<T>(language: string | undefined, run: () => T): T {
  const previous = process.env.CHISACODE_LANG;
  if (language === undefined) {
    delete process.env.CHISACODE_LANG;
  } else {
    process.env.CHISACODE_LANG = language;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.CHISACODE_LANG;
    } else {
      process.env.CHISACODE_LANG = previous;
    }
  }
}

describe("CLI i18n", () => {
  it("defaults help output to Simplified Chinese", () => {
    const help = withLang(undefined, () => createCli().helpInformation());

    expect(help).toContain("从命令行控制你的 AI coding agents");
    expect(help).toContain("输出格式：table、json、yaml");
  });

  it("supports English help output with CHISACODE_LANG=en", () => {
    const help = withLang("en", () => createCli().helpInformation());

    expect(help).toContain("control your AI coding agents from the command line");
    expect(help).toContain("output format: table, json, yaml");
  });

  it("keeps machine-readable error output fields unchanged", () => {
    const output = withLang("zh-CN", () =>
      renderError({ code: "EXAMPLE_ERROR", message: "Raw machine message" }, { format: "json" }),
    );

    expect(JSON.parse(output)).toEqual({
      error: {
        code: "EXAMPLE_ERROR",
        message: "Raw machine message",
      },
    });
  });
});
