import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Options for {@link writeFileAtomic}.
 */
export interface WriteFileAtomicOptions {
  /**
   * Optional encoding used when `data` is a string. Defaults to "utf8".
   */
  encoding?: BufferEncoding;
  /**
   * Optional POSIX mode for the temp file (e.g. 0o600). Ignored on Windows
   * where POSIX modes do not apply. When omitted, the file is created with the
   * process umask default.
   */
  mode?: number;
}

/**
 * Writes `data` to `targetPath` atomically using a temp-file + fsync + rename
 * pattern, so a crash during write never leaves a truncated or empty file at
 * the target path.
 *
 * The temp file is created in the same directory as the target (so rename is
 * atomic on POSIX, and stays on the same filesystem). Contents are fsync'd
 * before the rename so the directory entry never points at an empty file. The
 * parent directory is fsync'd after the rename so the rename itself is durable
 * across crashes. The temp file is best-effort cleaned up on failure.
 *
 * @param targetPath Final path to write
 * @param data String or buffer payload
 * @param options Optional encoding / mode
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string | NodeJS.ArrayBufferView,
  options: WriteFileAtomicOptions = {},
): Promise<void> {
  const encoding = options.encoding ?? "utf8";
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  // "wx" = O_WRONLY | O_CREAT | O_EXCL — fails (EEXIST) if a temp file from a
  // previous crashed run already exists at this exact name (UUID makes that
  // vanishingly unlikely, but EXCL keeps us safe).
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tempPath, "wx", options.mode ?? 0o666);
    await fs.writeFile(handle, data, { encoding });
    // fsync the file contents before the rename so the directory entry never
    // points at an empty file after a crash. datasync is sufficient and faster
    // than a full sync on Linux.
    await handle.datasync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, targetPath);
    // fsync the parent directory so the rename's directory-entry update is
    // durable across crashes. On Windows, fsync on directory handles is not
    // supported, so skip it there; failures elsewhere are best-effort (some
    // filesystems do not support directory fsync). The file data is already
    // durable from the datasync above.
    if (process.platform !== "win32") {
      try {
        const dirHandle = await fs.open(directory, "r");
        try {
          await dirHandle.datasync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        // best-effort; directory fsync unsupported on this filesystem
      }
    }
  } catch (error) {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}
