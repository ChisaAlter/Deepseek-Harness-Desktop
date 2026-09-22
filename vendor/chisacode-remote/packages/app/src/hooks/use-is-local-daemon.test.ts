import { describe, expect, it } from "vitest";
import { isLoopbackDaemonHost, resolveLocalDaemonServerId } from "@/hooks/local-daemon-hosts";
import type { HostProfile } from "@/types/host-connection";

function makeHost(input: {
  serverId: string;
  type?: "directTcp" | "relay";
  endpoint?: string;
}): HostProfile {
  const now = "2026-06-20T00:00:00.000Z";
  const type = input.type ?? "directTcp";
  return {
    serverId: input.serverId,
    label: input.serverId,
    lifecycle: {},
    connections:
      type === "directTcp"
        ? [
            {
              id: `direct:${input.endpoint ?? "localhost:6767"}`,
              type: "directTcp",
              endpoint: input.endpoint ?? "localhost:6767",
            },
          ]
        : [
            {
              id: "relay:relay.chisacode.sh:443",
              type: "relay",
              relayEndpoint: "relay.chisacode.sh:443",
              useTls: true,
              daemonPublicKeyB64: "public-key",
            },
          ],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("local daemon host resolution", () => {
  it("treats direct loopback TCP hosts as local daemons", () => {
    expect(isLoopbackDaemonHost(makeHost({ serverId: "local", endpoint: "127.0.0.1:6767" }))).toBe(
      true,
    );
    expect(isLoopbackDaemonHost(makeHost({ serverId: "local", endpoint: "localhost:6767" }))).toBe(
      true,
    );
    expect(isLoopbackDaemonHost(makeHost({ serverId: "local", endpoint: "[::1]:6767" }))).toBe(
      true,
    );
  });

  it("does not treat remote or relay hosts as local daemons", () => {
    expect(isLoopbackDaemonHost(makeHost({ serverId: "remote", endpoint: "10.0.0.5:6767" }))).toBe(
      false,
    );
    expect(isLoopbackDaemonHost(makeHost({ serverId: "relay", type: "relay" }))).toBe(false);
  });

  it("prefers the desktop daemon id when the bridge reports one", () => {
    expect(
      resolveLocalDaemonServerId({
        desktopServerId: "desktop-local",
        hosts: [makeHost({ serverId: "loopback", endpoint: "localhost:6767" })],
      }),
    ).toBe("desktop-local");
  });

  it("falls back to the first loopback host when desktop metadata is unavailable", () => {
    expect(
      resolveLocalDaemonServerId({
        desktopServerId: null,
        hosts: [
          makeHost({ serverId: "remote", endpoint: "10.0.0.5:6767" }),
          makeHost({ serverId: "loopback", endpoint: "127.0.0.1:53123" }),
        ],
      }),
    ).toBe("loopback");
  });
});
