"""Load sprites and slice sprite sheets into frames."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from .types import U8


@dataclass(frozen=True)
class Frame:
    """One sprite frame plus its position in the source sheet."""

    rgba: U8  # (H, W, 4) uint8
    x: int
    y: int
    index: int

    @property
    def height(self) -> int:
        return int(self.rgba.shape[0])

    @property
    def width(self) -> int:
        return int(self.rgba.shape[1])


def load_rgba(path: Path) -> U8:
    """Load any image as straight-alpha RGBA uint8."""
    with Image.open(path) as img:
        return np.asarray(img.convert("RGBA"), dtype=np.uint8)


def slice_grid(rgba: U8, cols: int, rows: int) -> list[Frame]:
    """Slice a sheet into a cols x rows grid of equal tiles, row-major."""
    sheet_h, sheet_w = rgba.shape[:2]
    if sheet_w % cols or sheet_h % rows:
        raise ValueError(
            f"sheet {sheet_w}x{sheet_h} does not divide evenly into a {cols}x{rows} grid"
        )
    tile_w, tile_h = sheet_w // cols, sheet_h // rows
    frames: list[Frame] = []
    for row in range(rows):
        for col in range(cols):
            x, y = col * tile_w, row * tile_h
            tile = rgba[y : y + tile_h, x : x + tile_w].copy()
            frames.append(Frame(rgba=tile, x=x, y=y, index=len(frames)))
    return frames


def assemble_sheet(
    frames: list[Frame], maps: list[np.ndarray], sheet_shape: tuple[int, int]
) -> np.ndarray:
    """Place per-frame maps back into a full-sheet canvas, pixel-exact.

    All maps must share dtype and channel count; empty space is left at the
    fill value of the first map's dtype (0).
    """
    first = maps[0]
    channels = first.shape[2] if first.ndim == 3 else 1
    canvas_shape = (
        (sheet_shape[0], sheet_shape[1], channels) if channels > 1 else sheet_shape
    )
    canvas = np.zeros(canvas_shape, dtype=first.dtype)
    for frame, frame_map in zip(frames, maps, strict=True):
        canvas[frame.y : frame.y + frame.height, frame.x : frame.x + frame.width] = frame_map
    return canvas
