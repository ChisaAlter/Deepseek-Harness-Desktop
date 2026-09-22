import type { AndroidNotificationData } from "@/utils/notification-routing";

interface AndroidNotificationDrainControllerOptions {
  drain: () => Promise<AndroidNotificationData | null>;
  onData: (data: AndroidNotificationData) => void;
  onError?: (error: unknown) => void;
}

/** Serialized controller for cold-launch and warm-intent notification drain requests. */
export interface AndroidNotificationDrainController {
  requestDrain(): void;
  dispose(): void;
  whenIdle(): Promise<void>;
}

class NotificationDrainController implements AndroidNotificationDrainController {
  private disposed = false;
  private pending = false;
  private processing: Promise<void> | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: AndroidNotificationDrainControllerOptions) {}

  requestDrain(): void {
    if (this.disposed) return;
    this.pending = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.processing) return;
    this.processing = this.drainLoop().finally(() => {
      this.processing = null;
      if (this.pending && !this.disposed) {
        this.schedule();
        return;
      }
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pending = false;
  }

  whenIdle(): Promise<void> {
    if (!this.processing) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drainLoop(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false;
      try {
        const data = await this.options.drain();
        if (!this.disposed && data) {
          this.options.onData(data);
        }
      } catch (error: unknown) {
        this.options.onError?.(error);
      }
    }
  }
}

/**
 * Creates a serialized, coalescing controller for draining durable Android notification data.
 * @param options Native drain operation and validated delivery callbacks
 * @returns A controller for initial and wake-signal drain requests
 */
export function createAndroidNotificationDrainController(
  options: AndroidNotificationDrainControllerOptions,
): AndroidNotificationDrainController {
  return new NotificationDrainController(options);
}
