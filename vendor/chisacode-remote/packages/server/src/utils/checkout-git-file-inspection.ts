import { open as openFile } from "node:fs/promises";

/** Maximum text file size included in a single checkout diff. */
export const PER_FILE_DIFF_MAX_BYTES = 1024 * 1024;
const UNTRACKED_BINARY_SNIFF_BYTES = 16 * 1024;

/**
 * Detects likely binary content from a bounded prefix without loading the whole file.
 * @param absolutePath Absolute file path to inspect
 * @returns Whether the sampled bytes look binary
 */
export async function isLikelyBinaryFile(absolutePath: string): Promise<boolean> {
  const handle = await openFile(absolutePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(UNTRACKED_BINARY_SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return false;
    }

    let suspicious = 0;
    for (let i = 0; i < bytesRead; i += 1) {
      const byte = buffer[i];
      if (byte === 0) {
        return true;
      }
      if (byte < 7 || (byte > 14 && byte < 32) || byte === 127) {
        suspicious += 1;
      }
    }

    return suspicious / bytesRead > 0.3;
  } finally {
    await handle.close();
  }
}
