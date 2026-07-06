"""End-to-end pipeline: ingest → preprocess → geometry → post → export-ready maps."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import post, preprocess
from .backends import GeometryBackend
from .ingest import Frame
from .types import F32, BoolMask, GeometryResult


@dataclass
class PipelineOptions:
    background: str = "mean"  # composite color: mean | gray | white | black
    strength: float = 1.0  # detail strength for algorithmic normals / hybrid blend
    volume: float = 1.0  # >1 steepens normals, <1 flattens (form boost)
    extrude: int = 4  # px of edge extrusion past the alpha boundary
    detail_blend: float = 0.0  # >0: blend algorithmic detail over AI form (hybrid)
    maps: tuple[str, ...] = ("normal", "height", "ao", "specular")


@dataclass
class FrameMaps:
    """Final uint8/uint16 maps at source resolution for one frame."""

    encoded: dict[str, np.ndarray] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)


def _infer_frame(
    frame: Frame, backend: GeometryBackend, options: PipelineOptions
) -> tuple[GeometryResult, F32, BoolMask, int]:
    """Upscale, composite, run geometry. Returns result at working resolution."""
    factor = preprocess.upscale_factor(frame.width, frame.height)
    upscaled = preprocess.upscale_nn(frame.rgba, factor)
    rgb, alpha = preprocess.composite_background(upscaled, options.background)
    result = backend.infer(rgb, alpha)
    return result, rgb, result.mask, factor


def _finalize_frame(
    frame: Frame,
    result: GeometryResult,
    rgb: F32,
    options: PipelineOptions,
    depth_lo_hi: tuple[float, float] | None,
    detail_normal: F32 | None,
) -> FrameMaps:
    """Normalize, derive maps, downsample to source resolution, extrude, encode."""
    mask = result.mask
    depth_norm = post.normalize_depth(result.depth, mask, depth_lo_hi)
    height = post.height_from_depth(depth_norm, mask)

    normal = post.renormalize(result.normal, mask)
    normal = post.boost_normals(normal, options.volume, mask)
    if detail_normal is not None and options.detail_blend > 0:
        normal = post.blend_normals(normal, detail_normal, options.detail_blend)
        normal[~mask] = post.FLAT_NORMAL

    ao = post.ao_from_height(height, mask)
    spec = post.specular_from_luminance(rgb, mask)

    src_size = (frame.height, frame.width)
    small_mask = post.resize_mask(mask, src_size)
    normal = post.resize_normals(normal, src_size, small_mask)
    height = post.resize_map(height, src_size)
    ao = post.resize_map(ao, src_size)
    spec = post.resize_map(spec, src_size)

    normal = post.extrude_edges(normal, small_mask, options.extrude)
    height = post.extrude_edges(height, small_mask, options.extrude)
    ao = post.extrude_edges(ao, small_mask, options.extrude)
    spec = post.extrude_edges(spec, small_mask, options.extrude)

    out = FrameMaps()
    if "normal" in options.maps:
        out.encoded["normal"] = post.encode_normal_u8(normal)
    if "height" in options.maps:
        out.encoded["height"] = post.encode_gray_u16(height)
    if "ao" in options.maps:
        out.encoded["ao"] = post.encode_gray_u8(ao)
    if "specular" in options.maps:
        out.encoded["specular"] = post.encode_gray_u8(spec)
    return out


def process_frames(
    frames: list[Frame],
    backend: GeometryBackend,
    options: PipelineOptions,
    detail_backend: GeometryBackend | None = None,
) -> list[FrameMaps]:
    """Process frames with shared depth normalization so animations don't flicker.

    detail_backend: when set (hybrid profile), its normals are UDN-blended as
    high-frequency detail over the primary backend's low-frequency form.
    """
    inferred: list[tuple[Frame, GeometryResult, F32]] = []
    detail_normals: list[F32 | None] = []
    for frame in frames:
        result, rgb, _, _ = _infer_frame(frame, backend, options)
        inferred.append((frame, result, rgb))
        if detail_backend is not None:
            detail_result, _, _, _ = _infer_frame(frame, detail_backend, options)
            detail_normals.append(detail_result.normal)
        else:
            detail_normals.append(None)

    # Shared normalization: one depth range across the whole animation/sheet.
    lo_hi: tuple[float, float] | None = None
    if len(inferred) > 1:
        ranges = [
            post.depth_range(result.depth, result.mask)
            for _, result, _ in inferred
            if result.mask.any()
        ]
        if ranges:
            lo_hi = (min(r[0] for r in ranges), max(r[1] for r in ranges))

    return [
        _finalize_frame(frame, result, rgb, options, lo_hi, detail)
        for (frame, result, rgb), detail in zip(inferred, detail_normals, strict=True)
    ]
