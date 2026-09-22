import http from "node:http";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { Logger } from "pino";
import type { RequestHandler } from "express";
import type { DaemonAuthConfig } from "./auth.js";
import { extractWsBearerProtocol, extractWsBearerToken, isBearerTokenValidAsync } from "./auth.js";
import type { HostnamesConfig } from "./hostnames.js";
import { isHostnameAllowed } from "./hostnames.js";

// ---------------------------------------------------------------------------
// Hop-by-hop headers that must not be forwarded
// ---------------------------------------------------------------------------

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

const SCRIPT_PROXY_UPSTREAM_MAX_HEADER_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// ScriptRouteStore
// ---------------------------------------------------------------------------

export interface ScriptRoute {
  hostname: string;
  port: number;
}

export interface ScriptRouteEntry extends ScriptRoute {
  workspaceId: string;
  projectSlug: string;
  scriptName: string;
}

export interface ScriptProxyUpgradeDecision {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly reason: string;
}

export interface ScriptProxyUpgradeGuard {
  readonly auth?: DaemonAuthConfig;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly hostnames?: HostnamesConfig;
  readonly allowUpgradeRequest?: (req: IncomingMessage) => ScriptProxyUpgradeDecision;
}

export class ScriptRouteStore {
  private routes = new Map<string, ScriptRouteEntry>();
  private workspaceHostnames = new Map<string, Set<string>>();

  registerRoute(entry: ScriptRouteEntry): void {
    const previous = this.routes.get(entry.hostname);
    if (previous) {
      this.removeHostnameFromWorkspaceIndex(previous.workspaceId, previous.hostname);
    }

    const storedEntry = { ...entry };
    this.routes.set(storedEntry.hostname, storedEntry);
    this.addHostnameToWorkspaceIndex(storedEntry.workspaceId, storedEntry.hostname);
  }

  removeRoute(hostname: string): void {
    const entry = this.routes.get(hostname);
    if (!entry) {
      return;
    }
    this.routes.delete(hostname);
    this.removeHostnameFromWorkspaceIndex(entry.workspaceId, hostname);
  }

  removeRouteForWorkspaceScript(params: { workspaceId: string; scriptName: string }): void {
    const routes = this.listRoutesForWorkspace(params.workspaceId);
    const route = routes.find((entry) => entry.scriptName === params.scriptName);
    if (!route) {
      return;
    }
    this.removeRoute(route.hostname);
  }

  removeRoutesForPort(port: number): void {
    for (const [hostname, entry] of this.routes) {
      if (entry.port === port) {
        this.routes.delete(hostname);
        this.removeHostnameFromWorkspaceIndex(entry.workspaceId, hostname);
      }
    }
  }

  findRoute(host: string): ScriptRoute | null {
    // Strip port suffix from the Host header value
    const hostname = host.replace(/:\d+$/, "");

    // 1. Exact match
    const exactRoute = this.routes.get(hostname);
    if (exactRoute !== undefined) {
      return { hostname: exactRoute.hostname, port: exactRoute.port };
    }

    // 2. Subdomain match — walk up the labels looking for a registered parent
    const parts = hostname.split(".");
    for (let i = 1; i < parts.length; i++) {
      const candidate = parts.slice(i).join(".");
      const candidateRoute = this.routes.get(candidate);
      if (candidateRoute !== undefined) {
        return { hostname: candidateRoute.hostname, port: candidateRoute.port };
      }
    }

    return null;
  }

  getRouteEntry(hostname: string): ScriptRouteEntry | null {
    const entry = this.routes.get(hostname);
    return entry ? { ...entry } : null;
  }

  listRoutes(): ScriptRouteEntry[] {
    return Array.from(this.routes.values()).map((entry) => Object.assign({}, entry));
  }

  listRoutesForWorkspace(workspaceId: string): ScriptRouteEntry[] {
    const hostnames = this.workspaceHostnames.get(workspaceId);
    if (!hostnames) {
      return [];
    }

    const routes: ScriptRouteEntry[] = [];
    for (const hostname of hostnames) {
      const entry = this.routes.get(hostname);
      if (entry) {
        routes.push({ ...entry });
      }
    }
    return routes;
  }

  private addHostnameToWorkspaceIndex(workspaceId: string, hostname: string): void {
    const hostnames = this.workspaceHostnames.get(workspaceId) ?? new Set<string>();
    hostnames.add(hostname);
    this.workspaceHostnames.set(workspaceId, hostnames);
  }

