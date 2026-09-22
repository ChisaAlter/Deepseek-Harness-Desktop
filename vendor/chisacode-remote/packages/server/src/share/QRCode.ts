import * as QRCodeLib from "qrcode";
import type {
  QRCode as QRCodeInternal,
  QRCodeErrorCorrectionLevel,
  QRCodeMaskPattern,
  QRCodeOptions,
  QRCodeRenderersOptions,
  QRCodeSegment,
  QRCodeToDataURLOptions,
  QRCodeToStringOptions,
} from "qrcode";

/**
 * Options for creating a {@link QRCode} instance.
 */
export interface QRCodeCreateOptions {
  /** QR Code version. If not specified, the most suitable value is calculated. */
  version?: number;
  /** Error correction level. Default is 'M'. */
  errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  /** Mask pattern. If not specified, a suitable value is calculated. */
  maskPattern?: QRCodeMaskPattern;
}

/**
 * Options for generating a string representation of a QR code.
 */
export type QRCodeStringFormat =
  | { type: "terminal"; small?: boolean; margin?: number; scale?: number }
  | { type: "utf8"; margin?: number; scale?: number }
  | { type: "svg"; margin?: number; scale?: number };

/**
 * Options for generating a data URL representation of a QR code.
 */
export interface QRCodeDataURLFormat {
  width?: number;
  margin?: number;
  scale?: number;
  errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  color?: {
    dark?: string;
    light?: string;
  };
  type?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
}

/**
 * A structured wrapper around a QR code.
 *
 * Provides typed access to the internal QR code representation and
 * convenience methods for generating output in different formats,
 * including a debug-friendly ASCII art format.
 */
export class QRCode {
  /**
   * The underlying qrcode library representation (lazy, generated on demand).
   */
  private _internal: QRCodeInternal | null = null;
  private readonly _internalPromise: Promise<QRCodeInternal>;

  /**
   * Create a new QRCode instance for the given data.
   *
   * @param data - The text or segments to encode in the QR code.
   * @param opts - Creation options (version, error correction, mask pattern).
   */
  constructor(
    public readonly data: string | QRCodeSegment[],
    opaque?: QRCodeCreateOptions,
  ) {
    const options: QRCodeOptions = {
      errorCorrectionLevel: opaque?.errorCorrectionLevel ?? "M",
      version: opaque?.version,
      maskPattern: opaque?.maskPattern,
    };

    // Store the promise so we don't re-compute the internal representation
    // if multiple methods are called.
    this._internalPromise = Promise.resolve(QRCodeLib.create(data, options));
  }

  /**
   * Lazily resolve the internal QR code representation.
   */
  private async getInternal(): Promise<QRCodeInternal> {
    if (!this._internal) {
      this._internal = await this._internalPromise;
    }
    return this._internal;
  }

  /**
   * Generate a string representation of the QR code.
   *
   * @param format - The output format ("terminal", "utf8", or "svg").
   *   Default is `{ type: "utf8" }`.
   * @returns A string representation of the QR code.
   */
  async toString(format: QRCodeStringFormat = { type: "utf8" }): Promise<string> {
    const options: QRCodeToStringOptions = this.toRenderersOptions(format);
    return QRCodeLib.toString(this.data, options);
  }

  /**
   * Generate a data URL suitable for rendering as an `<img>` or `<Image>` component.
   *
   * @param opts - Rendering options (width, margin, colors, etc.).
   * @returns A base64-encoded data URL string (e.g., `data:image/png;base64,...`).
   */
  async toDataURL(optapt?: QRCodeDataURLFormat): Promise<string> {
    const options: QRCodeToDataURLOptions = {
      type: (optapt?.type ?? "image/png") as QRCodeToDataURLOptions["type"],
      margin: optapt?.margin,
      scale: optapt?.scale,
      width: optapt?.width,
      errorCorrectionLevel: optapt?.errorCorrectionLevel,
      color: optapt?.color,
      rendererOpts: optapt?.quality !== undefined ? { quality: optapt.quality } : undefined,
    };
    return QRCodeLib.toDataURL(this.data, options);
  }

  /**
   * Generate a debug-friendly string representation of the QR code.
   *
   * This includes:
   * - The original data (URL)
   * - QR code metadata (version, error correction level, mask pattern)
   * - An ASCII art visualisation using block characters (suitable for terminals and log output)
   *
   * @returns A human-readable debug string.
   */
  async toDebugString(): Promise<string> {
    const internal = await this.getInternal();

    const lines: string[] = [];
    lines.push("=== QRCode Debug Info ===");
    lines.push(`Data: ${typeof this.data === "string" ? this.data : "[segments]"}`);
    lines.push(`Version: ${internal.version}`);
    lines.push(`Error Correction: ${internal.errorCorrectionLevel}`);
    lines.push(`Mask Pattern: ${internal.maskPattern ?? "auto"}`);
    lines.push(`Module Size: ${internal.modules.size}x${internal.modules.size}`);
    lines.push("");
    lines.push(this.toASCIIArt(internal));
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generate an ASCII art representation of the QR code modules.
   *
   * Uses Unicode block characters for a dense, readable visualisation.
   * Dark modules are represented as ██, light modules as `  ` (double space).
   *
   * @param internal - An already-resolved internal QR code representation.
   * @returns A multiline string with the ASCII art QR code.
   */
  private toASCIIArt(internal: QRCodeInternal): string {
    const { modules } = internal;
    const size = modules.size;
    const lines: string[] = [];

    for (let row = 0; row < size; row++) {
      let line = "";
      for (let col = 0; col < size; col++) {
        // get(): bit value at (row, col) — 1 = dark module
        line += modules.get(row, col) ? "██" : "  ";
      }
      lines.push(line);
    }

    return lines.join("\n");
  }

  /**
   * Get the raw module matrix for advanced debugging.
   *
   * Returns a 2D array where `1` represents a dark module and `0` a light module.
   * The outer array is indexed by row, the inner by column.
   */
  async toMatrix(): Promise<number[][]> {
    const internal = await this.getInternal();
    const { modules } = internal;
    const size = modules.size;
    const matrix: number[][] = [];

    for (let row = 0; row < size; row++) {
      const rowData: number[] = [];
      for (let col = 0; col < size; col++) {
        rowData.push(modules.get(row, col));
      }
      matrix.push(rowData);
    }

    return matrix;
  }

  private toRenderersOptions(format: QRCodeStringFormat): QRCodeRenderersOptions {
    return {
      margin: format.margin,
      scale: format.scale,
    };
  }
}
