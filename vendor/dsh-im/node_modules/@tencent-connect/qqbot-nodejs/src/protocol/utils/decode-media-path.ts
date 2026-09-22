/**
 * Decode QQ Bot media-tag path strings.
 *
 * Media tags emitted by the model carry paths in a `MEDIA:<path>` form;
 * the path itself may be tilde-prefixed and may contain octal escape
 * sequences or UTF-8 byte sequences (a quirk of how some agents encode
 * non-ASCII paths). This module strips the prefix and unescapes those
 * encodings.
 *
 * Pure string transform — no I/O, framework-agnostic.
 */

/** Optional logger for decode diagnostics. */
export interface MediaPathDecodeLogger {
  debug?: (msg: string) => void;
  error: (msg: string) => void;
}

/**
 * Minimal tilde expansion using process env.
 *
 * Kept self-contained so this module is portable and testable without
 * pulling in path/platform helpers.
 */
function expandTildeInline(p: string): string {
  let result = p.trim();
  if (result.startsWith("~/") || result === "~") {
    const home =
      typeof process !== "undefined" ? (process.env.HOME ?? process.env.USERPROFILE) : undefined;
    if (home) {
      result = result === "~" ? home : `${home}${result.slice(1)}`;
    }
  }
  return result;
}

/**
 * Decode a media-tag path by stripping `MEDIA:`, expanding `~`, and
 * unescaping octal/UTF-8 byte sequences.
 *
 * @param raw - Raw path string from a media tag.
 * @param log - Optional logger for decode diagnostics.
 * @returns The decoded, normalized media path.
 */
export function decodeMediaPath(raw: string, log?: MediaPathDecodeLogger): string {
  let mediaPath = raw;
  if (mediaPath.startsWith("MEDIA:")) {
    mediaPath = mediaPath.slice("MEDIA:".length);
  }
  mediaPath = expandTildeInline(mediaPath);
  mediaPath = mediaPath.replace(/\\\\/g, "\\");

  // Skip octal escape decoding for Windows local paths (e.g. C:\Users\1\file.txt)
  // where backslash-digit sequences like \1, \2 ... \7 are directory separators,
  // not octal escape sequences.
  const isWinLocal = /^[a-zA-Z]:[\\/]/.test(mediaPath) || mediaPath.startsWith("\\\\");
  try {
    const hasOctal = /\\[0-7]{1,3}/.test(mediaPath);
    const hasNonASCII = /[\u0080-\u00FF]/.test(mediaPath);

    if (!isWinLocal && (hasOctal || hasNonASCII)) {
      log?.debug?.(`Decoding path with mixed encoding: ${mediaPath}`);
      const decoded = mediaPath.replace(/\\([0-7]{1,3})/g, (_: string, octal: string) => {
        return String.fromCharCode(Number.parseInt(octal, 8));
      });
      const bytes: number[] = [];
      for (let i = 0; i < decoded.length; i++) {
        const code = decoded.charCodeAt(i);
        if (code <= 0xff) {
          bytes.push(code);
        } else {
          const charBytes = Buffer.from(decoded[i], "utf8");
          bytes.push(...charBytes);
        }
      }
      const buffer = Buffer.from(bytes);
      const utf8Decoded = buffer.toString("utf8");
      if (!utf8Decoded.includes("\uFFFD") || utf8Decoded.length < decoded.length) {
        mediaPath = utf8Decoded;
        log?.debug?.(`Successfully decoded path: ${mediaPath}`);
      }
    }
  } catch (decodeErr) {
    log?.error(`Path decode error: ${String(decodeErr)}`);
  }

  return mediaPath;
}
