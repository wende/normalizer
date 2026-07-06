"""Post-processing: normalization, normals from height, AO, extrusion, encoding."""

from __future__ import annotations

import cv2
import numpy as np
import numpy.typing as npt
from scipy import ndimage

from .types import F32, U8, BoolMask

FLAT_NORMAL = np.array([0.0, 0.0, 1.0], dtype=np.float32)


def normalize_depth(depth: F32, mask: BoolMask, lo_hi: tuple[float, float] | None = None) -> F32:
    """Map raw depth to [0,1] inside the mask (0 = closest). Pass lo_hi to share
    a normalization range across animation frames."""
    out = np.zeros_like(depth, dtype=np.float32)
    if not mask.any():
        return out
    values = depth[mask]
    if lo_hi is None:
        lo, hi = float(np.percentile(values, 2)), float(np.percentile(values, 98))
    else:
        lo, hi = lo_hi
    if hi - lo < 1e-8:
        out[mask] = 0.5
        return out
    out[mask] = np.clip((depth[mask] - lo) / (hi - lo), 0.0, 1.0)
    return out


def depth_range(depth: F32, mask: BoolMask) -> tuple[float, float]:
    values = depth[mask]
    if values.size == 0:
        return (0.0, 1.0)
    return (float(np.percentile(values, 2)), float(np.percentile(values, 98)))


def height_from_depth(depth_norm: F32, mask: BoolMask) -> F32:
    """Height map: 1 = raised/near, 0 = far or background."""
    height = np.where(mask, 1.0 - depth_norm, 0.0).astype(np.float32)
    return height


def fill_nearest(values: F32, valid: BoolMask) -> F32:
    """Replace invalid pixels with their nearest valid neighbor's value."""
    if valid.all() or not valid.any():
        return values
    _, (iy, ix) = ndimage.distance_transform_edt(~valid, return_indices=True)
    filled: np.ndarray = values[iy, ix]
    return filled.astype(np.float32)


def normals_from_height(height: F32, mask: BoolMask, strength: float = 1.0) -> F32:
    """Silhouette-aware height→normal: gradients never cross the alpha edge
    because outside values are replaced by nearest inside values first."""
    filled = fill_nearest(height, mask)
    gy, gx = np.gradient(filled.astype(np.float32))
    # Height in [0,1] is treated as a relief whose amplitude is ~15% of the
    # sprite's long side, so perceived volume is resolution-independent.
    amplitude = strength * float(max(height.shape)) * 0.15
    # OpenGL convention: x right, y up (image y axis points down, so negate gy).
    nx = -gx * amplitude
    ny = gy * amplitude
    nz = np.ones_like(nx)
    normal = np.stack([nx, ny, nz], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal[~mask] = FLAT_NORMAL
    return normal.astype(np.float32)


def renormalize(normal: F32, mask: BoolMask | None = None) -> F32:
    norm = np.linalg.norm(normal, axis=-1, keepdims=True)
    out = (normal / np.maximum(norm, 1e-8)).astype(np.float32)
    if mask is not None:
        out[~mask] = FLAT_NORMAL
    return out


def boost_normals(normal: F32, factor: float, mask: BoolMask) -> F32:
    """Volume slider: steepen (>1) or flatten (<1) normals by scaling their
    in-plane component. Photo-trained models under-predict relief on stylized
    sprites; this is the manual counterweight."""
    if factor == 1.0:
        return normal
    boosted = normal.copy()
    boosted[..., 0] *= factor
    boosted[..., 1] *= factor
    return renormalize(boosted, mask)


def blend_normals(base: F32, detail: F32, detail_weight: float = 0.5) -> F32:
    """UDN-style blend: low-frequency form from `base`, high-frequency from `detail`."""
    blended = base.copy()
    blended[..., 0] += detail[..., 0] * detail_weight
    blended[..., 1] += detail[..., 1] * detail_weight
    return renormalize(blended)


def ao_from_height(height: F32, mask: BoolMask, strength: float = 1.0) -> F32:
    """Multi-scale occlusion: pixels below their blurred neighborhood are occluded."""
    ao = np.ones_like(height, dtype=np.float32)
    sigmas = (2.0, 4.0, 8.0, 16.0)
    filled = fill_nearest(height, mask)
    for sigma in sigmas:
        blurred = cv2.GaussianBlur(filled, (0, 0), sigma)
        ao -= np.clip(blurred - filled, 0.0, 1.0) * (strength * 1.5 / len(sigmas))
    ao = np.clip(ao, 0.0, 1.0)
    ao[~mask] = 1.0
    return ao.astype(np.float32)


def specular_from_luminance(rgb: F32, mask: BoolMask) -> F32:
    """Heuristic helper: brighter pixels are treated as shinier."""
    lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    spec: F32 = (np.clip(lum, 0.0, 1.0) ** 1.5 * 0.8).astype(np.float32)
    spec[~mask] = 0.0
    return spec


def extrude_edges(values: F32, mask: BoolMask, pixels: int) -> F32:
    """Dilate map values `pixels` px past the alpha edge so bilinear sampling in
    engines doesn't bleed background values into sprite borders."""
    if pixels <= 0 or mask.all() or not mask.any():
        return values
    dist, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    ring = (~mask) & (dist <= pixels)
    out = values.copy()
    out[ring] = values[iy, ix][ring]
    return out


def resize_map(values: F32, size: tuple[int, int]) -> F32:
    """Resize (H,W) or (H,W,C) float map to (height, width) with area filtering."""
    h, w = size
    resized = cv2.resize(values, (w, h), interpolation=cv2.INTER_AREA)
    return resized.astype(np.float32)


def resize_mask(mask: BoolMask, size: tuple[int, int]) -> BoolMask:
    h, w = size
    resized = cv2.resize(mask.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST)
    return resized.astype(bool)


def resize_normals(normal: F32, size: tuple[int, int], mask: BoolMask) -> F32:
    return renormalize(resize_map(normal, size), mask)


def encode_normal_u8(normal: F32, flip_green: bool = False) -> U8:
    n = normal.copy()
    if flip_green:
        n[..., 1] = -n[..., 1]
    encoded: U8 = np.clip((n * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return encoded


def encode_gray_u8(values: F32) -> U8:
    encoded: U8 = np.clip(values * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return encoded


def encode_gray_u16(values: F32) -> npt.NDArray[np.uint16]:
    encoded: npt.NDArray[np.uint16] = np.clip(values * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
    return encoded
