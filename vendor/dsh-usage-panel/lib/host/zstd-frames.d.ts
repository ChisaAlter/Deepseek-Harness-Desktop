export interface ZstdFrameRange {
    start: number;
    end: number;
}
export interface ZstdFrameScan {
    frames: ZstdFrameRange[];
    tornStart?: number;
}
/**
 * Locate complete Zstandard frames without decompressing their blocks
 * (structural port of the persistence backend's scanner).
 */
export declare function scanZstdFrames(buffer: Buffer): ZstdFrameScan;
/** Decompress one complete frame (checksum-validated by the decoder). */
export declare function decompressZstdFrame(input: Buffer): Promise<Buffer>;
/** Compress a plaintext buffer as one independent checksummed frame. */
export declare function compressZstdFrame(input: Buffer | string): Promise<Buffer>;
