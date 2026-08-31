// dsh-usage-panel · zstd frame primitives for the session-log repair feature.
//
// Port of the frame scanner from `@deepseek-ai/dsh-session-persistence-jsonl`
// (MIT; that package does not re-export its zstd helpers, and its `/src/*`
// subpath is not shipped in the npm artifact). Node >= 22 provides native
// zstd through `node:zlib`, so the repair writes nothing through outside
// code: scan frames → per-frame decompress → rebuild two checksummed frames
// (header frame + event frame), exactly the container the backend reads.

import { constants, zstdCompress as nodeZstdCompress, zstdDecompress as nodeZstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const zstdCompressAsync = promisify(nodeZstdCompress)
const zstdDecompressAsync = promisify(nodeZstdDecompress)
const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

export interface ZstdFrameRange {
  start: number
  end: number
}

export interface ZstdFrameScan {
  frames: ZstdFrameRange[]
  tornStart?: number
}

/**
 * Locate complete Zstandard frames without decompressing their blocks
 * (structural port of the persistence backend's scanner).
 */
export function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  let tornStart: number | undefined
  outer: while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) {
      tornStart = start
      break
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('corrupt Zstandard session log: invalid frame magic at byte ' + offset)
    }
    offset += 4
    if (offset === buffer.length) {
      tornStart = start
      break
    }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error('corrupt Zstandard session log: reserved frame-header bit at byte ' + (offset - 1))
    }
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const contentSizeFlag = descriptor >>> 6
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) {
      tornStart = start
      break
    }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) {
        tornStart = start
        break outer
      }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error('corrupt Zstandard session log: reserved block type at byte ' + (offset - 3))
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) {
        tornStart = start
        break outer
      }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        tornStart = start
        break
      }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart }
}

/** Decompress one complete frame (checksum-validated by the decoder). */
export async function decompressZstdFrame(input: Buffer): Promise<Buffer> {
  return zstdDecompressAsync(input)
}

/** Compress a plaintext buffer as one independent checksummed frame. */
export async function compressZstdFrame(input: Buffer | string): Promise<Buffer> {
  return zstdCompressAsync(input, CHECKSUM_OPTIONS)
}
