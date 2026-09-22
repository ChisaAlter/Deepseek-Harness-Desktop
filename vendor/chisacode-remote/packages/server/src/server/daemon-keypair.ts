import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v3";
import type pino from "pino";

import {
  generateKeyPair,
  exportPublicKey,
  exportSecretKey,
  generateRelayAuthKeyPair,
  exportRelayAuthPublicKey,
  exportRelayAuthSecretKey,
  importRelayAuthPublicKey,
  importRelayAuthSecretKey,
  importPublicKey,
  importSecretKey,
  type KeyPair,
  type RelayAuthKeyPair,
} from "@chisacode/relay/e2ee";
import { ensurePrivateFile, writePrivateFileSync } from "./private-files.js";

const KeyPairSchema = z.object({
  v: z.literal(2),
  publicKeyB64: z.string().min(1),
  secretKeyB64: z.string().min(1),
  relayAuthPublicKeyB64: z.string().min(1).optional(),
  relayAuthSecretKeyB64: z.string().min(1).optional(),
});

type StoredKeyPair = z.infer<typeof KeyPairSchema>;

const KEYPAIR_FILENAME = "daemon-keypair.json";

export interface DaemonKeyPairBundle {
  keyPair: KeyPair;
  publicKeyB64: string;
  relayAuthKeyPair: RelayAuthKeyPair;
  relayAuthPublicKeyB64: string;
}

export async function loadOrCreateDaemonKeyPair(
  chisacodeHome: string,
  logger?: pino.Logger,
): Promise<DaemonKeyPairBundle> {
  const log = logger?.child({ module: "daemon-keypair" });
  const filePath = path.join(chisacodeHome, KEYPAIR_FILENAME);

  if (existsSync(filePath)) {
    try {
      ensurePrivateFile(filePath);
      const raw = readFileSync(filePath, "utf8");
      const parsed = KeyPairSchema.parse(JSON.parse(raw));

      const publicKey = importPublicKey(parsed.publicKeyB64);
      const secretKey = importSecretKey(parsed.secretKeyB64);
      const publicKeyB64 = exportPublicKey(publicKey);
      const relayAuthKeyPair =
        parsed.relayAuthPublicKeyB64 && parsed.relayAuthSecretKeyB64
          ? {
              publicKey: importRelayAuthPublicKey(parsed.relayAuthPublicKeyB64),
              secretKey: importRelayAuthSecretKey(parsed.relayAuthSecretKeyB64),
            }
          : generateRelayAuthKeyPair();
      const relayAuthPublicKeyB64 = exportRelayAuthPublicKey(relayAuthKeyPair.publicKey);

      if (!parsed.relayAuthPublicKeyB64 || !parsed.relayAuthSecretKeyB64) {
        const upgradedPayload: StoredKeyPair = {
          ...parsed,
          relayAuthPublicKeyB64,
          relayAuthSecretKeyB64: exportRelayAuthSecretKey(relayAuthKeyPair.secretKey),
        };
        writePrivateFileSync(filePath, JSON.stringify(upgradedPayload, null, 2) + "\n");
      }
      log?.info({ filePath }, "Loaded daemon keypair");
      return {
        keyPair: { publicKey, secretKey },
        publicKeyB64,
        relayAuthKeyPair,
        relayAuthPublicKeyB64,
      };
    } catch (error) {
      log?.warn({ err: error, filePath }, "Failed to load daemon keypair, regenerating");
    }
  }

  const keyPair = generateKeyPair();
  const relayAuthKeyPair = generateRelayAuthKeyPair();
  const publicKeyB64 = exportPublicKey(keyPair.publicKey);
  const secretKeyB64 = exportSecretKey(keyPair.secretKey);
  const relayAuthPublicKeyB64 = exportRelayAuthPublicKey(relayAuthKeyPair.publicKey);
  const relayAuthSecretKeyB64 = exportRelayAuthSecretKey(relayAuthKeyPair.secretKey);

  const payload: StoredKeyPair = {
    v: 2,
    publicKeyB64,
    secretKeyB64,
    relayAuthPublicKeyB64,
    relayAuthSecretKeyB64,
  };

  writePrivateFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
  log?.info({ filePath }, "Saved daemon keypair");

  return { keyPair, publicKeyB64, relayAuthKeyPair, relayAuthPublicKeyB64 };
}
