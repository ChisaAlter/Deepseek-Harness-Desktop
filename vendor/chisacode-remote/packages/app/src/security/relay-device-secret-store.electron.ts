import AsyncStorage from "@react-native-async-storage/async-storage";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  assertRelayDeviceSecretInput,
  type RelayDeviceSecretStore,
} from "./relay-device-secret-store-core";

const KEY_PREFIX = "@chisacode:relay-device-secret:";

function storageKey(deviceId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(deviceId)}`;
}

class ElectronRelayDeviceSecretStore implements RelayDeviceSecretStore {
  async get(deviceId: string): Promise<string | null> {
    assertRelayDeviceSecretInput(deviceId);
    const ciphertextB64 = await AsyncStorage.getItem(storageKey(deviceId));
    if (!ciphertextB64) {
      return null;
    }
    const result = await invokeDesktopCommand<{ deviceSecret: string }>(
      "decrypt_relay_device_secret",
      { ciphertextB64 },
    );
    assertRelayDeviceSecretInput(deviceId, result.deviceSecret);
    return result.deviceSecret;
  }

  async set(deviceId: string, deviceSecret: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId, deviceSecret);
    const result = await invokeDesktopCommand<{ ciphertextB64: string }>(
      "encrypt_relay_device_secret",
      { deviceSecret },
    );
    await AsyncStorage.setItem(storageKey(deviceId), result.ciphertextB64);
  }

  async remove(deviceId: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId);
    await AsyncStorage.removeItem(storageKey(deviceId));
  }
}

/** Relay device secrets encrypted by Electron safeStorage before persistence. */
export const relayDeviceSecretStore: RelayDeviceSecretStore = new ElectronRelayDeviceSecretStore();
