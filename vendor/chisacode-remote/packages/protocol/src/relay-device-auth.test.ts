import { describe, expect, test } from "vitest";

import {
  RelayAuthBootstrapSchema,
  RelayDeviceAuthChallengeSchema,
  RelayDeviceAuthProofSchema,
  buildRelayDeviceAuthTranscript,
  RELAY_DEVICE_AUTH_VERSION,
} from "./relay-device-auth.js";
import { ConnectionOfferV2Schema } from "./connection-offer.js";

describe("relay-device-auth schemas", () => {
  test("accepts bootstrap and proof messages", () => {
    const bootstrap = RelayAuthBootstrapSchema.parse({
      version: RELAY_DEVICE_AUTH_VERSION,
      pairingToken: "a".repeat(20),
      expiresAtMs: Date.now() + 60_000,
    });
    expect(bootstrap.version).toBe(1);

    const challenge = RelayDeviceAuthChallengeSchema.parse({
      type: "relay_device_auth_challenge",
      version: 1,
      challenge: "b".repeat(20),
      serverId: "srv_x",
    });
    expect(challenge.type).toBe("relay_device_auth_challenge");

    const proof = RelayDeviceAuthProofSchema.parse({
      type: "relay_device_auth_proof",
      version: 1,
      deviceId: "dev_12345678",
      proof: "c".repeat(20),
      pairingToken: "d".repeat(20),
    });
    expect(proof.deviceId.startsWith("dev_")).toBe(true);
  });

  test("connection offer remains parseable with and without authBootstrap", () => {
    const base = {
      v: 2 as const,
      serverId: "srv_1",
      daemonPublicKeyB64: "pub",
      relay: { endpoint: "relay.example", useTls: true },
    };
    expect(ConnectionOfferV2Schema.parse(base).authBootstrap).toBeUndefined();
    const withAuth = ConnectionOfferV2Schema.parse({
      ...base,
      authBootstrap: {
        version: 1,
        pairingToken: "e".repeat(20),
        expiresAtMs: 1_700_000_000_000,
      },
    });
    expect(withAuth.authBootstrap?.pairingToken.length).toBe(20);
  });

  test("transcript is order-stable", () => {
    const t = buildRelayDeviceAuthTranscript({
      version: 1,
      serverId: "s",
      daemonPublicKeyB64: "d",
      clientPublicKeyB64: "c",
      deviceId: "dev",
      challenge: "ch",
    });
    expect(t.split("\n")).toEqual([
      "v=1",
      "serverId=s",
      "daemonPublicKeyB64=d",
      "clientPublicKeyB64=c",
      "deviceId=dev",
      "challenge=ch",
    ]);
  });
});
