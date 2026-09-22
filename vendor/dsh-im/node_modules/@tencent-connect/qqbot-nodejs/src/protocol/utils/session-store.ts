/**
 * Multi-account JSON-file session persistence for the WebSocket gateway.
 *
 * QQ Open Platform allows a bot to RESUME after a brief disconnect by
 * replaying the last `(session_id, lastSeq)` it observed. This module
 * persists that pair plus `intentLevelIndex` (so the auto-fallback logic
 * can resume at the right intent level on restart) into per-account JSON
 * files, with throttled writes and automatic expiry of stale sessions.
 *
 * Path resolution is delegated to the embedder via the constructor — the
 * SDK does not assume any particular directory layout.
 */

import fs from "node:fs";
import path from "node:path";
import { formatErrorMessage } from "./format.js";

/** Persisted gateway session state. */
export interface SessionState {
  sessionId: string | null;
  lastSeq: number | null;
  lastConnectedAt: number;
  intentLevelIndex: number;
  accountId: string;
  savedAt: number;
  appId?: string;
}

/** Optional logger contract used for diagnostic messages. */
export interface SessionStoreLogger {
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

/** Configuration for {@link FileSessionStore}. */
export interface FileSessionStoreOptions {
  /** Resolve the directory that holds session JSON files. */
  getDir: () => string;
  /** Ensure the directory exists. Called before writing. */
  ensureDir: () => void;
  /** Session expiry, in milliseconds. Defaults to 5 minutes. */
  expireMs?: number;
  /** Save throttle window, in milliseconds. Defaults to 1 second. */
  saveThrottleMs?: number;
  /** Optional logger. */
  logger?: SessionStoreLogger;
}

const NOOP_LOGGER: Required<SessionStoreLogger> = {
  log: () => {},
  error: () => {},
};

const DEFAULT_EXPIRE_MS = 5 * 60 * 1000;
const DEFAULT_SAVE_THROTTLE_MS = 1000;

/**
 * Multi-account file-backed gateway session store.
 *
 * One instance handles all accounts owned by a single QQ Bot deployment —
 * the per-account file path is derived deterministically from
 * `accountId`. The on-disk filename uses base64url(accountId) so any
 * Unicode/special-character account id is safe.
 */
export class FileSessionStore {
  private readonly options: Required<Omit<FileSessionStoreOptions, "logger">> & {
    logger: Required<SessionStoreLogger>;
  };

  private readonly throttleState = new Map<
    string,
    {
      pendingState: SessionState | null;
      lastSaveTime: number;
      throttleTimer: ReturnType<typeof setTimeout> | null;
    }
  >();

  constructor(options: FileSessionStoreOptions) {
    this.options = {
      getDir: options.getDir,
      ensureDir: options.ensureDir,
      expireMs: options.expireMs ?? DEFAULT_EXPIRE_MS,
      saveThrottleMs: options.saveThrottleMs ?? DEFAULT_SAVE_THROTTLE_MS,
      logger: {
        log: options.logger?.log ?? NOOP_LOGGER.log,
        error: options.logger?.error ?? NOOP_LOGGER.error,
      },
    };
  }

  /** Load a saved session, rejecting expired or mismatched-appId entries. */
  load(accountId: string, expectedAppId?: string): SessionState | null {
    try {
      let filePath: string | null = null;
      for (const candidatePath of this.getCandidateSessionPaths(accountId)) {
        if (fs.existsSync(candidatePath)) {
          filePath = candidatePath;
          break;
        }
      }
      if (!filePath) {
        return null;
      }

      const data = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(data) as SessionState;
      const now = Date.now();

      if (now - state.savedAt > this.options.expireMs) {
        this.options.logger.log(
          `[session-store] Session expired for ${accountId}, age: ${Math.round((now - state.savedAt) / 1000)}s`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup; ignore errors.
        }
        return null;
      }

      if (expectedAppId && state.appId && state.appId !== expectedAppId) {
        this.options.logger.log(
          `[session-store] appId mismatch for ${accountId}: saved=${state.appId}, current=${expectedAppId}. Discarding stale session.`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup; ignore errors.
        }
        return null;
      }

      if (!state.sessionId || state.lastSeq === null || state.lastSeq === undefined) {
        this.options.logger.log(`[session-store] Invalid session data for ${accountId}`);
        return null;
      }

      this.options.logger.log(
        `[session-store] Loaded session for ${accountId}: sessionId=${state.sessionId}, lastSeq=${state.lastSeq}, appId=${state.appId ?? "unknown"}, age=${Math.round((now - state.savedAt) / 1000)}s`,
      );
      return state;
    } catch (err) {
      this.options.logger.error(
        `[session-store] Failed to load session for ${accountId}: ${formatErrorMessage(err)}`,
      );
      return null;
    }
  }

  /** Save session state with throttling. */
  save(state: SessionState): void {
    const { accountId } = state;
    let throttle = this.throttleState.get(accountId);
    if (!throttle) {
      throttle = { pendingState: null, lastSaveTime: 0, throttleTimer: null };
      this.throttleState.set(accountId, throttle);
    }

    const now = Date.now();
    const timeSinceLastSave = now - throttle.lastSaveTime;

    if (timeSinceLastSave >= this.options.saveThrottleMs) {
      this.doSaveSession(state);
      throttle.lastSaveTime = now;
      throttle.pendingState = null;
      if (throttle.throttleTimer) {
        clearTimeout(throttle.throttleTimer);
        throttle.throttleTimer = null;
      }
    } else {
      throttle.pendingState = state;
      if (!throttle.throttleTimer) {
        const delay = this.options.saveThrottleMs - timeSinceLastSave;
        throttle.throttleTimer = setTimeout(() => {
          const t = this.throttleState.get(accountId);
          if (t?.pendingState) {
            this.doSaveSession(t.pendingState);
            t.lastSaveTime = Date.now();
            t.pendingState = null;
          }
          if (t) {
            t.throttleTimer = null;
          }
        }, delay);
      }
    }
  }