  private removeHostnameFromWorkspaceIndex(workspaceId: string, hostname: string): void {
    const hostnames = this.workspaceHostnames.get(workspaceId);
    if (!hostnames) {
      return;
    }

    hostnames.delete(hostname);
    if (hostnames.size === 0) {
      this.workspaceHostnames.delete(workspaceId);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHopByHopHeaders(
  rawHeaders: http.IncomingHttpHeaders,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeForwardedHeaders(
  rawHeaders: http.IncomingHttpHeaders,
): Record<string, string | string[]> {
  const forwardedHeaders = stripHopByHopHeaders(rawHeaders);
  delete forwardedHeaders.authorization;
  return forwardedHeaders;
}

function sanitizeWebSocketProtocols(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const protocols = value
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0 && extractWsBearerProtocol(protocol) !== protocol);
  return protocols.length > 0 ? protocols.join(", ") : undefined;
}

function getResponseStatusLine(response: IncomingMessage): string {
  const statusCode = response.statusCode ?? 502;
  const statusMessage = response.statusMessage ?? http.STATUS_CODES[statusCode] ?? "";
  const reason = statusMessage.length > 0 ? ` ${statusMessage}` : "";
  return `HTTP/${response.httpVersion} ${statusCode}${reason}`;
}

function appendHeaderLines(lines: string[], headers: Record<string, string | string[]>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`${key}: ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
}

function serializeUpgradeResponseHead(
  response: IncomingMessage,
  fallbackProtocol: string | null,
): string {
  const lines = [getResponseStatusLine(response)];
  let hasSelectedProtocol = false;

  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name === undefined || value === undefined) {
      continue;
    }
    if (name.toLowerCase() === "sec-websocket-protocol") {
      hasSelectedProtocol = true;
    }
    lines.push(`${name}: ${value}`);
  }

  if (!hasSelectedProtocol && fallbackProtocol !== null) {
    lines.push(`Sec-WebSocket-Protocol: ${fallbackProtocol}`);
  }
  lines.push("", "");
  return lines.join("\r\n");
}

function forwardNonUpgradeResponse(response: IncomingMessage, socket: net.Socket): void {
  const headers = stripHopByHopHeaders(response.headers);
  headers.connection = "close";
  const lines = [getResponseStatusLine(response)];
  appendHeaderLines(lines, headers);
  lines.push("", "");
  socket.write(lines.join("\r\n"));
  response.pipe(socket, { end: true });
}

function sameOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin || !hostHeader) return false;
  return origin === `http://${hostHeader}` || origin === `https://${hostHeader}`;
}

function rejectUpgrade(socket: net.Socket, statusCode: number, reason: string): void {
  const body = `${statusCode} ${reason}`;
  socket.end(
    [
      `HTTP/1.1 ${statusCode} ${reason}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body,
    ].join("\r\n"),
  );
  socket.destroy();
}

async function authorizeScriptProxyUpgrade(params: {
  req: IncomingMessage;
  hostHeader: string;
  guard: ScriptProxyUpgradeGuard | undefined;
}): Promise<ScriptProxyUpgradeDecision> {
  const { req, hostHeader, guard } = params;
  if (!guard) {
    return { allowed: true, statusCode: 200, reason: "OK" };
  }

  if (!isHostnameAllowed(hostHeader, guard.hostnames)) {
    return { allowed: false, statusCode: 403, reason: "Host not allowed" };
  }

  const limitDecision = guard.allowUpgradeRequest?.(req);
  if (limitDecision && !limitDecision.allowed) {
    return limitDecision;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (
    origin &&
    !guard.allowedOrigins.has("*") &&
    !guard.allowedOrigins.has(origin) &&
    !sameOrigin(origin, hostHeader)
  ) {
    return { allowed: false, statusCode: 403, reason: "Origin not allowed" };
  }

  const password = guard.auth?.password;
  if (!password) {
    return { allowed: true, statusCode: 200, reason: "OK" };
  }

  const protocol = extractWsBearerProtocol(req.headers["sec-websocket-protocol"]);
  const token = extractWsBearerToken(protocol);
  const isAuthorized = await isBearerTokenValidAsync({ password, token });
  if (!isAuthorized) {
    return {
      allowed: false,
      statusCode: 401,
      reason: token === null ? "Password required" : "Incorrect password",
    };
  }

  return { allowed: true, statusCode: 200, reason: "OK" };
}

// ---------------------------------------------------------------------------
// createScriptProxyMiddleware
// ---------------------------------------------------------------------------

export function createScriptProxyMiddleware({
  routeStore,
  logger,
}: {
  routeStore: ScriptRouteStore;
  logger: Logger;
}): RequestHandler {
  return (req, res, next) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      next();
      return;
    }

    const route = routeStore.findRoute(hostHeader);
    if (!route) {
      next();
      return;
    }

    const forwardedHeaders = sanitizeForwardedHeaders(req.headers);
    forwardedHeaders["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
    forwardedHeaders["x-forwarded-host"] = hostHeader.replace(/:\d+$/, "");
    forwardedHeaders["x-forwarded-proto"] = req.protocol;

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: route.port,
        path: req.originalUrl,
        method: req.method,
        headers: forwardedHeaders,
      },
      (proxyRes) => {
        const responseHeaders = stripHopByHopHeaders(proxyRes.headers);
        res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
        proxyRes.pipe(res, { end: true });
      },
    );

    proxyReq.on("error", (err) => {
      logger.warn(
        { err, hostname: route.hostname, port: route.port },
        "Script proxy: upstream unreachable",
      );
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("502 Bad Gateway");
      }
    });

    req.pipe(proxyReq, { end: true });
  };
}

// ---------------------------------------------------------------------------
// createScriptProxyUpgradeHandler
// ---------------------------------------------------------------------------

export function createScriptProxyUpgradeHandler({
  routeStore,
  logger,
  guard,
}: {
  routeStore: ScriptRouteStore;
  logger: Logger;
  guard?: ScriptProxyUpgradeGuard;
}): (req: IncomingMessage, socket: net.Socket, head: Buffer) => void {
  return (req, socket, head) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      return;
    }

    const route = routeStore.findRoute(hostHeader);
    if (!route) {
      return;
    }

    void (async () => {
      const decision = await authorizeScriptProxyUpgrade({ req, hostHeader, guard });
      if (!decision.allowed) {
        logger.warn(
          {
            hostname: route.hostname,
            statusCode: decision.statusCode,
            reason: decision.reason,
            origin: req.headers.origin,
          },
          "Script proxy: rejected WebSocket upgrade",
        );
        rejectUpgrade(socket, decision.statusCode, decision.reason);
        return;
      }

      forwardScriptProxyUpgrade({ req, socket, head, hostHeader, route, logger });
    })().catch((error: unknown) => {
      logger.warn({ err: error, hostname: route.hostname }, "Script proxy: upgrade guard failed");
      rejectUpgrade(socket, 500, "Internal Server Error");
    });
  };
}

function forwardScriptProxyUpgrade(params: {
  req: IncomingMessage;
  socket: net.Socket;
  head: Buffer;
  hostHeader: string;
  route: ScriptRoute;
  logger: Logger;
}): void {
  const { req, socket, head, hostHeader, route, logger } = params;
  const forwardedHeaders = sanitizeForwardedHeaders(req.headers);
  const protocols = sanitizeWebSocketProtocols(req.headers["sec-websocket-protocol"]);
  if (protocols === undefined) {
    delete forwardedHeaders["sec-websocket-protocol"];
  } else {
    forwardedHeaders["sec-websocket-protocol"] = protocols;
  }
  forwardedHeaders["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
  forwardedHeaders["x-forwarded-host"] = hostHeader.replace(/:\d+$/, "");
  forwardedHeaders["x-forwarded-proto"] = "http";
  forwardedHeaders.connection = "Upgrade";
  forwardedHeaders.upgrade = req.headers.upgrade ?? "websocket";

  const fallbackProtocol =
    protocols === undefined ? extractWsBearerProtocol(req.headers["sec-websocket-protocol"]) : null;
  let targetSocket: net.Socket | undefined;
  let targetResponse: IncomingMessage | undefined;
  let responseStarted = false;

  socket.pause();
  const targetRequest = http.request({
    hostname: "127.0.0.1",
    port: route.port,
    path: req.url ?? "/",
    method: req.method ?? "GET",
    headers: forwardedHeaders,
    maxHeaderSize: SCRIPT_PROXY_UPSTREAM_MAX_HEADER_BYTES,
    agent: false,
  });

  targetRequest.once("socket", (connectedSocket) => {
    targetSocket = connectedSocket;
  });

  targetRequest.once("upgrade", (response, upgradedSocket, upstreamHead) => {
    responseStarted = true;
    targetResponse = response;
    targetSocket = upgradedSocket;

    socket.write(serializeUpgradeResponseHead(response, fallbackProtocol));
    if (upstreamHead.length > 0) {
      socket.write(upstreamHead);
    }
    if (head.length > 0) {
      upgradedSocket.write(head);
    }

    upgradedSocket.once("error", (err) => {
      logger.warn(
        { err, hostname: route.hostname, port: route.port },
        "Script proxy: WebSocket upstream socket failed",
      );
      socket.destroy();
    });
    upgradedSocket.pipe(socket);
    socket.pipe(upgradedSocket);
    socket.resume();
  });

  targetRequest.once("response", (response) => {
    responseStarted = true;
    targetResponse = response;
    response.once("error", (err) => {
      logger.warn(
        { err, hostname: route.hostname, port: route.port },
        "Script proxy: WebSocket upstream response failed",
      );
      socket.destroy();
    });
    forwardNonUpgradeResponse(response, socket);
  });

  targetRequest.once("error", (err) => {
    targetSocket?.destroy();
    if (socket.destroyed) {
      return;
    }
    logger.warn(
      { err, hostname: route.hostname, port: route.port },
      "Script proxy: WebSocket upstream request failed",
    );
    if (responseStarted) {
      socket.destroy();
    } else {
      rejectUpgrade(socket, 502, "Bad Gateway");
    }
  });

  socket.once("error", () => {
    targetResponse?.destroy();
    targetRequest.destroy();
    targetSocket?.destroy();
  });
  socket.once("close", () => {
    targetResponse?.destroy();
    targetRequest.destroy();
    targetSocket?.destroy();
  });

  targetRequest.end();
}

// ---------------------------------------------------------------------------
// findFreePort
// ---------------------------------------------------------------------------

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to get assigned port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(port);
        }
      });
    });
    server.on("error", reject);
  });
}
