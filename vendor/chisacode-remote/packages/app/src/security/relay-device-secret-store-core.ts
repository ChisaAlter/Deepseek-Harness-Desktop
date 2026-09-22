const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const MIN_DEVICE_SECRET_LENGTH = 32;

/** Platform storage contract for relay device secrets. */
export interface RelayDeviceSecretStore {
  get(deviceId: string): Promise<string | null>;
  set(deviceId: string, deviceSecret: string): Promise<void>;
  remove(deviceId: string): Promise<void>;
}

export function assertRelayDeviceSecretInput(deviceId: string, deviceSecret?: string): void {
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Error("Invalid relay device id");
  }
  if (deviceSecret !== undefined && deviceSecret.length < MIN_DEVICE_SECRET_LENGTH) {
    throw new Error("Invalid relay device secret");
  }
}

/** Session-only store used where persistent platform secret storage is unavailable. */
export class MemoryRelayDeviceSecretStore implements RelayDeviceSecretStore {
  private readonly secrets = new Map<string, string>();

  async get(deviceId: string): Promise<string | null> {
    assertRelayDeviceSecretInput(deviceId);
    return this.secrets.get(deviceId) ?? null;
  }

  async set(deviceId: string, deviceSecret: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId, deviceSecret);
    this.secrets.set(deviceId, deviceSecret);
  }

  async remove(deviceId: string): Promise<void> {
    assertRelayDeviceSecretInput(deviceId);
    this.secrets.delete(deviceId);
  }
}
