/**
 * High-confidence sensitive relative path detection.
 *
 * Intentionally conservative: callers use it to avoid automatically
 * committing, snapshotting, or transmitting local credential stores —
 * not as a full secret scanner.
 *
 * Adapted from Cindy's `security/sensitivePath.ts` (Apache-2.0).
 */

export interface SensitivePathOptions {
  /**
   * Allow checked-in env templates (`.env.example`, `.env.sample`,
   * `.env.template`). Set to `false` to reject all `.env*` files.
   *
   * @default true
   */
  allowEnvTemplates?: boolean;

  /**
   * Exclude whole credential config directories (`.config/gh`,
   * `.config/gcloud`). Useful for package publishing where credential
   * trees are never intentional fixtures.
   *
   * @default false
   */
  excludeCredentialConfigDirs?: boolean;
}

/** Pre-parsed path context shared by all detectors. */
interface PathContext {
  lower: string;
  parts: string[];
  base: string;
  options: Required<SensitivePathOptions>;
}

const ALLOWED_ENV_BASENAMES = new Set([".env.example", ".env.sample", ".env.template"]);

const SENSITIVE_DIR_SEGMENTS = new Set([".git", ".ssh", ".aws", ".azure", ".kube"]);

const SENSITIVE_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".yarnrc",
  ".yarnrc.yml",
  ".envrc",
  "credentials",
  "credentials.json",
  "service-account.json",
]);

const PRIVATE_KEY_BASENAME_RE = /^id_(?:rsa|dsa|ecdsa|ed25519)$/i;
const SENSITIVE_EXTENSION_RE = /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i;
const SENSITIVE_PATH_RE =
  /(^|\/)(?:\.gem\/credentials|\.docker\/config\.json|\.config\/gcloud\/application_default_credentials\.json|\.config\/gh\/hosts\.ya?ml|\.pip\/pip\.(?:conf|ini)|\.config\/pip\/pip\.(?:conf|ini))$/i;
const SECRET_DIR_RE = /(^|\/)secrets?\//;
const CREDENTIALS_DIR_RE = /(^|\/)credentials?\//;
const SECRET_CONFIG_RE = /(^|\/)(?:secrets?|credentials?)[^/]*\.(?:json|ya?ml|toml|ini|env)$/i;

const SENSITIVE_CONFIG_PREFIXES = [".config/gh", ".config/gcloud"];

type Detector = (ctx: PathContext) => string | null;

const DETECTORS: readonly Detector[] = [
  // .git internals — never snapshot or transmit
  ({ lower }) =>
    lower === ".git" || lower.startsWith(".git/") || lower.includes("/.git/")
      ? "git-internal-path"
      : null,

  // .env files (allow templates by default)
  ({ base, options }) =>
    (base === ".env" || base.startsWith(".env.")) &&
    !(options.allowEnvTemplates && ALLOWED_ENV_BASENAMES.has(base))
      ? "env-file"
      : null,

  // Well-known credential directories anywhere in the path
  ({ parts }) =>
    parts.some((part) => SENSITIVE_DIR_SEGMENTS.has(part)) ? "sensitive-directory" : null,

  // Exact basename matches
  ({ base }) => (SENSITIVE_BASENAMES.has(base) ? "sensitive-basename" : null),

  // SSH private keys
  ({ base }) => (PRIVATE_KEY_BASENAME_RE.test(base) ? "private-key-path" : null),

  // Sensitive file extensions
  ({ base }) => (SENSITIVE_EXTENSION_RE.test(base) ? "sensitive-extension" : null),

  // Known credential file paths (docker, gcloud, gh, pip, gem)
  ({ lower }) => (SENSITIVE_PATH_RE.test(lower) ? "sensitive-path" : null),

  // Credential config directory trees (opt-in)
  ({ lower, options }) =>
    options.excludeCredentialConfigDirs &&
    SENSITIVE_CONFIG_PREFIXES.some(
      (prefix) =>
        lower === prefix || lower.startsWith(`${prefix}/`) || lower.includes(`/${prefix}/`),
    )
      ? "sensitive-config-directory"
      : null,

  // secrets/ or secret/ directories
  ({ lower }) => (SECRET_DIR_RE.test(lower) ? "secret-directory" : null),

  // credentials/ or credential/ directories
  ({ lower }) => (CREDENTIALS_DIR_RE.test(lower) ? "credentials-directory" : null),

  // Files named secrets/credentials with config extensions
  ({ lower }) => (SECRET_CONFIG_RE.test(lower) ? "secret-config-path" : null),
];

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function basenameOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx >= 0 ? relativePath.slice(idx + 1) : relativePath;
}

/**
 * Returns a detector name when a relative path is too sensitive for
 * automation (snapshot, upload, publish), or `null` when the path is safe.
 *
 * Detector names are stable strings suitable for logging and metrics:
 * `"git-internal-path"`, `"env-file"`, `"sensitive-directory"`,
 * `"sensitive-basename"`, `"private-key-path"`, `"sensitive-extension"`,
 * `"sensitive-path"`, `"sensitive-config-directory"`, `"secret-directory"`,
 * `"credentials-directory"`, `"secret-config-path"`.
 */
export function detectSensitivePath(
  relativePath: string,
  options: SensitivePathOptions = {},
): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized === ".") return null;

  const ctx: PathContext = {
    lower: normalized.toLowerCase(),
    parts: normalized.toLowerCase().split("/").filter(Boolean),
    base: basenameOf(normalized.toLowerCase()),
    options: {
      allowEnvTemplates: options.allowEnvTemplates ?? true,
      excludeCredentialConfigDirs: options.excludeCredentialConfigDirs ?? false,
    },
  };

  for (const detector of DETECTORS) {
    const result = detector(ctx);
    if (result !== null) return result;
  }
  return null;
}

export interface FilterSensitivePathsResult {
  /** Paths that passed all detectors (safe to include). */
  safe: string[];
  /** Paths a detector flagged, paired with the detector name that matched. */
  excluded: Array<{ path: string; detector: string }>;
}

/**
 * Partition a list of paths into safe and sensitive buckets. Reusable by any
 * caller that needs to exclude sensitive files before an operation — git
 * snapshots, agent file downloads, worktree archiving. Each excluded entry
 * carries the detector name so callers can log/surface why a file was dropped.
 */
export function filterSensitivePaths(
  paths: readonly string[],
  options: SensitivePathOptions = {},
): FilterSensitivePathsResult {
  const safe: string[] = [];
  const excluded: Array<{ path: string; detector: string }> = [];
  for (const p of paths) {
    const detector = detectSensitivePath(p, options);
    if (detector) {
      excluded.push({ path: p, detector });
    } else {
      safe.push(p);
    }
  }
  return { safe, excluded };
}
