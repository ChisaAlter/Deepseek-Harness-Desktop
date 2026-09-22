import {
  MemoryRelayDeviceSecretStore,
  type RelayDeviceSecretStore,
} from "./relay-device-secret-store-core";

/** Session-only fallback used by non-platform TypeScript consumers. */
export const relayDeviceSecretStore: RelayDeviceSecretStore = new MemoryRelayDeviceSecretStore();

export type { RelayDeviceSecretStore } from "./relay-device-secret-store-core";
