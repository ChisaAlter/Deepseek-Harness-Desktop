/**
 * Media-type detection for QQ Bot outbound routing.
 *
 * Classifies a file path (or URL) into one of `image | voice | video |
 * file` based on MIME type first, file extension as fallback. Used by
 * the outbound dispatcher to pick the right send path.
 *
 * Pure string-based — no I/O. The audio detection in
 * {@link "./audio.js"} owns the broader QQ-platform voice-format rules
 * (silk/amr/etc.); this module's `voice` classification is a coarser
 * "any audio file" check matching legacy outbound routing semantics.
 */

import { isAudioFile } from "./audio.js";

/** Supported media kind for QQ Bot outbound routing. */
export type MediaKind = "image" | "voice" | "video" | "file";

/** Display labels for media kinds. */
export const MEDIA_KIND_LABELS: Record<MediaKind | "media", string> = {
  image: "Image",
  voice: "Voice",
  video: "Video",
  file: "File",
  media: "Media",
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);

/**
 * Extract a lowercase file extension from a path or URL, ignoring query and hash.
 */
export function getCleanExtension(filePath: string): string {
  const cleanPath = filePath.split("?")[0].split("#")[0];
  const lastDot = cleanPath.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  return cleanPath.slice(lastDot).toLowerCase();
}

/** Check whether a file is an image using MIME first and extension as fallback. */
export function isImageFile(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("image/")) {
    return true;
  }
  return IMAGE_EXTENSIONS.has(getCleanExtension(filePath));
}

/** Check whether a file is a video using MIME first and extension as fallback. */
export function isVideoFile(filePath: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("video/")) {
    return true;
  }
  return VIDEO_EXTENSIONS.has(getCleanExtension(filePath));
}

/**
 * Auto-detect the media kind from a file path and optional MIME type.
 *
 * Priority: audio → video → image → file (default).  The audio check
 * delegates to {@link isAudioFile} to keep one source of truth for the
 * QQ voice-format extension list.
 */
export function detectMediaKind(filePath: string, mimeType?: string): MediaKind {
  if (isAudioFile(filePath, mimeType)) {
    return "voice";
  }
  if (isVideoFile(filePath, mimeType)) {
    return "video";
  }
  if (isImageFile(filePath, mimeType)) {
    return "image";
  }
  return "file";
}

/** Return true when the source is a remote HTTP(S) URL. */
export function isHttpSource(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

/** Return true when the source is a Base64 data URL. */
export function isDataSource(source: string): boolean {
  return source.startsWith("data:");
}

/** Return true when the source is a remote URL or data URL. */
export function isRemoteOrDataSource(source: string): boolean {
  return isHttpSource(source) || isDataSource(source);
}

/** Common MIME type mapping for image extensions. */
export const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
