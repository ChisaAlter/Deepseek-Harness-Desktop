import { describe, expect, test } from "vitest";

import {
  MemoryRelayDeviceCredentialStore,
  RelayDeviceCredentialClient,
  computeClientRelayDeviceAuthProof,
  createRelayDeviceId,
} from "./relay-device-credentials.js";

describe("RelayDeviceCredentialClient", () => {
  test("persists credentials and builds proofs compatible with server helper", async () => {
    const store = new MemoryRelayDeviceCredentialStore();
    const client = new RelayDeviceCredentialClient(store);
    const deviceId = createRelayDeviceId();
    expect(deviceId.startsWith("dev_")).toBe(true);

    await client.upsert({
      serverId: "srv_1",
      deviceId,
      deviceSecret: "secret_value_1234567890_abcdef",
      daemonPublicKeyB64: "daemon-pub",
    });
    const loaded = await client.get("srv_1");
    expect(loaded?.deviceId).toBe(deviceId);

    const auth = client.buildProofAuth({
      credential: loaded!,
      clientPublicKeyB64: "client-pub",
    });
    expect(auth.deviceId).toBe(deviceId);
    expect(auth.proof.length).toBeGreaterThan(20);

    const expected = computeClientRelayDeviceAuthProof(loaded!.deviceSecret, {
      serverId: "srv_1",
      daemonPublicKeyB64: "daemon-pub",
      clientPublicKeyB64: "client-pub",
      deviceId,
      challenge: auth.challenge,
    });
    expect(auth.proof).toBe(expected);
  });

  test("buildPairingAuth carries bootstrap token", () => {
    const client = new RelayDeviceCredentialClient(new MemoryRelayDeviceCredentialStore());
    const auth = client.buildPairingAuth({
      deviceId: "dev_pair_1",
      pairingToken: "token_value_1234567890",
      clientPublicKeyB64: "client-pub",
    });
    expect(auth.pairingToken).toBe("token_value_1234567890");
    expect(auth.deviceId).toBe("dev_pair_1");
  });
});

test("pure-JS HMAC matches node:crypto for transcript proofs", async () => {
  const { createHmac } = await import("node:crypto");
  const { computeClientRelayDeviceAuthProof: computePureProof } =
    await import("./relay-device-credentials.js");
  const fields = {
    serverId: "srv_parity",
    daemonPublicKeyB64: "daemon-pub-key-b64",
    clientPublicKeyB64: "client-pub-key-b64",
    deviceId: "dev_parity_1",
    challenge: "challenge_parity_1234567890",
  };
  const secret = "device-secret-parity-value-1234567890";
  const pure = computePureProof(secret, fields);
  const transcript = [
    `v=1`,
    `serverId=${fields.serverId}`,
    `daemonPublicKeyB64=${fields.daemonPublicKeyB64}`,
    `clientPublicKeyB64=${fields.clientPublicKeyB64}`,
    `deviceId=${fields.deviceId}`,
    `challenge=${fields.challenge}`,
  ].join("\n");
  const expected = createHmac("sha256", secret).update(transcript).digest("base64url");
  expect(pure).toBe(expected);
});
