import { generateMessageId } from "@/types/stream";
import { isAbsolutePath } from "@/utils/path";

/** Generates a unique attachment identifier prefixed with `att_`. */
export function generateAttachmentId(): string {
  return `att_${generateMessageId()}`;
}

/**
 * Normalizes a MIME type string, defaulting to `image/jpeg` when empty or missing.
 * @param input The raw MIME type string
 * @returns The normalized MIME type
 */
export function normalizeMimeType(input: string | undefined | null): string {
  if (!input) {
    return "image/jpeg";
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : "image/jpeg";
}

/**
 * Parses a `data:` URL into its MIME type and base64 payload.
 * @param dataUrl The data URL to parse
 * @returns The parsed MIME type and base64 string
 * @throws {Error} If the URL is not a valid base64-encoded data URL
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^,]*),([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error("附件 data URL 格式不正确。");
  }
  const metadata = match[1] ?? "";
  const base64 = match[2]?.replace(/\s/g, "");
  const [mimeTypeRaw, ...parameters] = metadata.split(";").map((part) => part.trim());
  const isBase64 = parameters.some((part) => part.toLowerCase() === "base64");
  if (!isBase64) {
    throw new Error("附件 data URL 不是 base64 编码。");
  }
  if (!base64) {
    throw new Error("附件 data URL 缺少 base64 内容。");
  }
  return {
    mimeType: normalizeMimeType(mimeTypeRaw),
    base64,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Parses an image `data:` URL into MIME type, base64 payload, and a stable cache key.
 * @param uri The data URL to parse
 * @returns The parsed image data, or null if the URI is not an image data URL
 */
export function parseImageDataUrl(
  uri: string,
): { mimeType: string; base64: string; cacheKey: string } | null {
  if (!uri.trim().toLowerCase().startsWith("data:image/")) {
    return null;
  }

  try {
    const parsed = parseDataUrl(uri);
    if (!parsed.mimeType.toLowerCase().startsWith("image/")) {
      return null;
    }
    const fingerprint = `${parsed.mimeType}\0${parsed.base64.length}\0${parsed.base64.slice(0, 64)}\0${parsed.base64.slice(-64)}`;
    return {
      ...parsed,
      cacheKey: `data-image:${parsed.mimeType}:${parsed.base64.length}:${hashString(fingerprint)}`,
    };
  } catch {
    return null;
  }
}

export function createImageSourceCacheKey(source: string): string {
  return parseImageDataUrl(source)?.cacheKey ?? source;
}

export function getFileNameFromPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const fileName = normalized.split("/").pop()?.trim();
  return fileName || null;
}

export function createPreviewAttachmentId(input: {
  mimeType: string;
  path?: string | null;
  size?: number | null;
  modifiedAt?: string | null;
  contentLength?: number | null;
}): string {
  const path = input.path?.trim() ?? "";
  const size = Number.isFinite(input.size) ? String(input.size) : "";
  const modifiedAt = input.modifiedAt?.trim() ?? "";
  const contentLength = Number.isFinite(input.contentLength) ? String(input.contentLength) : "";
  const hash = hashString(`${input.mimeType}\0${path}\0${size}\0${modifiedAt}\0${contentLength}`);
  return `preview_${size || contentLength || "unknown"}_${hash}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("编码附件时 FileReader 返回了意外结果。"));
        return;
      }
      const payload = reader.result.split(",", 2)[1];
      if (!payload) {
        reject(new Error("FileReader 结果中没有附件 base64 内容。"));
        return;
      }
      resolve(payload);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("无法读取附件 blob。"));
    });
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a local filesystem path to a `file://` URI, percent-encoding the path body.
 * Handles POSIX absolute paths, UNC paths (`\\server\share`), and Windows drive paths.
 * @param path The filesystem path to convert
 * @returns The `file://` URI, or the original path if it is not absolute
 */
export function pathToFileUri(path: string): string {
  if (path.startsWith("file://")) {
    return path;
  }

  if (!isAbsolutePath(path)) {
    return path;
  }

  if (path.startsWith("/")) {
    return `file://${encodeURI(path)}`;
  }

  // UNC paths: \\server\share -> file://server/share
  if (path.startsWith("\\\\")) {
    return `file:${encodeURI(path.replace(/\\/g, "/"))}`;
  }

  return `file:///${encodeURI(path.replace(/\\/g, "/"))}`;
}

/**
 * Converts a `file://` URI back to a filesystem path, percent-decoding the result.
 * @param uri The `file://` URI to convert
 * @returns The decoded filesystem path, or the original URI if it is not a `file://` URI
 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

export function getFileExtensionFromName(fileName: string | null | undefined): string {
  if (!fileName) {
    return "";
  }
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0 || idx === fileName.length - 1) {
    return "";
  }
  return fileName.slice(idx);
}
