import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const RELAY_DEVICE_AUTH_VERSION = 1 as const;

export function buildRelayDeviceAuthTranscript(input: {
  version: number;
  serverId: string;
  daemonPublicKeyB64: string;
  clientPublicKeyB64: string;
  deviceId: string;
  challenge: string;
}): string {
  return [
    `v=${input.version}`,
    `serverId=${input.serverId}`,
    `daemonPublicKeyB64=${input.daemonPublicKeyB64}`,
    `clientPublicKeyB64=${input.clientPublicKeyB64}`,
    `deviceId=${input.deviceId}`,
    `challenge=${input.challenge}`,
  ].join("\n");
}

/**
 * Create a random challenge for relay device auth.
 * @returns Base64url challenge string
 */
export function createRelayAuthChallenge(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Compute HMAC-SHA256 proof over the canonical relay auth transcript.
 * @param deviceSecret Raw device secret
 * @param transcriptFields Transcript fields
 * @returns Base64url proof
 */
export function computeRelayDeviceAuthProof(
  deviceSecret: string,
  transcriptFields: {
    serverId: string;
    daemonPublicKeyB64: string;
    clientPublicKeyB64: string;
    deviceId: string;
    challenge: string;
    version?: number;
  },
): string {
  const transcript = buildRelayDeviceAuthTranscript({
    version: transcriptFields.version ?? RELAY_DEVICE_AUTH_VERSION,
    serverId: transcriptFields.serverId,
    daemonPublicKeyB64: transcriptFields.daemonPublicKeyB64,
    clientPublicKeyB64: transcriptFields.clientPublicKeyB64,
    deviceId: transcriptFields.deviceId,
    challenge: transcriptFields.challenge,
  });
  return createHmac("sha256", deviceSecret).update(transcript, "utf8").digest("base64url");
}

/**
 * Timing-safe compare of two base64url (or arbitrary utf8) proofs.
 * @param left First proof
 * @param right Second proof
 */
export function verifyRelayDeviceAuthProof(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
