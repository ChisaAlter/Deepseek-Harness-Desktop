/**
 * Binary frame edge-case tests.
 *
 * Covers: empty frame, maximum-length frame, length-prefix boundary values,
 * truncated frames, invalid opcodes, missing/invalid requestId.
 *
 * Uses pure function tests on encodeFileTransferFrame / decodeFileTransferFrame
 * and encodeTerminalStreamFrame / decodeTerminalStreamFrame from @chisacode/protocol.
 *
 * Also tests daemon-client transport utilities: decodeMessageData,
 * extractRelayMessageData, encodeUtf8String boundary conditions.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  MAX_FILE_TRANSFER_BYTES,
} from "@chisacode/protocol/binary-frames/index";
import {
  decodeTerminalResizePayload,
  decodeTerminalSnapshotPayload,
  decodeTerminalStreamFrame,
  encodeTerminalResizePayload,
  encodeTerminalSnapshotPayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@chisacode/protocol/terminal-stream-protocol";
import {
  decodeMessageData,
  encodeUtf8String,
  extractRelayMessageData,
} from "./daemon-client-transport.js";
import { DaemonClient } from "./daemon-client.js";
import type { DaemonTransport } from "./daemon-client-transport-types.js";

function createBinaryTransferHarness() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  const transport: DaemonTransport = {
    send: (data) => sent.push(data),
    close: () => {},
    onMessage: (handler) => {
      onMessage = handler;
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: () => () => {},
    onError: () => () => {},
  };
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_binary_boundaries",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reconnect: { enabled: false },
    transportFactory: () => transport,
  });
  return {
    client,
    open: () => {
      onOpen();
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "srv_binary",
              hostname: null,
              version: null,
            },
          },
        }),
      );
    },
    frame: (input: Parameters<typeof encodeFileTransferFrame>[0]) =>
      onMessage(encodeFileTransferFrame(input)),
    rawFrame: (frame: Uint8Array) => onMessage(frame),
  };
}

const binaryClients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(binaryClients.map((client) => client.close()));
  binaryClients.length = 0;
});

async function startBinaryRead(requestId: string) {
  const harness = createBinaryTransferHarness();
  binaryClients.push(harness.client);
  const connecting = harness.client.connect();
  harness.open();
  await connecting;
  return { ...harness, read: harness.client.readFile("/tmp/project", "file.bin", requestId) };
}

// =============================================================================
// encodeFileTransferFrame / decodeFileTransferFrame
// =============================================================================

describe("file transfer binary frames", () => {
  test("exports an inclusive safe file transfer limit", () => {
    expect(MAX_FILE_TRANSFER_BYTES).toBe(64 * 1024 * 1024);
  });

  test("rejects FileBegin metadata one byte over the transfer limit", async () => {
    const transfer = await startBinaryRead("over-limit");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "over-limit",
      metadata: {
        mime: "application/octet-stream",
        size: MAX_FILE_TRANSFER_BYTES + 1,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    await expect(transfer.read).rejects.toThrow(/maximum size/i);
  });

  test("rejects a transfer as soon as chunks exceed the declared size", async () => {
    const transfer = await startBinaryRead("declared-overflow");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "declared-overflow",
      metadata: {
        mime: "application/octet-stream",
        size: 2,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    transfer.frame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "declared-overflow",
      payload: new Uint8Array([1, 2, 3]),
    });
    await expect(transfer.read).rejects.toThrow(/declared size/i);
  });

  test("rejects FileEnd when fewer bytes arrived than declared", async () => {
    const transfer = await startBinaryRead("declared-undersize");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "declared-undersize",
      metadata: {
        mime: "application/octet-stream",
        size: 3,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    transfer.frame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "declared-undersize",
      payload: new Uint8Array([1, 2]),
    });
    transfer.frame({ opcode: FileTransferOpcode.FileEnd, requestId: "declared-undersize" });
    await expect(transfer.read).rejects.toThrow(/expected 3 bytes.*received 2/i);
  });

  test("accepts an exact zero-byte transfer", async () => {
    const transfer = await startBinaryRead("exact-zero");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "exact-zero",
      metadata: {
        mime: "application/octet-stream",
        size: 0,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    transfer.frame({ opcode: FileTransferOpcode.FileEnd, requestId: "exact-zero" });
    await expect(transfer.read).resolves.toMatchObject({ size: 0, bytes: new Uint8Array() });
  });

  test("accepts maximum-size metadata before enforcing exact end length", async () => {
    const transfer = await startBinaryRead("exact-maximum");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "exact-maximum",
      metadata: {
        mime: "application/octet-stream",
        size: MAX_FILE_TRANSFER_BYTES,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    transfer.frame({ opcode: FileTransferOpcode.FileEnd, requestId: "exact-maximum" });
    await expect(transfer.read).rejects.toThrow(
      `expected ${MAX_FILE_TRANSFER_BYTES} bytes but received 0`,
    );
  });

  test("retains an owned copy of an accepted chunk payload", async () => {
    const transfer = await startBinaryRead("owned-chunk");
    transfer.frame({
      opcode: FileTransferOpcode.FileBegin,
      requestId: "owned-chunk",
      metadata: {
        mime: "application/octet-stream",
        size: 1,
        encoding: "binary",
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "owned-chunk",
      payload: new Uint8Array([7]),
    });
    const backing = new Uint8Array(8 * 1024 * 1024);
    const frameOffset = 1024;
    backing.set(encoded, frameOffset);
    const frameView = backing.subarray(frameOffset, frameOffset + encoded.byteLength);
    const payloadOffset = frameOffset + encoded.byteLength - 1;
    transfer.rawFrame(frameView);
    backing[payloadOffset] = 99;
    transfer.frame({ opcode: FileTransferOpcode.FileEnd, requestId: "owned-chunk" });
    const result = await transfer.read;
    expect(result.bytes).toEqual(new Uint8Array([7]));
  });

  test("rejects duplicate FileBegin and clears the transfer", async () => {
    const transfer = await startBinaryRead("duplicate-start");
    const begin = {
      opcode: FileTransferOpcode.FileBegin,
      requestId: "duplicate-start",
      metadata: {
        mime: "application/octet-stream",
        size: 1,
        encoding: "binary" as const,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    transfer.frame(begin);
    transfer.frame(begin);
    await expect(transfer.read).rejects.toThrow(/duplicate file transfer start/i);

    const retry = transfer.client.readFile("/tmp/project", "file.bin", "duplicate-start");
    transfer.frame(begin);
    transfer.frame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "duplicate-start",
      payload: new Uint8Array([8]),
    });
    transfer.frame({ opcode: FileTransferOpcode.FileEnd, requestId: "duplicate-start" });
    await expect(retry).resolves.toMatchObject({ bytes: new Uint8Array([8]), size: 1 });
  });

  test.each([FileTransferOpcode.FileChunk, FileTransferOpcode.FileEnd])(
    "rejects opcode %s before FileBegin",
    async (opcode) => {
      const requestId = `before-start-${opcode}`;
      const transfer = await startBinaryRead(requestId);
      if (opcode === FileTransferOpcode.FileChunk) {
        transfer.frame({ opcode, requestId, payload: new Uint8Array([1]) });
      } else {
        transfer.frame({ opcode, requestId });
      }
      await expect(transfer.read).rejects.toThrow(/before start/i);
    },
  );

  test("rejects empty requestId", () => {
    expect(() =>
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "",
        metadata: {
          mime: "text/plain",
          size: 0,
          encoding: "utf-8" as const,
          modifiedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toThrow(RangeError);
  });

  test("rejects requestId exceeding 255 bytes", () => {
    const longId = "x".repeat(256);
    expect(() =>
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileEnd,
        requestId: longId,
      }),
    ).toThrow(RangeError);
  });

  test("accepts requestId exactly at 255-byte boundary", () => {
    const id = "x".repeat(255);
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileEnd,
      requestId: id,
    });
    expect(encoded[0]).toBe(FileTransferOpcode.FileEnd);
    expect(encoded[1]).toBe(255);
    const decoded = decodeFileTransferFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.requestId).toBe(id);
    }
  });

  test("accepts requestId of length 1", () => {
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "a",
      payload: new TextEncoder().encode("hello"),
    });
    expect(encoded[0]).toBe(FileTransferOpcode.FileChunk);
    expect(encoded[1]).toBe(1);
    const decoded = decodeFileTransferFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.requestId).toBe("a");
      expect(decoded.opcode).toBe(FileTransferOpcode.FileChunk);
      expect(new TextDecoder().decode(decoded.payload)).toBe("hello");
    }
  });

  test("rejects frames shorter than 2 bytes", () => {
    expect(decodeFileTransferFrame(new Uint8Array([]))).toBeNull();
    expect(decodeFileTransferFrame(new Uint8Array([0x10]))).toBeNull();
  });

  test("rejects invalid opcode", () => {
    expect(decodeFileTransferFrame(new Uint8Array([0xff, 0x01, 0x61]))).toBeNull();
    expect(decodeFileTransferFrame(new Uint8Array([0x00, 0x01, 0x61]))).toBeNull();
    const terminalEncoded = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Output,
      slot: 0,
      payload: new Uint8Array([65]),
    });
    expect(decodeFileTransferFrame(terminalEncoded)).toBeNull();
  });

  test("rejects requestIdLength of zero", () => {
    expect(decodeFileTransferFrame(new Uint8Array([FileTransferOpcode.FileEnd, 0x00]))).toBeNull();
  });

  test("rejects requestIdLength exceeding remaining bytes", () => {
    // opcode + declared length 10 but only 3 bytes total
    expect(
      decodeFileTransferFrame(new Uint8Array([FileTransferOpcode.FileEnd, 0x0a, 0x61])),
    ).toBeNull();
  });

  test("rejects FileEnd with trailing bytes", () => {
    const encoded = new Uint8Array(7);
    encoded[0] = FileTransferOpcode.FileEnd;
    encoded[1] = 3; // requestId length 3
    new TextEncoder().encode("abc").forEach((b, i) => {
      encoded[2 + i] = b;
    });
    // Extra bytes after body: 0x00, 0x00
    encoded[5] = 0x00;
    encoded[6] = 0x00;
    expect(decodeFileTransferFrame(encoded)).toBeNull();
  });

  test("FileBegin with truncated metadata length prefix", () => {
    // minimum frame: opcode + requestIdLen + requestId + 2-byte meta length
    // We give only 1 byte for metadata length.
    const encoded = new Uint8Array(4);
    encoded[0] = FileTransferOpcode.FileBegin;
    encoded[1] = 1; // 1-byte requestId
    encoded[2] = 0x41; // 'A'
    encoded[3] = 0x00; // only 1 byte of the 2-byte length prefix
    expect(decodeFileTransferFrame(encoded)).toBeNull();
  });

  test("FileBegin with metadata length mismatch", () => {
    const metaJson = JSON.stringify({
      mime: "text/plain",
      size: 0,
      encoding: "utf-8",
      modifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const metaBytes = new TextEncoder().encode(metaJson);
    const reqId = new TextEncoder().encode("req");

    // Build frame with wrong metadata length.
    const encoded = new Uint8Array(4 + reqId.byteLength + metaBytes.byteLength);
    encoded[0] = FileTransferOpcode.FileBegin;
    encoded[1] = reqId.byteLength;
    encoded.set(reqId, 2);
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    view.setUint16(2 + reqId.byteLength, metaBytes.byteLength + 10); // wrong!
    encoded.set(metaBytes, 4 + reqId.byteLength);
    expect(decodeFileTransferFrame(encoded)).toBeNull();
  });

  test("FileBegin with invalid JSON metadata", () => {
    const reqId = new TextEncoder().encode("req");
    const badJson = new TextEncoder().encode("{not valid");
    const encoded = new Uint8Array(4 + reqId.byteLength + badJson.byteLength);
    encoded[0] = FileTransferOpcode.FileBegin;
    encoded[1] = reqId.byteLength;
    encoded.set(reqId, 2);
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    view.setUint16(2 + reqId.byteLength, badJson.byteLength);
    encoded.set(badJson, 4 + reqId.byteLength);
    expect(decodeFileTransferFrame(encoded)).toBeNull();
  });

  test("encode/decode FileChunk round-trip with empty payload", () => {
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "req-empty",
    });
    const decoded = decodeFileTransferFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(FileTransferOpcode.FileChunk);
      expect(decoded.requestId).toBe("req-empty");
      expect(decoded.payload.byteLength).toBe(0);
    }
  });

  test("encode/decode FileChunk round-trip with payload", () => {
    const payload = new TextEncoder().encode("hello world");
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileChunk,
      requestId: "req-chunk",
      payload,
    });
    const decoded = decodeFileTransferFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(FileTransferOpcode.FileChunk);
      expect(decoded.requestId).toBe("req-chunk");
      expect(decoded.payload).toEqual(payload);
    }
  });

  test("FileBegin metadata length at boundary 0xffff", () => {
    // metadata.byteLength > 0xffff must throw (file-transfer.ts:63).
    // 0xffff (65535) is the inclusive upper bound and must be accepted.
    const baseMeta = {
      mime: "text/plain",
      size: 0,
      encoding: "utf-8" as const,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    };

    // Determine the extra padding needed so the JSON is exactly 65535 bytes.
    const baseJson = JSON.stringify({ ...baseMeta, extra: "" });
    const paddingForBoundary = Math.max(0, 0xffff - baseJson.length);

    const atBoundary = { ...baseMeta, extra: "x".repeat(paddingForBoundary) };
    expect(JSON.stringify(atBoundary).length).toBe(0xffff);
    expect(() =>
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req",
        metadata: atBoundary,
      }),
    ).not.toThrow();

    // One byte over the boundary must throw.
    const overBoundary = { ...baseMeta, extra: "x".repeat(paddingForBoundary + 1) };
    expect(JSON.stringify(overBoundary).length).toBe(0xffff + 1);
    expect(() =>
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req",
        metadata: overBoundary,
      }),
    ).toThrow(RangeError);
  });

  test("decodeFileTransferFrame handles correct FileEnd", () => {
    const encoded = encodeFileTransferFrame({
      opcode: FileTransferOpcode.FileEnd,
      requestId: "req-end",
    });
    const decoded = decodeFileTransferFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(FileTransferOpcode.FileEnd);
      expect(decoded.requestId).toBe("req-end");
      expect(decoded.payload.byteLength).toBe(0);
    }
  });
});

// =============================================================================
// Terminal stream binary frames
// =============================================================================

describe("terminal stream binary frames", () => {
  test("rejects frames shorter than 2 bytes", () => {
    expect(decodeTerminalStreamFrame(new Uint8Array([]))).toBeNull();
    expect(decodeTerminalStreamFrame(new Uint8Array([0x01]))).toBeNull();
  });

  test("accepts 2-byte frame with empty payload", () => {
    const frame = decodeTerminalStreamFrame(new Uint8Array([TerminalStreamOpcode.Output, 0]));
    expect(frame).not.toBeNull();
    expect(frame!.opcode).toBe(TerminalStreamOpcode.Output);
    expect(frame!.slot).toBe(0);
    expect(frame!.payload.byteLength).toBe(0);
  });

  test("rejects invalid opcode", () => {
    expect(decodeTerminalStreamFrame(new Uint8Array([0xff, 0x01, 0x02]))).toBeNull();
  });

  test("frame with 3 bytes yields 1-byte payload", () => {
    const encoded = new Uint8Array(3);
    encoded[0] = TerminalStreamOpcode.Output;
    encoded[1] = 0; // slot
    // Decoder treats all bytes beyond slot as payload; no length-prefix validation
    const frame = decodeTerminalStreamFrame(encoded);
    expect(frame).not.toBeNull();
    expect(frame!.slot).toBe(0);
    expect(frame!.payload.byteLength).toBe(1);
    expect(frame!.payload[0]).toBe(0);
  });

  test("frame payload is bytes.subarray(2) regardless of content", () => {
    const encoded = new Uint8Array(5);
    encoded[0] = TerminalStreamOpcode.Output;
    encoded[1] = 0; // slot
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    view.setUint16(3, 10); // bytes 3-4 declared as 10 (Uint16LE) — decoder ignores
    const frame = decodeTerminalStreamFrame(encoded);
    expect(frame).not.toBeNull();
    expect(frame!.payload.byteLength).toBe(3); // bytes 2-4
  });

  test("encode/decode output frame round-trip", () => {
    const payload = new TextEncoder().encode("terminal output");
    const encoded = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Output,
      slot: 3,
      payload,
    });
    expect(encoded[0]).toBe(TerminalStreamOpcode.Output);
    expect(encoded[1]).toBe(3);
    const decoded = decodeTerminalStreamFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(TerminalStreamOpcode.Output);
      expect(decoded.slot).toBe(3);
      expect(decoded.payload).toEqual(payload);
    }
  });

  test("encode/decode snapshot frame round-trip", () => {
    const payload = encodeTerminalSnapshotPayload({
      rows: 100,
      cols: 80,
      grid: [
        [{ char: "l" }, { char: "i" }],
        [{ char: "n" }, { char: "e" }],
      ],
      scrollback: [],
      cursor: { row: 2, col: 0 },
    });
    const encoded = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Snapshot,
      slot: 1,
      payload,
    });
    const decoded = decodeTerminalStreamFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(TerminalStreamOpcode.Snapshot);
      expect(decoded.slot).toBe(1);
      const snapshot = decodeTerminalSnapshotPayload(decoded.payload);
      expect(snapshot).not.toBeNull();
      if (snapshot) {
        expect(snapshot.rows).toBe(100);
        expect(snapshot.cols).toBe(80);
      }
    }
  });

  test("encode/decode resize frame round-trip", () => {
    const payload = encodeTerminalResizePayload({ cols: 120, rows: 40 });
    const encoded = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Resize,
      slot: 0,
      payload,
    });
    const decoded = decodeTerminalStreamFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(TerminalStreamOpcode.Resize);
      const resize = decodeTerminalResizePayload(decoded.payload);
      expect(resize).toEqual({ cols: 120, rows: 40 });
    }
  });

  test("encode/decode restore frame without payload", () => {
    const encoded = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Restore,
      slot: 2,
    });
    expect(encoded[0]).toBe(TerminalStreamOpcode.Restore);
    const decoded = decodeTerminalStreamFrame(encoded);
    expect(decoded).not.toBeNull();
    if (decoded) {
      expect(decoded.opcode).toBe(TerminalStreamOpcode.Restore);
      expect(decoded.slot).toBe(2);
    }
  });

  test("decodeTerminalSnapshotPayload rejects malformed JSON", () => {
    const malformed = new TextEncoder().encode("{not json");
    expect(decodeTerminalSnapshotPayload(malformed)).toBeNull();
  });

  test("decodeTerminalResizePayload rejects malformed JSON", () => {
    const malformed = new TextEncoder().encode("{bad");
    expect(decodeTerminalResizePayload(malformed)).toBeNull();
  });

  test("decodeTerminalSnapshotPayload rejects valid JSON with wrong shape", () => {
    const wrongShape = new TextEncoder().encode('{"unknown":"field"}');
    expect(decodeTerminalSnapshotPayload(wrongShape)).toBeNull();
  });

  test("decodeTerminalResizePayload rejects valid JSON with wrong shape", () => {
    const wrongShape = new TextEncoder().encode('{"cols":"string"}');
    expect(decodeTerminalResizePayload(wrongShape)).toBeNull();
  });
});

// =============================================================================
// Transport utility functions
// =============================================================================

describe("transport utility functions", () => {
  test("encodeUtf8String handles empty string", () => {
    const result = encodeUtf8String("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(0);
  });

  test("encodeUtf8String handles ASCII", () => {
    const result = encodeUtf8String("hello");
    expect(result).toEqual(new TextEncoder().encode("hello"));
  });

  test("encodeUtf8String handles multi-byte characters", () => {
    const result = encodeUtf8String("你好");
    expect(result).toEqual(new TextEncoder().encode("你好"));
  });

  test("decodeMessageData handles null/undefined", () => {
    expect(decodeMessageData(null)).toBeNull();
    expect(decodeMessageData(undefined)).toBeNull();
  });

  test("decodeMessageData handles string", () => {
    expect(decodeMessageData("hello")).toBe("hello");
  });

  test("decodeMessageData handles empty string", () => {
    expect(decodeMessageData("")).toBe("");
  });

  test("decodeMessageData handles ArrayBuffer", () => {
    const buffer = new TextEncoder().encode("from buffer").buffer;
    expect(decodeMessageData(buffer)).toBe("from buffer");
  });

  test("decodeMessageData handles empty ArrayBuffer", () => {
    const buffer = new ArrayBuffer(0);
    expect(decodeMessageData(buffer)).toBe("");
  });

  test("decodeMessageData handles Uint8Array", () => {
    const arr = new TextEncoder().encode("typed array");
    expect(decodeMessageData(arr)).toBe("typed array");
  });

  test("decodeMessageData handles Uint8Array subarray view", () => {
    const full = new TextEncoder().encode("prefixHELLOsuffix");
    const sub = full.subarray(6, 11); // "HELLO"
    expect(decodeMessageData(sub)).toBe("HELLO");
  });

  test("decodeMessageData handles object with toString", () => {
    expect(decodeMessageData({ toString: () => "via toString" })).toBe("via toString");
  });

  test("extractRelayMessageData handles raw string", () => {
    expect(extractRelayMessageData("raw")).toBe("raw");
  });

  test("extractRelayMessageData handles event with string data", () => {
    expect(extractRelayMessageData({ data: "msg" })).toBe("msg");
  });

  test("extractRelayMessageData handles event with ArrayBuffer data", () => {
    const buf = new TextEncoder().encode("buffer").buffer;
    const result = extractRelayMessageData({ data: buf });
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result as ArrayBuffer)).toBe("buffer");
  });

  test("extractRelayMessageData handles event with Uint8Array data", () => {
    const arr = new TextEncoder().encode("typed");
    const result = extractRelayMessageData({ data: arr });
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(result as ArrayBuffer)).toBe("typed");
  });

  test("extractRelayMessageData handles null/undefined gracefully", () => {
    expect(extractRelayMessageData(null)).toBe("");
    expect(extractRelayMessageData(undefined)).toBe("");
    // Non-string/non-ArrayBuffer input falls back to String() coercion; verify
    // it returns a string without throwing rather than pinning the exact value.
    const coerced = extractRelayMessageData({});
    expect(typeof coerced).toBe("string");
    expect(coerced.length).toBeGreaterThan(0);
  });
});
