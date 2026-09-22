import {
  MemoryRelayDeviceSecretStore,
  type RelayDeviceSecretStore,
} from "./relay-device-secret-store-core";

/** Browser relay credentials intentionally live only for the current page session. */
export const relayDeviceSecretStore: RelayDeviceSecretStore = new MemoryRelayDeviceSecretStore();
