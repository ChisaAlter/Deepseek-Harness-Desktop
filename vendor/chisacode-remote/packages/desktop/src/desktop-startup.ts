export interface DesktopStartupDependencies {
  hasPendingOpenProjectPath: boolean;
  runCliPassthroughIfRequested: () => Promise<boolean>;
  /**
   * Synchronous login-shell environment inheritance. Kept for backward
   * compatibility — callers that need results before the first import may
   * depend on the synchronous path. New callers should use
   * {@link inheritLoginShellEnvAsync} to avoid blocking startup.
   */
  inheritLoginShellEnv: () => void;
  /**
   * Async login-shell environment inheritance. Runs in parallel with
   * bootstrapGui() so the shell resolution no longer blocks window creation
   * (saves 2–5 s on macOS/Linux cold starts from Finder/Dock).
   */
  inheritLoginShellEnvAsync: () => Promise<void>;
  bootstrapGui: () => Promise<void>;
}

export async function runDesktopStartup(deps: DesktopStartupDependencies): Promise<void> {
  if (!deps.hasPendingOpenProjectPath && (await deps.runCliPassthroughIfRequested())) {
    return;
  }

  // Run login-shell env resolution in parallel with GUI bootstrap.
  // The sync call still runs first for code that reads process.env during
  // module init (before the async result lands). On Windows this is a no-op.
  deps.inheritLoginShellEnv();
  await Promise.all([deps.inheritLoginShellEnvAsync(), deps.bootstrapGui()]);
}
