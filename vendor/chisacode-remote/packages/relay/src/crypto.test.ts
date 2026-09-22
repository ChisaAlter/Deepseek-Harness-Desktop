import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
  SALT_LENGTH,
} from "./crypto.js";

function randomSalt(): Uint8Array {
  return nacl.randomBytes(SALT_LENGTH);
}

describe("crypto", () => {
  describe("generateKeyPair", () => {
    it("generates a valid keypair", () => {
      const keypair = generateKeyPair();
      expect(keypair.secretKey).toBeDefined();
      expect(keypair.publicKey).toBeDefined();
    });
  });

  describe("exportPublicKey / importPublicKey", () => {
    it("roundtrips public key through base64", () => {
      const keypair = generateKeyPair();
      const exported = exportPublicKey(keypair.publicKey);

      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);

      const imported = importPublicKey(exported);
      expect(imported).toBeDefined();

      // Re-export should match
      const reExported = exportPublicKey(imported);
      expect(reExported).toBe(exported);
    });
  });

  describe("deriveSharedKey", () => {
    it("derives the same key on both sides", () => {
      // Simulate daemon and client
      const daemonKeyPair = generateKeyPair();
      const clientKeyPair = generateKeyPair();

      // Export public keys (what would go over the wire)
      const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
      const clientPubKeyB64 = exportPublicKey(clientKeyPair.publicKey);

      // Import peer's public key
      const daemonSeesClientPubKey = importPublicKey(clientPubKeyB64);
      const clientSeesDaemonPubKey = importPublicKey(daemonPubKeyB64);

      // Derive shared keys
      const daemonSharedKey = deriveSharedKey(daemonKeyPair.secretKey, daemonSeesClientPubKey);
      const clientSharedKey = deriveSharedKey(clientKeyPair.secretKey, clientSeesDaemonPubKey);

      // Both should derive the same key - test by encrypting with one, decrypting with other
      const testMessage = "Hello, encrypted world!";
      const encrypted = encrypt(daemonSharedKey, testMessage, 0n, randomSalt());
      const decrypted = decrypt(clientSharedKey, encrypted);

      expect(decrypted.plaintext).toBe(testMessage);
    });
  });

  describe("encrypt / decrypt", () => {
    it("roundtrips a string message", () => {
      const daemonKeyPair = generateKeyPair();
      const clientKeyPair = generateKeyPair();
      const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientKeyPair.publicKey);

      const plaintext = "Test message with unicode: 你好世界 🎉";
      const ciphertext = encrypt(sharedKey, plaintext, 0n, randomSalt());

      expect(ciphertext).toBeInstanceOf(ArrayBuffer);
      expect(ciphertext.byteLength).toBeGreaterThan(plaintext.length);

      const decrypted = decrypt(sharedKey, ciphertext);
      expect(decrypted.plaintext).toBe(plaintext);
    });

    it("roundtrips binary data", () => {
      const daemonKeyPair = generateKeyPair();
      const clientKeyPair = generateKeyPair();
      const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientKeyPair.publicKey);

      const binary = new Uint8Array([0, 1, 2, 255, 254, 253]);
      const ciphertext = encrypt(sharedKey, binary.buffer, 0n, randomSalt());

      const decrypted = decrypt(sharedKey, ciphertext);
      expect(new Uint8Array(decrypted.plaintext as ArrayBuffer)).toEqual(binary);
    });

    it("fails to decrypt with wrong key", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const keypair3 = generateKeyPair();

      const correctKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);
      const wrongKey = deriveSharedKey(keypair1.secretKey, keypair3.publicKey);

      const ciphertext = encrypt(correctKey, "secret", 0n, randomSalt());

      const tryDecrypt = () => decrypt(wrongKey, ciphertext);
      expect(tryDecrypt).toThrow();
    });

    it("produces identical ciphertext for same plaintext, seq, and salt (deterministic nonce)", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const plaintext = "Same message";
      const salt = randomSalt();
      const ciphertext1 = encrypt(sharedKey, plaintext, 0n, salt);
      const ciphertext2 = encrypt(sharedKey, plaintext, 0n, salt);

      // Deterministic nonce derivation: same inputs => identical ciphertext
      const arr1 = new Uint8Array(ciphertext1);
      const arr2 = new Uint8Array(ciphertext2);
      expect(arr1).toEqual(arr2);

      // Both decrypt to the same plaintext
      expect(decrypt(sharedKey, ciphertext1).plaintext).toBe(plaintext);
      expect(decrypt(sharedKey, ciphertext2).plaintext).toBe(plaintext);
    });

    it("produces different ciphertext for different seq (counter nonce)", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const plaintext = "Same message";
      const salt = randomSalt();
      const ciphertext1 = encrypt(sharedKey, plaintext, 0n, salt);
      const ciphertext2 = encrypt(sharedKey, plaintext, 1n, salt);

      // Different seq => different nonce => different ciphertext
      expect(new Uint8Array(ciphertext1)).not.toEqual(new Uint8Array(ciphertext2));

      // Both decrypt to the same plaintext, with seqs reported back
      const d1 = decrypt(sharedKey, ciphertext1);
      const d2 = decrypt(sharedKey, ciphertext2);
      expect(d1.plaintext).toBe(plaintext);
      expect(d2.plaintext).toBe(plaintext);
      expect(d1.seq).toBe(0n);
      expect(d2.seq).toBe(1n);
    });

    it("produces different ciphertext for different salt", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const plaintext = "Same message";
      const ciphertext1 = encrypt(sharedKey, plaintext, 0n, randomSalt());
      const ciphertext2 = encrypt(sharedKey, plaintext, 0n, randomSalt());

      expect(new Uint8Array(ciphertext1)).not.toEqual(new Uint8Array(ciphertext2));
    });

    it("rejects invalid salt length", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const badSalt = nacl.randomBytes(15); // wrong length
      const act = (): ArrayBuffer => encrypt(sharedKey, "x", 0n, badSalt);
      expect(act).toThrow(/Invalid salt length/);
    });

    it("rejects negative seq", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const act = (): ArrayBuffer => encrypt(sharedKey, "x", -1n, randomSalt());
      expect(act).toThrow(/non-negative/);
    });

    it("reports seq and salt extracted from the nonce on decrypt", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const salt = randomSalt();
      const seq = 42n;
      const ciphertext = encrypt(sharedKey, "payload", seq, salt);

      const result = decrypt(sharedKey, ciphertext);
      expect(result.seq).toBe(seq);
      expect(result.salt.byteLength).toBe(SALT_LENGTH);
      expect(Array.from(result.salt)).toEqual(Array.from(salt));
    });
  });

  describe("full handshake simulation", () => {
    it("simulates complete daemon<->client key exchange", () => {
      // === DAEMON SIDE (generates session) ===
      const daemonKeyPair = generateKeyPair();
      const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

      // QR code would contain: { serverId, daemonPubKeyB64, relay: { endpoint } }

      // === CLIENT SIDE (scans QR) ===
      const clientKeyPair = generateKeyPair();
      const clientPubKeyB64 = exportPublicKey(clientKeyPair.publicKey);

      // Client imports daemon's public key from QR
      const daemonPubKeyOnClient = importPublicKey(daemonPubKeyB64);

      // Client derives shared key
      const clientSharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonPubKeyOnClient);

      // Client sends hello: { type: "hello", key: clientPubKeyB64 }

      // === DAEMON SIDE (receives hello) ===
      // Daemon imports client's public key from hello message
      const clientPubKeyOnDaemon = importPublicKey(clientPubKeyB64);

      // Daemon derives shared key
      const daemonSharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPubKeyOnDaemon);

      // === VERIFY BOTH HAVE SAME KEY ===
      const testFromDaemon = "Message from daemon";
      const testFromClient = "Message from client";

      // Each direction has its own salt; seqs are per-direction.
      const daemonSalt = randomSalt();
      const clientSalt = randomSalt();

      // Daemon encrypts, client decrypts
      const encryptedFromDaemon = encrypt(daemonSharedKey, testFromDaemon, 0n, daemonSalt);
      expect(decrypt(clientSharedKey, encryptedFromDaemon).plaintext).toBe(testFromDaemon);

      // Client encrypts, daemon decrypts
      const encryptedFromClient = encrypt(clientSharedKey, testFromClient, 0n, clientSalt);
      expect(decrypt(daemonSharedKey, encryptedFromClient).plaintext).toBe(testFromClient);
    });
  });

  describe("replay protection at the crypto layer", () => {
    it("a replayed bundle decrypts successfully but yields the original seq (caller must enforce monotonicity)", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const salt = randomSalt();
      const original = encrypt(sharedKey, "do thing", 5n, salt);

      // An attacker replays the exact bytes. decrypt() succeeds (the MAC is
      // valid) and returns the original seq — it is the caller's job (the
      // EncryptedChannel) to reject seq <= lastSeen.
      const replayed = decrypt(sharedKey, original);
      expect(replayed.seq).toBe(5n);
      expect(replayed.plaintext).toBe("do thing");
    });

    it("round-trips at the 64-bit seq boundary", () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const sharedKey = deriveSharedKey(keypair1.secretKey, keypair2.publicKey);

      const salt = randomSalt();
      const boundary = 0xfffffffffffffffn;
      const ciphertext = encrypt(sharedKey, "edge", boundary, salt);
      const result = decrypt(sharedKey, ciphertext);
      expect(result.seq).toBe(boundary);
      expect(result.plaintext).toBe("edge");
    });
  });
});
