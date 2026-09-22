import { describe, expect, test } from "vitest";
import { Command } from "commander";

import { runDiagnosticsCommandWithDependencies } from "./diagnostics.js";

describe("runDiagnosticsCommand", () => {
  test("requests explicitly bounded logs and returns a structured report", async () => {
    const requests: unknown[] = [];
    let closed = false;

    const result = await runDiagnosticsCommandWithDependencies(
      { host: "127.0.0.1:6767", logs: true, logLines: "75" },
      new Command(),
      {
        connect: async (options) => {
          expect(options).toEqual({ host: "127.0.0.1:6767" });
          return {
            getDiagnostics: async (request) => {
              requests.push(request);
              return { requestId: "diagnostics-1", diagnostic: "Daemon report" };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(requests).toEqual([{ includeLogs: true, maxLogLines: 75 }]);
    expect(result.data).toEqual({ diagnostic: "Daemon report" });
    expect(closed).toBe(true);
  });

  test("keeps daemon logs disabled by default", async () => {
    const requests: unknown[] = [];

    await runDiagnosticsCommandWithDependencies({}, new Command(), {
      connect: async () => ({
        getDiagnostics: async (request) => {
          requests.push(request);
          return { requestId: "diagnostics-2", diagnostic: "Safe report" };
        },
        close: async () => undefined,
      }),
    });

    expect(requests).toEqual([{ includeLogs: false, maxLogLines: undefined }]);
  });
});
