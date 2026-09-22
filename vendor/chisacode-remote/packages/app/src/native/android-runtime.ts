/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * No-op stub for platforms that don't support the Android runtime module.
 */
export async function startForegroundService(_text: string): Promise<void> {
  // no-op on non-Android platforms
}

export async function updateForegroundServiceText(_text: string): Promise<void> {
  // no-op on non-Android platforms
}

export async function stopForegroundService(): Promise<void> {
  // no-op on non-Android platforms
}

export async function sendLocalNotification(
  _title: string,
  _body: string,
  _data?: Record<string, unknown>,
): Promise<void> {
  // no-op on non-Android platforms
}

/** Returns no launch notification data on unsupported platforms. */
export async function consumeInitialNotificationData(): Promise<null> {
  return null;
}

/**
 * Returns a no-op notification listener cleanup function on unsupported platforms.
 * @param _handler Ignored notification response handler
 * @returns A no-op cleanup function
 */
export function subscribeNotificationResponses(_handler: () => void): () => void {
  return () => {};
}
