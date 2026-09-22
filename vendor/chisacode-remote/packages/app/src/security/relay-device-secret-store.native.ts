import * as SecureStore from "expo-secure-store";
import {
  assertRelayDeviceSecretInput,
  type RelayDeviceSecretStore,
} from "./relay-device-secret-store-core";

const KEY_PREFIX = "chisacode.relay.device.";
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "chisacode.relay.device.credentials",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function assertAvailable(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error("Platform secure storage is unavailable");
  }
}

class NativeRelayDeviceSecretStore implements RelayDeviceSecretStore {
  async get(deviceId: string): Promise<string | null> {
    assertRelayDeviceSecretInput(deviceId);
    await assertAvailable();
    return await SecureStore.getItemAsync(`${KEY_PREFIX}${deviceId}`, STORE_OPTIONS);
  }

  async set(deviceId: string, deviceSecret: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId, deviceSecret);
    await assertAvailable();
    await SecureStore.setItemAsync(`${KEY_PREFIX}${deviceId}`, deviceSecret, STORE_OPTIONS);
  }

  async remove(deviceId: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId);
    await assertAvailable();
    await SecureStore.deleteItemAsync(`${KEY_PREFIX}${deviceId}`, STORE_OPTIONS);
  }
}

/** Relay device secrets backed by Android Keystore or iOS Keychain. */
export const relayDeviceSecretStore: RelayDeviceSecretStore = new NativeRelayDeviceSecretStore();
