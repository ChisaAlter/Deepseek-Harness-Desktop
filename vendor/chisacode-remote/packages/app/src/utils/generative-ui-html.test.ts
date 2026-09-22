import { describe, expect, it } from "vitest";
import {
  buildGenerativeHtmlDocument,
  getGenerativeHtmlFence,
  getGenerativeUiFence,
  isGenerativeHtmlFence,
} from "./generative-ui-html";

describe("generative UI HTML", () => {
  it("recognizes HTML fenced code blocks as generative UI", () => {
    expect(isGenerativeHtmlFence("html", "<section><h1>Status</h1></section>")).toBe(true);
    expect(isGenerativeHtmlFence("HTML preview", "<div>Chart</div>")).toBe(true);
    expect(isGenerativeHtmlFence("html", '<img src="data:image/png;base64,abc" alt="Chart">')).toBe(
      true,
    );
    expect(isGenerativeHtmlFence("html", "<label>Name</label><textarea></textarea>")).toBe(true);
    expect(isGenerativeHtmlFence("tsx", "<div>React component</div>")).toBe(false);
    expect(isGenerativeHtmlFence("html", "plain text only")).toBe(false);
  });

  it("extracts normalized HTML fence content for preview rendering", () => {
    expect(getGenerativeHtmlFence(" html ", "\n<div>Card</div>\n")).toEqual({
      html: "<div>Card</div>",
      language: "html",
    });
    expect(getGenerativeHtmlFence("javascript", "<div>Not a preview</div>")).toBeNull();
  });

  it("wraps fragments in a sandbox document with a restrictive CSP (no scripts by default)", () => {
    const documentHtml = buildGenerativeHtmlDocument("<button>Run</button>");

    expect(documentHtml).toContain("<!doctype html>");
    expect(documentHtml).toContain("default-src 'none'");
    expect(documentHtml).toContain("script-src 'none'");
    expect(documentHtml).not.toContain("script-src 'unsafe-inline'");
    expect(documentHtml).toContain("connect-src 'none'");
    expect(documentHtml).toContain("<button>Run</button>");
  });

  it("opts into inline scripts only when allowScripts is true", () => {
    const documentHtml = buildGenerativeHtmlDocument("<button>Run</button>", {
      allowScripts: true,
    });

    expect(documentHtml).toContain("script-src 'unsafe-inline'");
    expect(documentHtml).not.toContain("script-src 'none'");
  });

  it("adds the sandbox CSP to full HTML documents", () => {
    const documentHtml = buildGenerativeHtmlDocument(
      "<!doctype html><html><head><title>Dash</title></head><body>OK</body></html>",
    );

    expect(documentHtml).toContain("<title>Dash</title>");
    expect(documentHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(documentHtml.indexOf("Content-Security-Policy")).toBeLessThan(
      documentHtml.indexOf("<title>Dash</title>"),
    );
  });
});

describe("getGenerativeUiFence", () => {
  it("detects structured gen_ui fence from sourceInfo + content", () => {
    const result = getGenerativeUiFence(
      "chisacode-ui component=line_chart",
      '{"title": "Sales","data": [{"month": "Jan","amount": 100}]}',
    );
    expect(result).toEqual({
      componentId: "line_chart",
      props: { title: "Sales", data: [{ month: "Jan", amount: 100 }] },
      source: "fence",
    });
  });

  it("returns null for non-gen-ui code blocks", () => {
    expect(getGenerativeUiFence("json", '{"key": "value"}')).toBeNull();
    expect(getGenerativeUiFence("html", "<div>hello</div>")).toBeNull();
    expect(getGenerativeUiFence("typescript", "const x = 1;")).toBeNull();
  });

  it("returns null when sourceInfo is null or empty", () => {
    expect(getGenerativeUiFence(null, "{}")).toBeNull();
    expect(getGenerativeUiFence(undefined, "{}")).toBeNull();
    expect(getGenerativeUiFence("", "")).toBeNull();
  });

  it("returns null when JSON parsing fails", () => {
    expect(getGenerativeUiFence("chisacode-ui component=form", "{invalid json}")).toBeNull();
  });

  it("returns null when payload is an array", () => {
    expect(getGenerativeUiFence("chisacode-ui component=table", "[1, 2, 3]")).toBeNull();
  });

  it("returns null when payload is a primitive", () => {
    expect(getGenerativeUiFence("chisacode-ui component=chart", '"string"')).toBeNull();
    expect(getGenerativeUiFence("chisacode-ui component=chart", "42")).toBeNull();
  });
});