  /** Clear a saved session and any pending throttle state. */
  clear(accountId: string): void {
    const throttle = this.throttleState.get(accountId);
    if (throttle) {
      if (throttle.throttleTimer) {
        clearTimeout(throttle.throttleTimer);
      }
      this.throttleState.delete(accountId);
    }
    try {
      let cleared = false;
      for (const filePath of this.getCandidateSessionPaths(accountId)) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          cleared = true;
        }
      }
      if (cleared) {
        this.options.logger.log(`[session-store] Cleared session for ${accountId}`);
      }
    } catch (err) {
      this.options.logger.error(
        `[session-store] Failed to clear session for ${accountId}: ${formatErrorMessage(err)}`,
      );
    }
  }

  /** Update only lastSeq on the persisted session. */
  updateLastSeq(accountId: string, lastSeq: number): void {
    const existing = this.load(accountId);
    if (existing?.sessionId) {
      this.save({ ...existing, lastSeq });
    }
  }

  /** Load all saved sessions from disk. */
  getAllSessions(): SessionState[] {
    const sessions = new Map<string, SessionState>();
    try {
      const sessionDir = this.options.getDir();
      if (!fs.existsSync(sessionDir)) {
        return [];
      }
      const files = fs.readdirSync(sessionDir);

      for (const file of files) {
        if (this.isSessionFileName(file)) {
          try {
            const { state } = this.readSessionStateFile(file);
            if (typeof state.accountId !== "string" || !state.accountId) {
              continue;
            }
            const existing = sessions.get(state.accountId);
            if (!existing || (state.savedAt ?? 0) >= (existing.savedAt ?? 0)) {
              sessions.set(state.accountId, state);
            }
          } catch {
            // Skip malformed files; cleanup is opportunistic.
          }
        }
      }
    } catch {
      // Directory may not exist yet; return empty.
    }
    return [...sessions.values()];
  }

  /** Remove expired session files from disk. Returns number removed. */
  cleanupExpiredSessions(): number {
    let cleaned = 0;
    try {
      const sessionDir = this.options.getDir();
      if (!fs.existsSync(sessionDir)) {
        return 0;
      }
      const now = Date.now();
      const files = fs.readdirSync(sessionDir);

      for (const file of files) {
        if (this.isSessionFileName(file)) {
          const filePath = path.join(sessionDir, file);
          try {
            const { state } = this.readSessionStateFile(file);

            if (now - state.savedAt > this.options.expireMs) {
              fs.unlinkSync(filePath);
              cleaned++;
              this.options.logger.log(`[session-store] Cleaned expired session: ${file}`);
            }
          } catch {
            try {
              fs.unlinkSync(filePath);
              cleaned++;
            } catch {
              // Best-effort cleanup; ignore errors.
            }
          }
        }
      }
    } catch {
      // Directory may not exist yet; nothing to do.
    }
    return cleaned;
  }

  // ============ Internal ============

  private encodeAccountIdForFileName(accountId: string): string {
    return Buffer.from(accountId, "utf8").toString("base64url");
  }

  private getLegacySessionPath(accountId: string): string {
    const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.options.getDir(), `session-${safeId}.json`);
  }

  private getSessionPath(accountId: string): string {
    const encodedId = this.encodeAccountIdForFileName(accountId);
    return path.join(this.options.getDir(), `session-${encodedId}.json`);
  }

  private getCandidateSessionPaths(accountId: string): string[] {
    const primaryPath = this.getSessionPath(accountId);
    const legacyPath = this.getLegacySessionPath(accountId);
    return primaryPath === legacyPath ? [primaryPath] : [primaryPath, legacyPath];
  }

  private isSessionFileName(file: string): boolean {
    return file.startsWith("session-") && file.endsWith(".json");
  }

  private readSessionStateFile(file: string): { filePath: string; state: SessionState } {
    const filePath = path.join(this.options.getDir(), file);
    const data = fs.readFileSync(filePath, "utf-8");
    return { filePath, state: JSON.parse(data) as SessionState };
  }

  private doSaveSession(state: SessionState): void {
    const filePath = this.getSessionPath(state.accountId);
    const legacyPath = this.getLegacySessionPath(state.accountId);
    try {
      this.options.ensureDir();
      const stateToSave: SessionState = { ...state, savedAt: Date.now() };
      fs.writeFileSync(filePath, JSON.stringify(stateToSave, null, 2), "utf-8");
      if (legacyPath !== filePath && fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
      }
      this.options.logger.log(
        `[session-store] Saved session for ${state.accountId}: sessionId=${state.sessionId}, lastSeq=${state.lastSeq}`,
      );
    } catch (err) {
      this.options.logger.error(
        `[session-store] Failed to save session for ${state.accountId}: ${formatErrorMessage(err)}`,
      );
    }
  }
}
