import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHISACODE_GITHUB_REPOSITORY,
  checkGitHubReleaseUpdate,
  findAndroidApkAsset,
  isReleaseVersionNewer,
  parseGitHubRelease,
} from "./github-release-updates";

describe("isReleaseVersionNewer", () => {
  it("compares stable GitHub release tags against app versions", () => {
    expect(isReleaseVersionNewer("v1.2.4", "1.2.3")).toBe(true);
    expect(isReleaseVersionNewer("1.2.3", "v1.2.3")).toBe(false);
    expect(isReleaseVersionNewer("1.2.3", "1.2.4")).toBe(false);
  });

  it("treats unsupported versions as not newer", () => {
    expect(isReleaseVersionNewer("nightly", "1.2.3")).toBe(false);
    expect(isReleaseVersionNewer("1.2.4", "dev")).toBe(false);
  });
});

describe("parseGitHubRelease", () => {
  it("extracts release metadata and ignores unusable assets", () => {
    const release = parseGitHubRelease({
      tag_name: "v1.2.3",
      html_url: "https://github.com/getchisacode/chisacode/releases/tag/v1.2.3",
      name: "ChisaCode v1.2.3",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "chisacode-v1.2.3-android.apk",
          browser_download_url:
            "https://github.com/getchisacode/chisacode/releases/download/v1.2.3/chisacode-v1.2.3-android.apk",
        },
        { name: "", browser_download_url: "" },
      ],
    });

    expect(release).toEqual({
      tagName: "v1.2.3",
      version: "1.2.3",
      title: "ChisaCode v1.2.3",
      releaseUrl: "https://github.com/getchisacode/chisacode/releases/tag/v1.2.3",
      isPrerelease: false,
      assets: [
        {
          name: "chisacode-v1.2.3-android.apk",
          downloadUrl:
            "https://github.com/getchisacode/chisacode/releases/download/v1.2.3/chisacode-v1.2.3-android.apk",
        },
      ],
    });
  });

  it("returns null for draft releases or missing tags", () => {
    expect(parseGitHubRelease({ draft: true, tag_name: "v1.2.3" })).toBeNull();
    expect(parseGitHubRelease({ draft: false, tag_name: "" })).toBeNull();
  });
});

describe("findAndroidApkAsset", () => {
  it("prefers the Android APK release asset", () => {
    expect(
      findAndroidApkAsset([
        { name: "ChisaCode-Setup-1.2.3-x64.exe", downloadUrl: "https://example.com/setup.exe" },
        { name: "chisacode-v1.2.3-android.apk", downloadUrl: "https://example.com/app.apk" },
      ]),
    ).toEqual({ name: "chisacode-v1.2.3-android.apk", downloadUrl: "https://example.com/app.apk" });
  });
});

describe("checkGitHubReleaseUpdate", () => {
  it("defaults to the ChisaAlter GitHub release repository", async () => {
    expect(DEFAULT_CHISACODE_GITHUB_REPOSITORY).toBe("ChisaAlter/ChisaCode");
  });

  it("checks the latest GitHub release and reports Android APK availability", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v1.2.4",
        html_url: "https://github.com/getchisacode/chisacode/releases/tag/v1.2.4",
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "chisacode-v1.2.4-android.apk",
            browser_download_url: "https://example.com/chisacode-v1.2.4-android.apk",
          },
        ],
      }),
    }));

    await expect(
      checkGitHubReleaseUpdate({
        currentVersion: "1.2.3",
        fetcher,
        now: () => 123,
      }),
    ).resolves.toEqual({
      status: "available",
      hasUpdate: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      releaseUrl: "https://github.com/getchisacode/chisacode/releases/tag/v1.2.4",
      androidApkUrl: "https://example.com/chisacode-v1.2.4-android.apk",
      checkedAt: 123,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/ChisaAlter/ChisaCode/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );
  });

  it("reports up-to-date when the latest GitHub release is not newer", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v1.2.3",
        html_url: "https://github.com/getchisacode/chisacode/releases/tag/v1.2.3",
        draft: false,
        prerelease: false,
        assets: [],
      }),
    }));

    await expect(
      checkGitHubReleaseUpdate({
        currentVersion: "1.2.3",
        fetcher,
        now: () => 456,
      }),
    ).resolves.toMatchObject({
      status: "up-to-date",
      hasUpdate: false,
      latestVersion: "1.2.3",
      androidApkUrl: null,
      checkedAt: 456,
    });
  });

  it("throws a readable error when GitHub returns a non-success response", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "rate limited",
      json: async () => ({}),
    }));

    await expect(
      checkGitHubReleaseUpdate({
        currentVersion: "1.2.3",
        fetcher,
      }),
    ).rejects.toThrow("GitHub release check failed: 403 rate limited");
  });
});
