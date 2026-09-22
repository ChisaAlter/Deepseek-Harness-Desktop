"""Legacy plus-mark PNG. The checked-in whale icon is rendered by scripts/render-icon.js."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 256
BG = (11, 13, 18, 255)
RING = (110, 168, 255, 255)
CORE = (232, 238, 249, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def blend(dst: list[int], x: int, y: int, color: tuple[int, int, int, int], alpha: float) -> None:
    if not (0 <= x < SIZE and 0 <= y < SIZE) or alpha <= 0:
        return
    i = (y * SIZE + x) * 4
    a = max(0.0, min(1.0, alpha))
    for c in range(3):
        dst[i + c] = int(dst[i + c] * (1 - a) + color[c] * a)
    dst[i + 3] = 255


def paint_disk(pixels: list[int], cx: float, cy: float, radius: float, color: tuple[int, int, int, int]) -> None:
    r = radius + 1.5
    x0, x1 = int(cx - r), int(cx + r) + 1
    y0, y1 = int(cy - r), int(cy + r) + 1
    for y in range(y0, y1):
        for x in range(x0, x1):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            blend(pixels, x, y, color, radius + 0.5 - d)


def paint_ring(pixels: list[int], cx: float, cy: float, radius: float, width: float, color: tuple[int, int, int, int]) -> None:
    outer = radius + width / 2
    inner = radius - width / 2
    r = outer + 1.5
    x0, x1 = int(cx - r), int(cx + r) + 1
    y0, y1 = int(cy - r), int(cy + r) + 1
    for y in range(y0, y1):
        for x in range(x0, x1):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            alpha = min(outer + 0.5 - d, d - (inner - 0.5))
            blend(pixels, x, y, color, alpha)


def paint_bar(pixels: list[int], x0: float, y0: float, x1: float, y1: float, width: float, color: tuple[int, int, int, int]) -> None:
    # axis-aligned rounded capsule
    if abs(x1 - x0) >= abs(y1 - y0):
        left, right = sorted((x0, x1))
        cy = (y0 + y1) / 2
        for y in range(int(cy - width), int(cy + width) + 2):
            for x in range(int(left - width), int(right + width) + 2):
                if x + 0.5 < left:
                    d = ((x + 0.5 - left) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
                elif x + 0.5 > right:
                    d = ((x + 0.5 - right) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
                else:
                    d = abs(y + 0.5 - cy)
                blend(pixels, x, y, color, width / 2 + 0.4 - d)
    else:
        top, bottom = sorted((y0, y1))
        cx = (x0 + x1) / 2
        for y in range(int(top - width), int(bottom + width) + 2):
            for x in range(int(cx - width), int(cx + width) + 2):
                if y + 0.5 < top:
                    d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - top) ** 2) ** 0.5
                elif y + 0.5 > bottom:
                    d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - bottom) ** 2) ** 0.5
                else:
                    d = abs(x + 0.5 - cx)
                blend(pixels, x, y, color, width / 2 + 0.4 - d)


def main() -> None:
    pixels = [0] * (SIZE * SIZE * 4)
    for y in range(SIZE):
        for x in range(SIZE):
            # rounded square background
            radius = 56
            dx = min(x + 0.5, SIZE - (x + 0.5))
            dy = min(y + 0.5, SIZE - (y + 0.5))
            if dx >= radius or dy >= radius:
                inside = 1.0
            else:
                d = ((radius - dx) ** 2 + (radius - dy) ** 2) ** 0.5
                inside = radius + 0.5 - d
            blend(pixels, x, y, BG, inside)

    cx = cy = SIZE / 2
    paint_ring(pixels, cx, cy, 78, 14, RING)
    paint_bar(pixels, 86, 128, 170, 128, 12, RING)
    paint_bar(pixels, 128, 86, 128, 170, 12, RING)
    paint_disk(pixels, cx, cy, 18, CORE)

    raw = b"".join(
        b"\x00" + bytes(pixels[y * SIZE * 4 : (y + 1) * SIZE * 4])
        for y in range(SIZE)
    )
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )
    out = Path(__file__).resolve().parents[1] / "assets" / "icon.png"
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
