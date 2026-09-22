import { Buffer } from "buffer";

type NullableString = string | null | undefined;
const BASE64_WORKSPACE_ID_PREFIX = "b64_";

interface SettingsRouteOptions {
  returnTo?: NullableString;
}

function stripSearchAndHash(pathname: string): string {
  const hashIndex = pathname.indexOf("#");
  const queryIndex = pathname.indexOf("?");
  const end = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), pathname.length);
  return pathname.slice(0, end);
}

function extractSearch(pathname: string): string {
  const queryIndex = pathname.indexOf("?");
  if (queryIndex < 0) {
    return "";
  }
  const hashIndex = pathname.indexOf("#", queryIndex);
  return hashIndex >= 0
    ? pathname.slice(queryIndex + 1, hashIndex)
    : pathname.slice(queryIndex + 1);
}

function trimNonEmpty(value: NullableString): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes a settings returnTo value into a safe in-app route.
 * @param value The raw returnTo query value, possibly delivered as an array
 * @returns The normalized route, or null when it is blank, protocol-relative, or points back at settings
 */
export function normalizeSettingsReturnToRoute(value: string | string[] | null | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const normalized = trimNonEmpty(rawValue);
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return null;
  }

  const pathOnly = stripSearchAndHash(normalized);
  if (pathOnly === "/settings" || pathOnly.startsWith("/settings/")) {
    return null;
  }

  return normalized;
}

