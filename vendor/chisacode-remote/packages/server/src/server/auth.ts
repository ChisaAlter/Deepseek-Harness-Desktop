import { compare, compareSync, hashSync } from "bcryptjs";
import type { RequestHandler } from "express";

export const DAEMON_PASSWORD_BCRYPT_COST = 12;

export interface DaemonAuthConfig {
  password?: string;
}

export interface BearerAuthRejectContext {
  path: string;
  method: string;
  hasToken: boolean;
}

interface BearerValidationInput {
  password: string | undefined;
  token: string | null;
}

export function isBearerTokenValid(input: BearerValidationInput): boolean {
  return isBearerTokenValidSync(input);
}

export async function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean> {
  if (!input.password) {
    return true;
  }
  if (input.token === null) {
    return false;
  }

  return compare(input.token, input.password);
}

/**
 * Validates a bearer token against the daemon bcrypt hash synchronously.
 *
 * Use ONLY at startup or in CLI contexts — `compareSync` blocks the event loop
 * and will stall concurrent requests in a daemon handler. For request-path
 * validation use {@link isBearerTokenValidAsync} instead.
 *
 * @param input The configured password hash and the candidate token
 * @returns `true` if no password is configured (auth disabled) or the token matches
 */
export function isBearerTokenValidSync(input: BearerValidationInput): boolean {
  if (!input.password) {
    return true;
  }
  if (input.token === null) {
    return false;
  }

  return compareSync(input.token, input.password);
}

export function hashDaemonPassword(password: string): string {
  return hashSync(password, DAEMON_PASSWORD_BCRYPT_COST);
}

export function extractHttpBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  if (scheme !== "Bearer" || tokenParts.length !== 1) {
    return null;
  }
  return tokenParts[0] ?? null;
}

export function extractWsBearerProtocol(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  for (const protocol of value.split(",")) {
    const trimmed = protocol.trim();
    const segments = trimmed.split(".");
    if (segments[0] === "chisacode" && segments[1] === "bearer" && segments.length >= 3) {
      return trimmed;
    }
  }

  return null;
}

export function extractWsBearerToken(protocol: string | null): string | null {
  if (!protocol) {
    return null;
  }
  const segments = protocol.split(".");
  if (segments[0] !== "chisacode" || segments[1] !== "bearer" || segments.length < 3) {
    return null;
  }
  const token = segments.slice(2).join(".");
  // Reject empty token segments — `compare("", hash)` always returns false but
  // still burns a bcrypt round (cost=12), so a peer spamming
  // `chisacode.bearer.` subprotocol headers amplifies CPU cost. Cap length too
  // (bcryptjs only uses the first 72 bytes, longer inputs just waste memory).
  if (token.length === 0 || token.length > 1024) {
    return null;
  }
  return token;
}

export function createRequireBearerMiddleware(
  auth: DaemonAuthConfig | undefined,
  onReject?: (context: BearerAuthRejectContext) => void,
): RequestHandler {
  const password = auth?.password;
  return (req, res, next) => {
    if (!password || shouldBypassBearerAuth(req.method, req.path)) {
      next();
      return;
    }

    void (async () => {
      try {
        const token = extractHttpBearerToken(req.header("authorization"));
        if (!(await isBearerTokenValidAsync({ password, token }))) {
          onReject?.({
            path: req.path,
            method: req.method,
            hasToken: token !== null,
          });
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

export function shouldBypassBearerAuth(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  // Prefix match so future sub-paths (e.g. `/api/health/:section`) stay bypassed
  // without forcing every router addition to also revisit this gate.
  return (
    path === "/api/health" ||
    path.startsWith("/api/health/") ||
    path === "/api/source" ||
    path.startsWith("/api/source/")
  );
}
