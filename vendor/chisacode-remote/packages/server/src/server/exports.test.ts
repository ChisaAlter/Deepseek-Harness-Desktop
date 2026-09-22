import { expect, test } from "vitest";

test("keeps daemon-client APIs out of the server public entry", async () => {
  const serverExports = await import("./exports.js");

  expect(serverExports.createChisaCodeDaemon).toBeTypeOf("function");
  expect(serverExports.resolveChisaCodeHome).toBeTypeOf("function");

  for (const name of [
    "DaemonClient",
    "DaemonClientConfig",
    "ConnectionState",
    "DaemonEvent",
    "WebSocketFactory",
    "WebSocketLike",
  ]) {
    expect(serverExports).not.toHaveProperty(name);
  }
});
