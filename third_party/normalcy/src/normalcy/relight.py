"""Relight preview: shade a sprite with its normal map so results can be judged.

This is the built-in test for generated maps — no engine required. Lambertian
shading under a handful of light directions, laid out next to the flat diffuse
so flat or wrong normals are immediately visible.
"""

from __future__ import annotations

import math

import numpy as np

from .types import F32, U8

# (label, azimuth degrees) — light comes *from* this direction, CCW from +x.
DEFAULT_LIGHTS: tuple[tuple[str, float], ...] = (
    ("left", 180.0),
    ("top", 90.0),
    ("right", 0.0),
    ("bottom", 270.0),
)


def decode_normal_u8(encoded: U8, flip_green: bool = False) -> F32:
    """Inverse of post.encode_normal_u8: uint8 RGB back to unit normals."""
    normal = (encoded.astype(np.float32) / 255.0) * 2.0 - 1.0
    if flip_green:
        normal[..., 1] = -normal[..., 1]
    norm = np.linalg.norm(normal, axis=-1, keepdims=True)
    result: F32 = (normal / np.maximum(norm, 1e-8)).astype(np.float32)
    return result


def light_direction(azimuth_deg: float, elevation_deg: float = 30.0) -> F32:
    """Unit vector pointing from the surface toward the light (OpenGL space)."""
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    direction = np.array(
        [math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)],
        dtype=np.float32,
    )
    return direction


def relight(rgba: U8, normal: F32, light_dir: F32, ambient: float = 0.25) -> U8:
    """Lambertian shade: diffuse * (ambient + (1-ambient) * max(N·L, 0))."""
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    lambert = np.clip(np.einsum("hwc,c->hw", normal, light_dir), 0.0, 1.0)
    shade = ambient + (1.0 - ambient) * lambert
    lit = np.clip(rgb * shade[..., None] * 255.0 + 0.5, 0, 255).astype(np.uint8)
    out: U8 = np.dstack([lit, rgba[..., 3]])
    return out


def upscale_nn_rgba(rgba: U8, factor: int) -> U8:
    if factor <= 1:
        return rgba
    scaled: U8 = np.repeat(np.repeat(rgba, factor, axis=0), factor, axis=1)
    return scaled


def preview_strip(
    rgba: U8,
    normal_encoded: U8,
    flip_green: bool = False,
    lights: tuple[tuple[str, float], ...] = DEFAULT_LIGHTS,
    ambient: float = 0.25,
    scale: int = 0,
    gap: int = 2,
) -> U8:
    """One-row comparison: diffuse | normal map | relit under each light.

    scale=0 picks a nearest-neighbor factor so each panel's long side is
    at least 256 px (pixel art stays crisp and visible).
    """
    if scale <= 0:
        scale = max(1, math.ceil(256 / max(rgba.shape[0], rgba.shape[1])))

    normal = decode_normal_u8(normal_encoded, flip_green)
    panels: list[U8] = [rgba]
    normal_rgba: U8 = np.dstack(
        [normal_encoded, np.full(rgba.shape[:2], 255, dtype=np.uint8)]
    )
    panels.append(normal_rgba)
    for _, azimuth in lights:
        panels.append(relight(rgba, normal, light_direction(azimuth), ambient))

    scaled = [upscale_nn_rgba(panel, scale) for panel in panels]
    h = scaled[0].shape[0]
    spacer = np.zeros((h, gap * scale, 4), dtype=np.uint8)
    row: list[U8] = []
    for i, panel in enumerate(scaled):
        if i:
            row.append(spacer)
        row.append(panel)
    strip: U8 = np.hstack(row)
    return strip