function appendSettingsReturnTo(route: string, options?: SettingsRouteOptions) {
  const returnTo = normalizeSettingsReturnToRoute(options?.returnTo);
  if (!returnTo) {
    return route;
  }
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toBase64UrlNoPad(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64UrlNoPadUtf8(input: string): string | null {
  const normalized = input.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    return null;
  }

  const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  let decoded: string;
  try {
    decoded = Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }

  return decoded;
}

function tryDecodeBase64UrlNoPadUtf8(input: string): string | null {
  const normalized = input.trim();
  const decoded = decodeBase64UrlNoPadUtf8(normalized);
  if (!decoded) {
    return null;
  }

  // Validate via round-trip to avoid false positives ("workspace-1" etc).
  if (toBase64UrlNoPad(decoded) !== normalized) {
    return null;
  }

  return decoded;
}

function normalizeWorkspaceId(value: string): string {
  return value.trim();
}

function isUrlSafeWorkspaceId(value: string): boolean {
  return /^[A-Za-z0-9._~-]+$/.test(value);
}

function isLegacyPathLikeWorkspaceValue(value: string): boolean {
  return value.includes("/") || value.includes("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

/** Describes which surface should be focused when a workspace route is opened. */
export type WorkspaceOpenIntent =
  | { kind: "agent"; agentId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "terminal-new" }
  | { kind: "changes" }
  | { kind: "file"; path: string }
  | { kind: "draft"; draftId: string }
  | { kind: "setup"; workspaceId: string };

/**
 * Parses a serialized `open` query value into a workspace open intent.
 * @param value The raw `open` query parameter value
 * @returns The parsed intent, or null when the value is blank or unrecognized
 */
export function parseWorkspaceOpenIntent(
  value: string | null | undefined,
): WorkspaceOpenIntent | null {
  const normalized = trimNonEmpty(value);
  if (!normalized) {
    return null;
  }

  const fixedIntent = normalized.toLowerCase();
  if (fixedIntent === "changes") {
    return { kind: "changes" };
  }
  if (fixedIntent === "terminal") {
    return { kind: "terminal-new" };
  }

  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator >= normalized.length - 1) {
    return null;
  }

  const kind = normalized.slice(0, separator).trim().toLowerCase();
  const payload = trimNonEmpty(normalized.slice(separator + 1));
  if (!payload) {
    return null;
  }

  if (kind === "agent") {
    return { kind: "agent", agentId: payload };
  }
  if (kind === "terminal") {
    if (payload.toLowerCase() === "new") {
      return { kind: "terminal-new" };
    }
    return { kind: "terminal", terminalId: payload };
  }
  if (kind === "changes") {
    if (payload.toLowerCase() !== "review") {
      return null;
    }
    return { kind: "changes" };
  }
  if (kind === "draft") {
    return { kind: "draft", draftId: payload };
  }
  if (kind === "file") {
    const decodedPath = decodeFilePathFromPathSegment(payload);
    if (!decodedPath) {
      return null;
    }
    return { kind: "file", path: decodedPath };
  }
  if (kind === "setup") {
    const workspaceId = decodeWorkspaceIdFromPathSegment(payload);
    if (!workspaceId) {
      return null;
    }
    return { kind: "setup", workspaceId };
  }

  return null;
}

/**
 * Checks whether an intent opens a full workspace screen rather than focusing a single item.
 * @param intent The parsed workspace open intent
 * @returns True when the intent targets the changes review or new-terminal screen
 */
export function isWorkspaceScreenOpenIntent(intent: WorkspaceOpenIntent): boolean {
  return intent.kind === "changes" || intent.kind === "terminal-new";
}

/**
 * Extracts the workspace open intent from the query string embedded in a pathname.
 * @param pathname The URL pathname, optionally including query string and hash
 * @returns The parsed intent, or null when no valid `open` parameter is present
 */
export function parseHostWorkspaceOpenIntentFromPathname(
  pathname: string,
): WorkspaceOpenIntent | null {
  const search = extractSearch(pathname);
  if (!search) {
    return null;
  }
  return parseWorkspaceOpenIntent(new URLSearchParams(search).get("open"));
}

/**
 * Encodes a workspace id for use inside a URL path segment.
 * @param workspaceId The raw workspace id, which may be a filesystem path
 * @returns A URL-safe segment, base64url-encoded with a b64_ prefix when the id is not already URL-safe, or an empty string for blank input
 */
export function encodeWorkspaceIdForPathSegment(workspaceId: string): string {
  const normalized = trimNonEmpty(workspaceId);
  if (!normalized) {
    return "";
  }
  const id = normalizeWorkspaceId(normalized);
  if (isUrlSafeWorkspaceId(id)) {
    return id;
  }
  return `${BASE64_WORKSPACE_ID_PREFIX}${toBase64UrlNoPad(id)}`;
}

/**
 * Decodes a workspace id segment produced by encodeWorkspaceIdForPathSegment, tolerating legacy base64url encodings.
 * @param workspaceIdSegment The URL path segment holding the encoded workspace id
 * @returns The decoded workspace id, or null when the segment is blank
 */
export function decodeWorkspaceIdFromPathSegment(workspaceIdSegment: string): string | null {
  const normalizedSegment = trimNonEmpty(workspaceIdSegment);
  if (!normalizedSegment) {
    return null;
  }

  const decoded = trimNonEmpty(decodeSegment(normalizedSegment));
  if (!decoded) {
    return null;
  }

  if (decoded.startsWith(BASE64_WORKSPACE_ID_PREFIX)) {
    const encodedPayload = decoded.slice(BASE64_WORKSPACE_ID_PREFIX.length);
    const prefixedDecoded =
      tryDecodeBase64UrlNoPadUtf8(encodedPayload) ?? decodeBase64UrlNoPadUtf8(encodedPayload);
    return prefixedDecoded ? normalizeWorkspaceId(prefixedDecoded) : null;
  }

  const base64Decoded = tryDecodeBase64UrlNoPadUtf8(decoded);
  if (base64Decoded && isLegacyPathLikeWorkspaceValue(base64Decoded)) {
    return normalizeWorkspaceId(base64Decoded);
  }

  const relaxedBase64Decoded = decodeBase64UrlNoPadUtf8(decoded);
  if (relaxedBase64Decoded && isLegacyPathLikeWorkspaceValue(relaxedBase64Decoded)) {
    return normalizeWorkspaceId(relaxedBase64Decoded);
  }

  return normalizeWorkspaceId(decoded);
}

/**
 * Encodes a file path as a base64url URL path segment.
 * @param filePath The raw file path
 * @returns The base64url-encoded segment, or an empty string for blank input
 */
export function encodeFilePathForPathSegment(filePath: string): string {
  const normalized = trimNonEmpty(filePath);
  if (!normalized) {
    return "";
  }
  return toBase64UrlNoPad(normalized);
}

/**
 * Decodes a file path segment produced by encodeFilePathForPathSegment.
 * @param filePathSegment The URL path segment holding the encoded file path
 * @returns The decoded file path, or null when the segment is blank or not valid base64url
 */
export function decodeFilePathFromPathSegment(filePathSegment: string): string | null {
  const normalizedSegment = trimNonEmpty(filePathSegment);
  if (!normalizedSegment) {
    return null;
  }
  const decoded = trimNonEmpty(decodeSegment(normalizedSegment));
  if (!decoded) {
    return null;
  }
  return tryDecodeBase64UrlNoPadUtf8(decoded);
}

/**
 * Extracts the server id from a host-scoped (/h/:serverId) pathname.
 * @param pathname The URL pathname to inspect
 * @returns The decoded server id, or null when the pathname is not host-scoped
 */
export function parseServerIdFromPathname(pathname: string): string | null {
  const pathOnly = stripSearchAndHash(pathname);
  const match = pathOnly.match(/^\/h\/([^/]+)(?:\/|$)/);
  if (!match) {
    return null;
  }
  const raw = match[1];
  if (!raw) {
    return null;
  }
  return trimNonEmpty(decodeSegment(raw));
}

/**
 * Extracts the server id from a /settings/hosts/:serverId pathname.
 * @param pathname The URL pathname to inspect
 * @returns The decoded server id, or null when the pathname does not match a host settings route
 */
export function parseSettingsHostRouteFromPathname(pathname: string): string | null {
  const pathOnly = stripSearchAndHash(pathname);
  const match = pathOnly.match(/^\/settings\/hosts\/([^/]+)(?:\/|$)/);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (!raw) {
    return null;
  }
  return trimNonEmpty(decodeSegment(raw));
}

/**
 * Extracts the server and agent ids from a /h/:serverId/agent/:agentId pathname.
 * @param pathname The URL pathname to inspect
 * @returns The decoded server and agent ids, or null when the pathname does not match
 */
export function parseHostAgentRouteFromPathname(
  pathname: string,
): { serverId: string; agentId: string } | null {
  const pathOnly = stripSearchAndHash(pathname);
  const match = pathOnly.match(/^\/h\/([^/]+)\/agent\/([^/]+)(?:\/|$)/);
  if (!match) {
    return null;
  }

  const [, encodedServerId, encodedAgentId] = match;
  if (!encodedServerId || !encodedAgentId) {
    return null;
  }

  const serverId = trimNonEmpty(decodeSegment(encodedServerId));
  const agentId = trimNonEmpty(decodeSegment(encodedAgentId));
  if (!serverId || !agentId) {
    return null;
  }

  return { serverId, agentId };
}

/**
 * Extracts the server and workspace ids from a /h/:serverId/workspace/:workspaceId pathname.
 * @param pathname The URL pathname to inspect
 * @returns The decoded server and workspace ids, or null when the pathname does not match
 */
export function parseHostWorkspaceRouteFromPathname(
  pathname: string,
): { serverId: string; workspaceId: string } | null {
  const pathOnly = stripSearchAndHash(pathname);
  const match = pathOnly.match(/^\/h\/([^/]+)\/workspace\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }

  const serverId = trimNonEmpty(decodeSegment(match[1]));
  if (!serverId) {
    return null;
  }

  const rawWorkspaceId = match[2];
  const workspaceId = decodeWorkspaceIdFromPathSegment(rawWorkspaceId);
  if (!workspaceId) {
    return null;
  }
  return { serverId, workspaceId };
}

/**
 * Builds the canonical route for a workspace on a host.
 * @param serverId The host server id
 * @param workspaceId The workspace id
 * @returns The workspace route, or "/" when either id is blank
 */
export function buildHostWorkspaceRoute(serverId: string, workspaceId: string) {
  const normalizedServerId = trimNonEmpty(serverId);
  const normalizedWorkspaceId = trimNonEmpty(workspaceId);
  if (!normalizedServerId || !normalizedWorkspaceId) {
    return "/" as const;
  }
  const encodedWorkspaceId = encodeWorkspaceIdForPathSegment(normalizedWorkspaceId);
  if (!encodedWorkspaceId) {
    return "/" as const;
  }
  return `/h/${encodeSegment(normalizedServerId)}/workspace/${encodeSegment(encodedWorkspaceId)}` as const;
}

/**
 * Builds a workspace route that opens a specific surface via the `open` query parameter.
 * @param serverId The host server id
 * @param workspaceId The workspace id
 * @param openIntent The serialized open intent, e.g. "changes" or "agent:<id>"
 * @returns The workspace route with the open intent appended, or the plain workspace route when inputs are blank
 */
export function buildHostWorkspaceOpenRoute(
  serverId: string,
  workspaceId: string,
  openIntent: string,
) {
  const base = buildHostWorkspaceRoute(serverId, workspaceId);
  const normalizedOpenIntent = trimNonEmpty(openIntent);
  if (base === "/" || !normalizedOpenIntent) {
    return base;
  }
  return `${base}?open=${encodeURIComponent(normalizedOpenIntent)}` as const;
}

/**
 * Builds the route for an agent detail view, scoped inside a workspace route when a workspace id is provided.
 * @param serverId The host server id
 * @param agentId The agent id
 * @param workspaceId Optional workspace id; when present the agent opens via the workspace `open` intent
 * @returns The agent detail route, or "/" when required ids are blank
 */
export function buildHostAgentDetailRoute(serverId: string, agentId: string, workspaceId?: string) {
  const normalizedWorkspaceId = trimNonEmpty(workspaceId);
  if (normalizedWorkspaceId) {
    const normalizedAgentId = trimNonEmpty(agentId);
    if (!normalizedAgentId) {
      return "/" as const;
    }
    return buildHostWorkspaceOpenRoute(
      serverId,
      normalizedWorkspaceId,
      `agent:${normalizedAgentId}`,
    );
  }
  const normalizedServerId = trimNonEmpty(serverId);
  const normalizedAgentId = trimNonEmpty(agentId);
  if (!normalizedServerId || !normalizedAgentId) {
    return "/" as const;
  }
  return `${buildHostRootRoute(normalizedServerId)}/agent/${encodeSegment(normalizedAgentId)}` as const;
}

/**
 * Builds the root route for a host.
 * @param serverId The host server id
 * @returns The host root route, or "/" when the id is blank
 */
export function buildHostRootRoute(serverId: string) {
  const normalized = trimNonEmpty(serverId);
  if (!normalized) {
    return "/" as const;
  }
  return `/h/${encodeSegment(normalized)}` as const;
}

/**
 * Builds the sessions list route for a host.
 * @param serverId The host server id
 * @returns The host sessions route, or "/" when the id is blank
 */
export function buildHostSessionsRoute(serverId: string) {
  const base = buildHostRootRoute(serverId);
  if (base === "/") {
    return "/" as const;
  }
  return `${base}/sessions` as const;
}

/**
 * Builds the open-project route for a host.
 * @param serverId The host server id
 * @returns The host open-project route, or "/" when the id is blank
 */
export function buildHostOpenProjectRoute(serverId: string) {
  const base = buildHostRootRoute(serverId);
  if (base === "/") {
    return "/" as const;
  }
  return `${base}/open-project` as const;
}

/**
 * Builds the new-workspace route for a host with optional prefilled query parameters.
 * @param serverId The host server id
 * @param sourceDirectory Optional directory to prefill as the workspace source
 * @param options Optional display name, project id, and draft key query values
 * @returns The new-workspace route, or "/" when the server id is blank
 */
export function buildHostNewWorkspaceRoute(
  serverId: string,
  sourceDirectory?: NullableString,
  options?: { displayName?: string; projectId?: string; draftKey?: string },
) {
  const base = buildHostRootRoute(serverId);
  const normalizedSourceDirectory = trimNonEmpty(sourceDirectory);
  if (base === "/") {
    return "/" as const;
  }
  if (!normalizedSourceDirectory && !options) {
    return `${base}/new` as const;
  }
  const params = new URLSearchParams();
  if (normalizedSourceDirectory) {
    params.set("dir", normalizedSourceDirectory);
  }
  const displayName = trimNonEmpty(options?.displayName);
  const projectId = trimNonEmpty(options?.projectId);
  const draftKey = trimNonEmpty(options?.draftKey);
  if (displayName) {
    params.set("name", displayName);
  }
  if (projectId) {
    params.set("projectId", projectId);
  }
  if (draftKey) {
    params.set("draft", draftKey);
  }
  const search = params.toString();
  return search ? (`${base}/new?${search}` as const) : (`${base}/new` as const);
}

/** Ordered list of valid settings section slugs addressable in settings routes. */
export const SETTINGS_SECTION_SLUGS = [
  "general",
  "models",
  "usage",
  "skills",
  "mcp",
  "shortcuts",
  "integrations",
  "permissions",
  "diagnostics",
  "feedback",
  "about",
] as const;

/** A valid settings section slug derived from SETTINGS_SECTION_SLUGS. */
export type SettingsSectionSlug = (typeof SETTINGS_SECTION_SLUGS)[number];

export function isSettingsSectionSlug(value: string): value is SettingsSectionSlug {
  return (SETTINGS_SECTION_SLUGS as readonly string[]).includes(value);
}

/**
 * Builds the top-level settings route, optionally carrying a returnTo target.
 * @param options Optional returnTo route appended as a query parameter
 * @returns The settings route
 */
export function buildSettingsRoute(): "/settings";
export function buildSettingsRoute(options: SettingsRouteOptions): string;
export function buildSettingsRoute(options?: SettingsRouteOptions) {
  return appendSettingsReturnTo("/settings", options);
}

/**
 * Builds the route for a settings section, optionally carrying a returnTo target.
 * @param section The settings section slug
 * @param options Optional returnTo route appended as a query parameter
 * @returns The settings section route
 */
export function buildSettingsSectionRoute(section: SettingsSectionSlug): `/settings/${string}`;
export function buildSettingsSectionRoute(
  section: SettingsSectionSlug,
  options: SettingsRouteOptions,
): string;
export function buildSettingsSectionRoute(
  section: SettingsSectionSlug,
  options?: SettingsRouteOptions,
) {
  return appendSettingsReturnTo(`/settings/${section}`, options);
}

/**
 * Builds the settings route for a specific host, optionally carrying a returnTo target.
 * @param serverId The host server id
 * @param options Optional returnTo route appended as a query parameter
 * @returns The host settings route
 * @throws When serverId is blank
 */
export function buildSettingsHostRoute(serverId: string): `/settings/hosts/${string}`;
export function buildSettingsHostRoute(serverId: string, options: SettingsRouteOptions): string;
export function buildSettingsHostRoute(serverId: string, options?: SettingsRouteOptions) {
  const normalized = trimNonEmpty(serverId);
  if (!normalized) {
    throw new Error("buildSettingsHostRoute requires a non-empty serverId");
  }
  return appendSettingsReturnTo(`/settings/hosts/${encodeSegment(normalized)}`, options);
}

/**
 * Builds the projects settings route, optionally carrying a returnTo target.
 * @param options Optional returnTo route appended as a query parameter
 * @returns The projects settings route
 */
export function buildProjectsSettingsRoute(): "/settings/projects";
export function buildProjectsSettingsRoute(options: SettingsRouteOptions): string;
export function buildProjectsSettingsRoute(options?: SettingsRouteOptions) {
  return appendSettingsReturnTo("/settings/projects", options);
}

/**
 * Builds the settings route for a specific project, optionally carrying a returnTo target.
 * @param projectKey The project key
 * @param options Optional returnTo route appended as a query parameter
 * @returns The project settings route
 * @throws When projectKey is blank
 */
export function buildProjectSettingsRoute(projectKey: string): `/settings/projects/${string}`;
export function buildProjectSettingsRoute(
  projectKey: string,
  options: SettingsRouteOptions,
): string;
export function buildProjectSettingsRoute(projectKey: string, options?: SettingsRouteOptions) {
  const normalized = trimNonEmpty(projectKey);
  if (!normalized) {
    throw new Error("buildProjectSettingsRoute requires a non-empty projectKey");
  }
  return appendSettingsReturnTo(`/settings/projects/${encodeSegment(normalized)}`, options);
}

/**
 * Rewrites a pathname so it points at the equivalent route on another host server.
 * @param pathname The current URL pathname
 * @param nextServerId The server id to switch to
 * @returns The mapped pathname on the target server, or "/" when the server id is blank
 */
export function mapPathnameToServer(pathname: string, nextServerId: string) {
  const normalized = trimNonEmpty(nextServerId);
  if (!normalized) {
    return "/" as const;
  }

  if (parseSettingsHostRouteFromPathname(pathname)) {
    return buildSettingsHostRoute(normalized);
  }

  const suffix = pathname.replace(/^\/h\/[^/]+\/?/, "");
  const base = buildHostRootRoute(normalized);
  if (suffix.startsWith("settings")) {
    return buildSettingsHostRoute(normalized);
  }
  if (suffix.startsWith("sessions")) {
    return `${base}/sessions` as const;
  }
  if (suffix.startsWith("open-project")) {
    return `${base}/open-project` as const;
  }
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(pathname);
  if (workspaceRoute) {
    return buildHostWorkspaceRoute(normalized, workspaceRoute.workspaceId);
  }
  if (suffix.startsWith("agent/")) {
    return `${base}/${suffix}` as const;
  }
  return base;
}
