import protocolPackage from "../package.json" with { type: "json" };
import { describe, expect, test } from "vitest";

const V1_0_2_PUBLIC_SUBPATHS = [
  "./agent-attention-notification",
  "./agent-labels",
  "./agent-lifecycle",
  "./agent-presets",
  "./agent-state-bucket",
  "./agent-title-limits",
  "./agent-types",
  "./binary-frames/file-transfer",
  "./binary-frames/index",
  "./binary-frames/terminal",
  "./branch-slug",
  "./chat/rpc-schemas",
  "./chat/types",
  "./chisacode-config-schema",
  "./client-capabilities",
  "./connection-offer",
  "./relay-device-auth",
  "./daemon-endpoints",
  "./error-utils",
  "./git-remote",
  "./host-connection-schema",
  "./importable-providers",
  "./literal-union",
  "./loop/rpc-schemas",
  "./messages",
  "./path-utils",
  "./provider-config",
  "./provider-manifest",
  "./schedule/rpc-schemas",
  "./schedule/types",
  "./terminal-input-mode",
  "./terminal-key-input",
  "./terminal-snapshot",
  "./terminal-stream-protocol",
  "./tool-call-display",
  "./tool-name-normalization",
] as const;

describe("current package exports", () => {
  test("exports automation messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./automation/messages"]).toEqual({
      types: "./dist/automation/messages.d.ts",
      default: "./dist/automation/messages.js",
    });
  });

  test("exports agent attachments as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./agent/attachments"]).toEqual({
      types: "./dist/agent/attachments.d.ts",
      default: "./dist/agent/attachments.js",
    });
  });

  test("exports agent state as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./agent/state"]).toEqual({
      types: "./dist/agent/state.d.ts",
      default: "./dist/agent/state.js",
    });
  });

  test("exports agent messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./agent/messages"]).toEqual({
      types: "./dist/agent/messages.d.ts",
      default: "./dist/agent/messages.js",
    });
  });

  test("exports checkout messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./checkout/messages"]).toEqual({
      types: "./dist/checkout/messages.d.ts",
      default: "./dist/checkout/messages.js",
    });
  });

  test("exports provider messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./provider/messages"]).toEqual({
      types: "./dist/provider/messages.d.ts",
      default: "./dist/provider/messages.js",
    });
  });

  test("exports terminal messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./terminal/messages"]).toEqual({
      types: "./dist/terminal/messages.d.ts",
      default: "./dist/terminal/messages.js",
    });
  });

  test("exports usage messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./usage/messages"]).toEqual({
      types: "./dist/usage/messages.d.ts",
      default: "./dist/usage/messages.js",
    });
  });

  test("exports voice messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./voice/messages"]).toEqual({
      types: "./dist/voice/messages.d.ts",
      default: "./dist/voice/messages.js",
    });
  });

  test("exports workspace messages as a first-class protocol domain", () => {
    expect(protocolPackage.exports["./workspace/messages"]).toEqual({
      types: "./dist/workspace/messages.d.ts",
      default: "./dist/workspace/messages.js",
    });
  });
});

describe("package exports compatibility", () => {
  test.each(V1_0_2_PUBLIC_SUBPATHS)("keeps the v1.0.2 public subpath %s", (subpath) => {
    const outputPath = subpath.slice(2);

    expect(protocolPackage.exports[subpath]).toEqual({
      types: `./dist/${outputPath}.d.ts`,
      default: `./dist/${outputPath}.js`,
    });
  });
});
