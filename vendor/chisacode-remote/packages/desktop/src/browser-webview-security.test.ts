import { describe, expect, it } from "vitest";
import {
  FORWARDED_CHISACODE_SHORTCUT_KEYS,
  isAllowedBrowserWebviewUrl,
  isBrowserRefreshInput,
  isBrowserLocationInput,
  isForwardableChisaCodeShortcutInput,
} from "./browser-webview-security";

describe("isAllowedBrowserWebviewUrl", () => {
  it("allows http URLs", () => {
    expect(isAllowedBrowserWebviewUrl("http://example.com")).toBe(true);
  });

  it("allows https URLs", () => {
    expect(isAllowedBrowserWebviewUrl("https://example.com")).toBe(true);
  });

  it("allows about:blank", () => {
    expect(isAllowedBrowserWebviewUrl("about:blank")).toBe(true);
  });

  it("allows undefined (no-op path)", () => {
    expect(isAllowedBrowserWebviewUrl(undefined)).toBe(true);
  });

  it("allows empty string (no-op path)", () => {
    expect(isAllowedBrowserWebviewUrl("")).toBe(true);
  });

  it("rejects file:// URLs", () => {
    expect(isAllowedBrowserWebviewUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects custom protocols", () => {
    expect(isAllowedBrowserWebviewUrl("chisacode://app/")).toBe(false);
    expect(isAllowedBrowserWebviewUrl("javascript:void(0)")).toBe(false);
    expect(isAllowedBrowserWebviewUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedBrowserWebviewUrl("not a url")).toBe(false);
    expect(isAllowedBrowserWebviewUrl("ftp://bad.example")).toBe(false);
  });
});

describe("isBrowserRefreshInput", () => {
  it("detects Cmd+R on macOS", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", meta: true, key: "r" })).toBe(true);
  });

  it("detects Ctrl+R on Windows/Linux", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", control: true, key: "r" })).toBe(true);
  });

  it("detects uppercase R", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", meta: true, key: "R" })).toBe(true);
  });

  it("rejects isolated R key (no modifier)", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", key: "r" })).toBe(false);
  });

  it("rejects Cmd+Shift+R (hard refresh — shift held)", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", meta: true, shift: true, key: "r" })).toBe(
      false,
    );
  });

  it("rejects Alt+R", () => {
    expect(isBrowserRefreshInput({ type: "keyDown", alt: true, key: "r" })).toBe(false);
  });

  it("rejects non-keyDown events", () => {
    expect(isBrowserRefreshInput({ type: "keyUp", meta: true, key: "r" })).toBe(false);
  });
});

describe("isBrowserLocationInput", () => {
  it("detects Cmd+L on macOS", () => {
    expect(isBrowserLocationInput({ type: "keyDown", meta: true, key: "l" })).toBe(true);
  });

  it("detects Ctrl+L on Windows/Linux", () => {
    expect(isBrowserLocationInput({ type: "keyDown", control: true, key: "l" })).toBe(true);
  });

  it("rejects isolated L key", () => {
    expect(isBrowserLocationInput({ type: "keyDown", key: "l" })).toBe(false);
  });

  it("rejects Cmd+Shift+L", () => {
    expect(isBrowserLocationInput({ type: "keyDown", meta: true, shift: true, key: "l" })).toBe(
      false,
    );
  });
});

describe("isForwardableChisaCodeShortcutInput", () => {
  it("detects known forwarded shortcuts", () => {
    for (const key of FORWARDED_CHISACODE_SHORTCUT_KEYS) {
      expect(isForwardableChisaCodeShortcutInput({ type: "keyDown", meta: true, key })).toBe(true);
    }
  });

  it("rejects non-keyDown events", () => {
    expect(isForwardableChisaCodeShortcutInput({ type: "keyUp", meta: true, key: "b" })).toBe(
      false,
    );
  });

  it("rejects keys not in the forwarded set", () => {
    expect(isForwardableChisaCodeShortcutInput({ type: "keyDown", meta: true, key: "x" })).toBe(
      false,
    );
    expect(isForwardableChisaCodeShortcutInput({ type: "keyDown", meta: true, key: "q" })).toBe(
      false,
    );
  });

  it("rejects keys without a modifier", () => {
    expect(isForwardableChisaCodeShortcutInput({ type: "keyDown", key: "b" })).toBe(false);
  });
});
