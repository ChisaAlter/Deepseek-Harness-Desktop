/** Native operations required to manage the Android foreground service. */
export interface AndroidForegroundServiceRuntime {
  startForegroundService(text: string): Promise<void>;
  stopForegroundService(): Promise<void>;
}

interface AndroidForegroundServiceReconcilerOptions {
  loadRuntime: () => Promise<AndroidForegroundServiceRuntime>;
  onError?: (error: unknown) => void;
}

/** Serialized foreground-service lifecycle controller. */
export interface AndroidForegroundServiceReconciler {
  setDesired(shouldRun: boolean): void;
  dispose(): void;
  whenIdle(): Promise<void>;
}

class ForegroundServiceReconciler implements AndroidForegroundServiceReconciler {
  private actual = false;
  private desired = false;
  private disposed = false;
  private revision = 0;
  private failedRevision = -1;
  private processing: Promise<void> | null = null;
  private runtimePromise: Promise<AndroidForegroundServiceRuntime> | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: AndroidForegroundServiceReconcilerOptions) {}

  setDesired(shouldRun: boolean): void {
    if (this.disposed || this.desired === shouldRun) return;
    this.desired = shouldRun;
    this.revision += 1;
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = false;
    this.revision += 1;
    this.schedule();
  }

  whenIdle(): Promise<void> {
    if (!this.processing) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private schedule(): void {
    if (this.processing) return;
    this.processing = this.reconcile().finally(() => {
      this.processing = null;
      if (this.actual !== this.desired && this.failedRevision !== this.revision) {
        this.schedule();
        return;
      }
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    });
  }

  private async reconcile(): Promise<void> {
    while (this.actual !== this.desired) {
      const target = this.desired;
      const operationRevision = this.revision;
      try {
        this.runtimePromise ??= this.options.loadRuntime();
        const runtime = await this.runtimePromise;
        if (target && (this.disposed || !this.desired)) {
          continue;
        }
        if (target) {
          await runtime.startForegroundService("ChisaCode");
        } else {
          await runtime.stopForegroundService();
        }
        this.actual = target;
      } catch (error: unknown) {
        this.runtimePromise = null;
        this.failedRevision = operationRevision;
        this.options.onError?.(error);
        return;
      }
    }
  }
}

/**
 * Creates a serialized controller for the Android foreground-service lifecycle.
 * @param options Lazy native runtime loader and bounded error callback
 * @returns A reconciler that converges native state to the latest desired state
 */
export function createAndroidForegroundServiceReconciler(
  options: AndroidForegroundServiceReconcilerOptions,
): AndroidForegroundServiceReconciler {
  return new ForegroundServiceReconciler(options);
}
