"""Shared array types and the canonical geometry interchange format."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

F32 = npt.NDArray[np.float32]
U8 = npt.NDArray[np.uint8]
BoolMask = npt.NDArray[np.bool_]


@dataclass(frozen=True)
class Caps:
    """What a geometry backend can produce natively."""

    depth: bool
    normal: bool
    mask: bool
    deterministic: bool


@dataclass(frozen=True)
class ProbeResult:
    available: bool
    device: str
    detail: str


@dataclass
class GeometryResult:
    """Canonical intermediate representation, at the resolution of the input image.

    depth:  (H, W) float32 raw relative depth, smaller = closer to camera.
            Un-normalized so the pipeline can normalize per-frame or across
            an animation. Values outside `mask` are undefined.
    normal: (H, W, 3) float32 unit normals in OpenGL camera space
            (x right, y up, z toward the viewer). Undefined outside `mask`.
    mask:   (H, W) bool validity mask (sprite silhouette ∩ model validity).
    """

    depth: F32
    normal: F32
    mask: BoolMask
