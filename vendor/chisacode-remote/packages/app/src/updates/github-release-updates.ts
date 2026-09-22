export const DEFAULT_CHISACODE_GITHUB_REPOSITORY = "ChisaAlter/ChisaCode";

export interface GitHubReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface GitHubReleaseInfo {
  tagName: string;
  version: string;
  title: string | null;
  releaseUrl: string;
  isPrerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export type GitHubReleaseUpdateStatus = "available" | "up-to-date" | "unknown";

export interface GitHubReleaseUpdateResult {
  status: GitHubReleaseUpdateStatus;
  hasUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  androidApkUrl: string | null;
  checkedAt: number;
}

export type GitHubReleaseFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

interface ReleaseVersionParts {
  major: number;
  minor: number;
  patch: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseReleaseVersionParts(value: string | null | undefined): ReleaseVersionParts | null {
  const trimmed = value?.trim().replace(/^v/i, "");
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (![major, minor, patch].every(Number.isInteger)) {
    return null;
  }

  return { major, minor, patch };
}

export function isReleaseVersionNewer(
  latestVersion: string | null | undefined,
  currentVersion: string | null | undefined,
): boolean {
  const latest = parseReleaseVersionParts(latestVersion);
  const current = parseReleaseVersionParts(currentVersion);
  if (!latest || !current) {
    return false;
  }

  if (latest.major !== current.major) {
    return latest.major > current.major;
  }
  if (latest.minor !== current.minor) {
    return latest.minor > current.minor;
  }
  return latest.patch > current.patch;
}

function parseGitHubReleaseAsset(raw: unknown): GitHubReleaseAsset | null {
  if (!isRecord(raw)) {
    return null;
  }

  const name = toNonEmptyString(raw.name);
  const downloadUrl = toNonEmptyString(raw.browser_download_url);
  if (!name || !downloadUrl) {
    return null;
  }

  return { name, downloadUrl };
}

export function parseGitHubRelease(raw: unknown): GitHubReleaseInfo | null {
  if (!isRecord(raw) || raw.draft === true) {
    return null;
  }

  const tagName = toNonEmptyString(raw.tag_name);
  const releaseUrl = toNonEmptyString(raw.html_url);
  if (!tagName || !releaseUrl) {
    return null;
  }

  const version = tagName.replace(/^v/i, "");
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .map(parseGitHubReleaseAsset)
        .filter((asset): asset is GitHubReleaseAsset => asset !== null)
    : [];

  return {
    tagName,
    version,
    title: toNonEmptyString(raw.name),
    releaseUrl,
    isPrerelease: raw.prerelease === true,
    assets,
  };
}

export function findAndroidApkAsset(
  assets: readonly GitHubReleaseAsset[],
): GitHubReleaseAsset | null {
  return (
    assets.find((asset) => {
      const name = asset.name.toLowerCase();
      return name.endsWith(".apk") && name.includes("android");
    }) ?? null
  );
}

function getGlobalFetch(): GitHubReleaseFetch {
  if (typeof fetch !== "function") {
    throw new Error("GitHub release check is not available in this runtime.");
  }
  return fetch;
}

export async function checkGitHubReleaseUpdate({
  currentVersion,
  repository = DEFAULT_CHISACODE_GITHUB_REPOSITORY,
  fetcher = getGlobalFetch(),
  now = () => Date.now(),
}: {
  currentVersion: string | null;
  repository?: string;
  fetcher?: GitHubReleaseFetch;
  now?: () => number;
}): Promise<GitHubReleaseUpdateResult> {
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    const status = response.status ?? 0;
    const statusText = response.statusText?.trim() || "unknown error";
    throw new Error(`GitHub release check failed: ${status} ${statusText}`);
  }

  const release = parseGitHubRelease(await response.json());
  if (!release) {
    throw new Error("GitHub release check returned no usable release.");
  }

  const apkAsset = findAndroidApkAsset(release.assets);
  const hasComparableVersions =
    parseReleaseVersionParts(currentVersion) !== null &&
    parseReleaseVersionParts(release.version) !== null;
  const hasUpdate = isReleaseVersionNewer(release.version, currentVersion);
  let status: GitHubReleaseUpdateStatus = "unknown";
  if (hasComparableVersions) {
    status = hasUpdate ? "available" : "up-to-date";
  }

  return {
    status,
    hasUpdate,
    currentVersion,
    latestVersion: release.version,
    releaseUrl: release.releaseUrl,
    androidApkUrl: apkAsset?.downloadUrl ?? null,
    checkedAt: now(),
  };
}
