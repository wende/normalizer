#!/usr/bin/env python3
"""Generate deterministic PNG inputs for the golden-output corpus."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from golden_png import write_rgba_png


def offset(width: int, x: int, y: int) -> int:
    return (y * width + x) * 4


def write_image(path: Path, width: int, height: int, fill_pixel) -> None:
    rgba = bytearray(width * height * 4)
    for y in range(height):
        for x in range(width):
            rgba[offset(width, x, y) : offset(width, x, y) + 4] = bytes(fill_pixel(x, y))
    write_rgba_png(path, width, height, rgba)


def generate(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    write_image(
        out_dir / "opaque_gradient.png",
        96,
        80,
        lambda x, y: (
            (x * 255) // 95,
            (y * 255) // 79,
            ((x * 7 + y * 5) % 256),
            255,
        ),
    )

    def alpha_badge(x: int, y: int) -> tuple[int, int, int, int]:
        cx = (x - 48) / 32
        cy = (y - 48) / 28
        inside = cx * cx + cy * cy < 1
        edge = abs(cx * cx + cy * cy - 1)
        alpha = 255 if inside else 150 if edge < 0.08 else 0
        return (220 - y, 80 + x, 40 + ((x * y) % 120), alpha)

    write_image(out_dir / "alpha_badge.png", 96, 96, alpha_badge)

    def pixel_blocks(x: int, y: int) -> tuple[int, int, int, int]:
        bx = x // 8
        by = y // 8
        if (bx + by) % 3 == 0:
            return (235, 222, 64, 255)
        if (bx + by) % 3 == 1:
            return (44, 168, 220, 255)
        return (70, 44, 118, 255)

    write_image(out_dir / "pixel_blocks.png", 64, 64, pixel_blocks)

    def hard_edges(x: int, y: int) -> tuple[int, int, int, int]:
        square = 18 <= x < 78 and 16 <= y < 74
        cut = 38 <= x < 56 and 36 <= y < 54
        alpha = 255 if square and not cut else 0
        shade = 230 if x < 48 else 80
        return (shade, 210 - shade // 2, 90 + y, alpha)

    write_image(out_dir / "hard_edges.png", 96, 88, hard_edges)

    def soft_gradient(x: int, y: int) -> tuple[int, int, int, int]:
        value = int((math.sin(x / 8) * 0.5 + math.cos(y / 9) * 0.5 + 1) * 110)
        alpha = int(max(0, min(255, 255 - math.hypot(x - 48, y - 48) * 3)))
        return (value, 255 - value // 2, 120 + value // 3, alpha)

    write_image(out_dir / "soft_gradient_alpha.png", 96, 96, soft_gradient)

    def tiny_edges(x: int, y: int) -> tuple[int, int, int, int]:
        alpha = 255 if x in (1, 6) or y in (1, 6) or x == y else 0
        value = 40 + x * 20 + y * 9
        return (value, 255 - value, 80 + value // 2, alpha)

    write_image(out_dir / "tiny_edges.png", 8, 8, tiny_edges)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tests/fixtures/inputs/generated")
    args = parser.parse_args()
    generate(Path(args.out_dir))
    print(f"generated fixtures in {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
