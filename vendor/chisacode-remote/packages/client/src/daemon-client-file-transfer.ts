import {
  FileTransferOpcode,
  MAX_FILE_TRANSFER_BYTES,
  type FileTransferFrame,
} from "@chisacode/protocol/binary-frames/index";
import type { SessionOutboundMessage } from "@chisacode/protocol/messages";

type FileExplorerPayload = Extract<
  SessionOutboundMessage,
  { type: "file_explorer_response" }
>["payload"];
type LegacyExplorerFilePayload = NonNullable<FileExplorerPayload["file"]>;

/** Binary-safe result returned by daemon file reads. */
export interface FileReadResult {
  bytes: Uint8Array;
  mime: string;
  size: number;
  path: string;
  kind: "text" | "image" | "binary";
  modifiedAt: string;
}

interface PendingBinaryFileRead {
  cwd: string;
  path: string;
}

interface BinaryFileTransferState extends PendingBinaryFileRead {
  mime: string;
  size: number;
  encoding: Extract<
    FileTransferFrame,
    { opcode: typeof FileTransferOpcode.FileBegin }
  >["metadata"]["encoding"];
  modifiedAt: string;
  receivedBytes: number;
  chunks: Uint8Array[];
}

export interface BinaryFileTransferOutcome extends PendingBinaryFileRead {
  requestId: string;
  error: string | null;
}

export class BinaryFileTransferManager {
  private readonly pendingReads = new Map<string, PendingBinaryFileRead>();
  private readonly activeTransfers = new Map<string, BinaryFileTransferState>();
  private readonly completedReads = new Map<string, FileReadResult>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleTimeoutMs: number;
  private readonly onIdleTimeout?: (requestId: string) => void;

  constructor(options?: { idleTimeoutMs?: number; onIdleTimeout?: (requestId: string) => void }) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 60_000;
    this.onIdleTimeout = options?.onIdleTimeout;
  }

  startRead(requestId: string, cwd: string, path: string): void {
    this.pendingReads.set(requestId, { cwd, path });
  }

  takeCompletedRead(requestId: string): FileReadResult | null {
    const result = this.completedReads.get(requestId) ?? null;
    this.completedReads.delete(requestId);
    return result;
  }

  cleanupRead(requestId: string): void {
    this.clearIdleTimer(requestId);
    this.pendingReads.delete(requestId);
    this.activeTransfers.delete(requestId);
    this.completedReads.delete(requestId);
  }
  clearActiveTransfers(): void {
    this.activeTransfers.clear();
  }

  handleFrame(frame: FileTransferFrame): BinaryFileTransferOutcome | null {
    if (frame.opcode === FileTransferOpcode.FileBegin) {
      const pending = this.pendingReads.get(frame.requestId);
      if (!pending) {
        return null;
      }
      if (this.activeTransfers.has(frame.requestId)) {
        return this.fail(frame.requestId, "Duplicate file transfer start");
      }
      if (frame.metadata.size > MAX_FILE_TRANSFER_BYTES) {
        return this.fail(frame.requestId, "File transfer exceeds maximum size");
      }
      this.activeTransfers.set(frame.requestId, {
        ...pending,
        mime: frame.metadata.mime,
        size: frame.metadata.size,
        encoding: frame.metadata.encoding,
        modifiedAt: frame.metadata.modifiedAt,
        receivedBytes: 0,
        chunks: [],
      });
      this.armIdleTimer(frame.requestId);
      return null;
    }

    const transfer = this.activeTransfers.get(frame.requestId);
    if (!transfer) {
      if (this.pendingReads.has(frame.requestId) && !this.completedReads.has(frame.requestId)) {
        return this.fail(frame.requestId, "File transfer frame received before start");
      }
      return null;
    }

    if (frame.opcode === FileTransferOpcode.FileChunk) {
      const nextReceivedBytes = transfer.receivedBytes + frame.payload.byteLength;
      if (!Number.isSafeInteger(nextReceivedBytes) || nextReceivedBytes > MAX_FILE_TRANSFER_BYTES) {
        return this.fail(frame.requestId, "File transfer exceeds maximum size");
      }
      if (nextReceivedBytes > transfer.size) {
        return this.fail(frame.requestId, "File transfer exceeds declared size");
      }
      transfer.receivedBytes = nextReceivedBytes;
      transfer.chunks.push(new Uint8Array(frame.payload));
      this.armIdleTimer(frame.requestId);
      return null;
    }

    if (transfer.receivedBytes !== transfer.size) {
      return this.fail(
        frame.requestId,
        `File transfer expected ${transfer.size} bytes but received ${transfer.receivedBytes}`,
      );
    }

    this.clearIdleTimer(frame.requestId);
    this.activeTransfers.delete(frame.requestId);
    this.completedReads.set(frame.requestId, {
      bytes: concatByteChunks(transfer.chunks, transfer.size),
      mime: transfer.mime,
      size: transfer.size,
      path: transfer.path,
      kind: binaryFileKind(transfer.mime, transfer.encoding),
      modifiedAt: transfer.modifiedAt,
    });
    return {
      cwd: transfer.cwd,
      path: transfer.path,
      requestId: frame.requestId,
      error: null,
    };
  }

  private armIdleTimer(requestId: string): void {
    this.clearIdleTimer(requestId);
    const handle = setTimeout(() => {
      this.idleTimers.delete(requestId);
      this.onIdleTimeout?.(requestId);
      this.fail(requestId, "File transfer idle timeout");
    }, this.idleTimeoutMs);
    this.idleTimers.set(requestId, handle);
  }

  private clearIdleTimer(requestId: string): void {
    const handle = this.idleTimers.get(requestId);
    if (handle) {
      clearTimeout(handle);
      this.idleTimers.delete(requestId);
    }
  }

  private fail(requestId: string, error: string): BinaryFileTransferOutcome | null {
    const pending = this.pendingReads.get(requestId);
    this.clearIdleTimer(requestId);
    this.activeTransfers.delete(requestId);
    if (!pending) {
      return null;
    }
    return { ...pending, requestId, error };
  }
}

export function legacyExplorerFileToBytes(file: LegacyExplorerFilePayload): FileReadResult {
  let bytes: Uint8Array;
  if (file.encoding === "base64" && file.content) {
    bytes = decodeBase64ToBytes(file.content);
  } else if (file.encoding === "utf-8" && file.content) {
    bytes = new TextEncoder().encode(file.content);
  } else {
    bytes = new Uint8Array();
  }

  return {
    bytes,
    mime: file.mimeType ?? "application/octet-stream",
    size: file.size,
    path: file.path,
    kind: file.kind,
    modifiedAt: file.modifiedAt,
  };
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function binaryFileKind(mime: string, encoding: string): FileReadResult["kind"] {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (encoding === "utf-8" || mime.startsWith("text/") || mime === "application/json") {
    return "text";
  }
  return "binary";
}

function concatByteChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
