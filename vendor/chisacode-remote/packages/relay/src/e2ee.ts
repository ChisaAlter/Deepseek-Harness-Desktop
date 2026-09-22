export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type {
  Transport,
  EncryptedChannelEvents,
  EncryptedChannelSecurityContext,
} from "./encrypted-channel.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
  generateRelayAuthKeyPair,
  exportRelayAuthPublicKey,
  importRelayAuthPublicKey,
  exportRelayAuthSecretKey,
  importRelayAuthSecretKey,
  signRelayServerAuth,
  verifyRelayServerAuth,
  encrypt,
  decrypt,
  deriveSharedKey,
  SALT_LENGTH,
  SEQ_LENGTH,
} from "./crypto.js";
export type { KeyPair, RelayAuthKeyPair, SharedKey, DecryptResult } from "./crypto.js";
