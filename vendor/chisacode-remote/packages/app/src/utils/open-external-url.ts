import * as Linking from "expo-linking";
import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";

/** URL schemes permitted to be opened externally. Anything else (e.g.
 *  `javascript:`, `data:`, arbitrary app deep-links) is rejected to prevent
 *  injection from markdown/linkify or assistant-file-link `external` values. */
const ALLOWED_EXTERNAL_URL_SCHEMES = new Set(["http", "https", "mailto", "tel", "sms"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_URL_SCHEMES.has(parsed.protocol.replace(/:$/, ""));
  } catch {
    return false;
  }
}

/**
 * Opens an external URL after validating its scheme against an allowlist.
 * Disallowed schemes (e.g. `javascript:`, `data:`, arbitrary app deep-links)
 * are silently ignored to prevent injection from markdown/linkify or
 * assistant-file-link `external` values, without surfacing unhandled rejections
 * to fire-and-forget callers.
 * @param url The URL to open; must use http, https, mailto, tel, or sms
 * @returns A promise that resolves once the URL is opened, or resolves
 *   immediately if the scheme was disallowed
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    return;
  }

  if (isWeb) {
    const opener = getDesktopHost()?.opener?.openUrl;
    if (typeof opener === "function") {
      await opener(url);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  await Linking.openURL(url);
}
