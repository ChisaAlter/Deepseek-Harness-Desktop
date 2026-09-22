import { hmacSha256Base64Url, randomBase64UrlChallenge, randomHex } from "./sha256-hmac.js";

const RELAY_DEVICE_AUTH_VERSION = 1 as const;

function utf8Bytes(input: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(input);
  }
  const encoded = unescape(encodeURIComponent(input));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function buildRelayDeviceAuthTranscript(input: {
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
 * Per-daemon relay device credential held on the client host.
 */
export interface RelayDeviceCredential {
  serverId: string;
  deviceId: string;
  deviceSecret: string;
  daemonPublicKeyB64: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelayDeviceCredentialStoreAdapter {
  load(): Promise<RelayDeviceCredential[]>;
  save(credentials: RelayDeviceCredential[]): Promise<void>;
}

/**
 * In-memory adapter for tests and short-lived CLI processes.
 */
export class MemoryRelayDeviceCredentialStore implements RelayDeviceCredentialStoreAdapter {
  private credentials: RelayDeviceCredential[] = [];

  async load(): Promise<RelayDeviceCredential[]> {
    return this.credentials.map((entry) => ({ ...entry }));
  }

  async save(credentials: RelayDeviceCredential[]): Promise<void> {
    this.credentials = credentials.map((entry) => ({ ...entry }));
  }
}

/**
 * Client-side credential helper: load/save device secrets and build hello auth proofs.
 */
export class RelayDeviceCredentialClient {
  constructor(private readonly adapter: RelayDeviceCredentialStoreAdapter) {}

  async get(serverId: string): Promise<RelayDeviceCredential | null> {
    const all = await this.adapter.load();
    return all.find((entry) => entry.serverId === serverId) ?? null;
  }

  async upsert(input: {
    serverId: string;
    deviceId: string;
    deviceSecret: string;
    daemonPublicKeyB64: string;
  }): Promise<RelayDeviceCredential> {
    const now = new Date().toISOString();
    const all = await this.adapter.load();
    const existing = all.find((entry) => entry.serverId === input.serverId);
    const next: RelayDeviceCredential = {
      serverId: input.serverId,
      deviceId: input.deviceId,
      deviceSecret: input.deviceSecret,
      daemonPublicKeyB64: input.daemonPublicKeyB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const remaining = all.filter((entry) => entry.serverId !== input.serverId);
    remaining.push(next);
    await this.adapter.save(remaining);
    return next;
  }

  async remove(serverId: string): Promise<void> {
    const all = await this.adapter.load();
    await this.adapter.save(all.filter((entry) => entry.serverId !== serverId));
  }

  /**
   * Build a challenge+proof payload for hello.relayDeviceAuth.
   */
  buildProofAuth(input: {
    credential: RelayDeviceCredential;
    clientPublicKeyB64: string;
    challenge?: string;
  }): {
    deviceId: string;
    challenge: string;
    proof: string;
  } {
    const challenge = input.challenge ?? randomBase64UrlChallenge();
    const proof = computeClientRelayDeviceAuthProof(input.credential.deviceSecret, {
      serverId: input.credential.serverId,
      daemonPublicKeyB64: input.credential.daemonPublicKeyB64,
      clientPublicKeyB64: input.clientPublicKeyB64,
      deviceId: input.credential.deviceId,
      challenge,
    });
    return {
      deviceId: input.credential.deviceId,
      challenge,
      proof,
    };
  }

  /**
   * Build a first-time pairing payload for hello.relayDeviceAuth.
   */
  buildPairingAuth(input: {
    deviceId: string;
    pairingToken: string;
    clientPublicKeyB64?: string;
  }): {
    version: 1;
    deviceId: string;
    pairingToken: string;
    clientPublicKeyB64?: string;
  } {
    return {
      version: 1,
      deviceId: input.deviceId,
      pairingToken: input.pairingToken,
      ...(input.clientPublicKeyB64 ? { clientPublicKeyB64: input.clientPublicKeyB64 } : {}),
    };
  }
}

/**
 * Create a new random device id.
 */
export function createRelayDeviceId(): string {
  return `dev_${randomHex(16)}`;
}

/**
 * Compute HMAC-SHA256 proof over the canonical relay auth transcript.
 */
export function computeClientRelayDeviceAuthProof(
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
  return hmacSha256Base64Url(utf8Bytes(deviceSecret), utf8Bytes(transcript));
}
