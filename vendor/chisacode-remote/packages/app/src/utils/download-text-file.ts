import { Share } from "react-native";
import { isWeb } from "@/constants/platform";

/**
 * Downloads or shares a text file on the current platform
 * @param filename Suggested download filename
 * @param content File body text
 * @param mimeType MIME type used for web blob downloads
 * @returns True when the download/share flow started successfully
 */
export async function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8",
): Promise<boolean> {
  if (
    isWeb &&
    typeof document !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    const blob = new Blob([content], { type: mimeType });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Defer revocation slightly so slow setups have time to start the download
    // before the blob URL is invalidated (browsers keep in-flight downloads alive
    // after revoke, but a 0ms revoke is aggressive on heavily loaded machines).
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    return true;
  }

  return Share.share({ title: filename, message: content }).then(
    () => true,
    () => false,
  );
}
