"""Prepare sprite frames for geometry inference."""

from __future__ import annotations

import numpy as np

from .types import F32, U8

# Photo-trained models need enough pixels to see structure; pixel art must be
# upscaled with nearest-neighbor so edges stay crisp (RESEARCH.md §5.1).
TARGET_LONG_SIDE = 512
MAX_UPSCALE = 8


def upscale_factor(width: int, height: int, target: int = TARGET_LONG_SIDE) -> int:
    """Integer nearest-neighbor factor so the long side reaches ~target."""
    long_side = max(width, height)
    if long_side >= target:
        return 1
    return min(MAX_UPSCALE, max(1, round(target / long_side)))


def upscale_nn(rgba: U8, factor: int) -> U8:
    if factor == 1:
        return rgba
    return np.repeat(np.repeat(rgba, factor, axis=0), factor, axis=1)


def composite_background(rgba: U8, background: str = "gray") -> tuple[F32, F32]:
    """Composite straight-alpha RGBA onto an opaque background.

    Returns (rgb in [0,1] float32, alpha in [0,1] float32). Models expect full
    rectangular frames; the background choice changes predicted geometry, so it
    is a setting (Spike Q2 picks per-model defaults).
    """
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha = rgba[..., 3].astype(np.float32) / 255.0
    if background == "white":
        bg = np.array([1.0, 1.0, 1.0], dtype=np.float32)
    elif background == "black":
        bg = np.array([0.0, 0.0, 0.0], dtype=np.float32)
    elif background == "mean":
        opaque = alpha > 0.5
        bg = (
            rgb[opaque].mean(axis=0).astype(np.float32)
            if opaque.any()
            else np.array([0.5, 0.5, 0.5], dtype=np.float32)
        )
    else:  # gray
        bg = np.array([0.5, 0.5, 0.5], dtype=np.float32)
    composited = rgb * alpha[..., None] + bg * (1.0 - alpha[..., None])
    return composited.astype(np.float32), alpha
