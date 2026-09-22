import { describe, expect, test } from "vitest";
import { QRCode } from "./QRCode.js";

describe("QRCode data structure - creation", () => {
  test("creates instance from URL string", () => {
    const url = "https://example.com/pair?token=abc123";
    const qr = new QRCode(url);
    expect(qr).toBeInstanceOf(QRCode);
    expect(qr.data).toBe(url);
  });

  test("creates instance with custom error correction level", () => {
    const qr = new QRCode("https://example.com", {
      errorCorrectionLevel: "H",
    });
    expect(qr).toBeInstanceOf(QRCode);
  });

  test("creates instance with version and mask pattern", () => {
    const qr = new QRCode("https://example.com", {
      version: 5,
      maskPattern: 3,
    });
    expect(qr).toBeInstanceOf(QRCode);
  });
});

describe("QRCode toString - terminal format", () => {
  test("generates terminal string output (small)", async () => {
    const url = "https://chisa.example/pair?code=xyz";
    const qr = new QRCode(url);
    const result = await qr.toString({ type: "terminal", small: true });

    expect(result).toBeTypeOf("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("generates terminal string output (normal)", async () => {
    const url = "https://example.com";
    const qr = new QRCode(url);
    const result = await qr.toString({ type: "terminal", small: false });

    expect(result).toBeTypeOf("string");
    expect(result.length).toBeGreaterThan(0);
    // Both modes should produce valid output
    const small = await qr.toString({ type: "terminal", small: true });
    expect(small).toBeTypeOf("string");
    expect(small.length).toBeGreaterThan(0);
    // Both should be non-empty strings (they may be equal for very short URLs)
    expect(typeof result).toBe("string");
    expect(typeof small).toBe("string");
  });
});

describe("QRCode toString - UTF-8 format", () => {
  test("generates UTF-8 string output", async () => {
    const url = "https://example.com";
    const qr = new QRCode(url);
    const result = await qr.toString({ type: "utf8" });

    expect(result).toBeTypeOf("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("default format is UTF-8", async () => {
    const qr = new QRCode("https://example.com");
    const result = await qr.toString();

    expect(result).toBeTypeOf("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("QRCode toDataURL", () => {
  test("generates PNG data URL", async () => {
    const url = "https://example.com/pair";
    const qr = new QRCode(url);
    const dataUrl = await qr.toDataURL();

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  test("generates data URL with custom width", async () => {
    const qr = new QRCode("https://example.com");
    const dataUrl = await qr.toDataURL({ width: 200 });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("generates data URL with custom colors", async () => {
    const qr = new QRCode("https://example.com");
    const dataUrl = await qr.toDataURL({
      color: {
        dark: "#0000ff",
        light: "#ffffff",
      },
    });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test("generates PNG data URL by default type", async () => {
    const qr = new QRCode("https://example.com");
    const dataUrl = await qr.toDataURL({
      type: "image/png",
    });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("QRCode debug format - toDebugString", () => {
  test("produces human-readable debug output with ASCII art", async () => {
    const url = "https://debug.example";
    const qr = new QRCode(url);
    const debug = await qr.toDebugString();

    expect(debug).toBeTypeOf("string");
    expect(debug.length).toBeGreaterThan(0);
    // Should include the URL in debug output for traceability
    expect(debug).toContain(url);
    // Should include metadata sections
    expect(debug).toContain("=== QRCode Debug Info ===");
    expect(debug).toContain("Version:");
    expect(debug).toContain("Error Correction:");
    expect(debug).toContain("Mask Pattern:");
    expect(debug).toContain("Module Size:");
  });

  test("ASCII art uses block characters for dark modules", async () => {
    const qr = new QRCode("https://test.example");
    const debug = await qr.toDebugString();

    // The ASCII art should contain Unicode block characters
    expect(debug).toContain("██");
  });

  test("ASCII art has consistent line widths", async () => {
    const qr = new QRCode("https://test.example");
    const debug = await qr.toDebugString();

    // Extract ASCII art lines (after the metadata and blank line)
    const parts = debug.split("\n");
    const artStart = parts.findIndex((line) => line.includes("██") || line.includes("  "));
    expect(artStart).toBeGreaterThan(-1);

    // Find the range of ASCII art lines
    const artLines = parts.slice(artStart).filter((line) => line.length > 0);
    expect(artLines.length).toBeGreaterThan(5);

    // All art lines should have the same length (width)
    const firstWidth = artLines[0].length;
    for (const line of artLines) {
      expect(line.length).toBe(firstWidth);
    }
  });
});

describe("QRCode toMatrix", () => {
  test("returns 2D array with correct dimensions", async () => {
    const qr = new QRCode("https://example.com");
    const matrix = await qr.toMatrix();

    expect(matrix).toBeInstanceOf(Array);
    expect(matrix.length).toBeGreaterThan(0);

    // Height = width for QR codes
    const height = matrix.length;
    const width = matrix[0].length;
    expect(height).toBe(width);

    // Each cell should be 0 or 1
    for (const row of matrix) {
      for (const cell of row) {
        expect([0, 1]).toContain(cell);
      }
    }
  });

  test("has finder patterns in corners", async () => {
    const qr = new QRCode("https://example.com");
    const matrix = await qr.toMatrix();

    // Top-left finder pattern: 7x7 block
    // Check that there are dark modules in the top-left area
    const topLeftDark = [];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        if (matrix[row][col] === 1) topLeftDark.push([row, col]);
      }
    }
    expect(topLeftDark.length).toBeGreaterThan(0);
  });
});

describe("QRCode - edge cases", () => {
  test("handles short URLs", async () => {
    const qr = new QRCode("https://a.co");
    const dataUrl = await qr.toDataURL();
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const debug = await qr.toDebugString();
    expect(debug).toContain("https://a.co");
  });

  test("handles long URLs", async () => {
    const longUrl =
      "https://very-long-url.example.com/path/to/deep/resource?with=many&query=params&and=more";
    const qr = new QRCode(longUrl);
    const dataUrl = await qr.toDataURL();
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);

    const debug = await qr.toDebugString();
    expect(debug).toContain(longUrl);
  });

  test("creates different QR codes for different data", async () => {
    const qr1 = new QRCode("https://example.com/api/v1");
    const qr2 = new QRCode("https://example.com/api/v2");

    const matrix1 = await qr1.toMatrix();
    const matrix2 = await qr2.toMatrix();

    // Different data should produce different QR codes
    const str1 = JSON.stringify(matrix1);
    const str2 = JSON.stringify(matrix2);
    expect(str1).not.toBe(str2);
  });
});
