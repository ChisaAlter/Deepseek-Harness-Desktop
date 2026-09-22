import net from "node:net";

/** Host allowlist configuration. `true` disables hostname allowlist filtering. */
export type HostnamesConfig = true | string[] | undefined;

const MAX_PORT = 65_535;
const INVALID_HOST_AUTHORITY_CHARACTERS = new Set(["/", "\\", "@", ",", "?", "#"]);
const LOOPBACK_IPS = new net.BlockList();
LOOPBACK_IPS.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_IPS.addAddress("::1", "ipv6");
LOOPBACK_IPS.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  if (net.isIP(normalized) !== 6) {
    return normalized;
  }

  try {
    return new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
  } catch {
    return normalized;
  }
}

function hasValidPortSuffix(suffix: string): boolean {
  if (!suffix) {
    return true;
  }
  if (!/^:\d{1,5}$/.test(suffix)) {
    return false;
  }
  return Number(suffix.slice(1)) <= MAX_PORT;
}

function hasInvalidHostAuthorityCharacter(authority: string): boolean {
  for (const character of authority) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      INVALID_HOST_AUTHORITY_CHARACTERS.has(character)
    ) {
      return true;
    }
  }
  return false;
}

function parseHostnameFromHostHeader(hostHeader: string): string | null {
  const trimmed = hostHeader.trim();
  if (!trimmed || hasInvalidHostAuthorityCharacter(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1 || !hasValidPortSuffix(trimmed.slice(end + 1))) {
      return null;
    }

    const literal = trimmed.slice(1, end);
    return net.isIP(literal) === 6 ? normalizeHostname(literal) : null;
  }

  if (trimmed.includes("[") || trimmed.includes("]")) {
    return null;
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex !== trimmed.lastIndexOf(":")) {
    return null;
  }

  const hostname = colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex);
  const portSuffix = colonIndex === -1 ? "" : trimmed.slice(colonIndex);
  if (!hostname || !hasValidPortSuffix(portSuffix)) {
    return null;
  }
  return normalizeHostname(hostname);
}

function matchesHostnamePattern(hostname: string, pattern: string): boolean {
  const normalizedPattern = normalizeHostname(pattern);
  if (!normalizedPattern) return false;

  if (normalizedPattern.startsWith(".")) {
    const base = normalizedPattern.slice(1);
    if (!base) return false;
    return hostname === base || hostname.endsWith(`.${base}`);
  }

  return hostname === normalizedPattern;
}

function isDefaultAllowedHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }

  const family = net.isIP(hostname);
  if (family === 0) {
    return false;
  }
  return LOOPBACK_IPS.check(hostname, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Checks a raw Host header against ChisaCode's hostname authority.
 * @param hostHeader Raw HTTP Host header
 * @param hostnames Explicit hostname patterns or `true` to allow any valid authority
 * @returns Whether the authority is syntactically valid and allowed
 */
export function isHostnameAllowed(
  hostHeader: string | undefined,
  hostnames: HostnamesConfig,
): boolean {
  const hostname = hostHeader ? parseHostnameFromHostHeader(hostHeader) : null;
  if (!hostname) return false;

  if (hostnames === true) return true;
  if (isDefaultAllowedHostname(hostname)) return true;

  const patterns = hostnames ?? [];
  for (const pattern of patterns) {
    if (matchesHostnamePattern(hostname, pattern)) return true;
  }
  return false;
}

/**
 * Merges hostname configuration layers while preserving the allow-any sentinel.
 * @param values Hostname configuration layers in precedence order
 * @returns A de-duplicated allowlist, `true`, or an empty list
 */
export function mergeHostnames(values: Array<HostnamesConfig>): HostnamesConfig {
  let merged: string[] = [];
  for (const value of values) {
    if (value === true) return true;
    if (!value) continue;
    merged = merged.concat(value);
  }

  return Array.from(new Set(merged.map((value) => value.trim()).filter(Boolean)));
}

/**
 * Parses the comma-separated hostname environment variable.
 * @param raw Raw environment variable value
 * @returns Parsed hostname configuration
 */
export function parseHostnamesEnv(raw: string | undefined): HostnamesConfig {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "true") return true;
  return trimmed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
