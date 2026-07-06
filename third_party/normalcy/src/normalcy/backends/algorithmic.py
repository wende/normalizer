"""Zero-dependency algorithmic backend: bevel-from-alpha + luminance detail.

Clean-room implementation of the classic sprite normal-map recipe (Sobel on a
synthesized height field); the always-available fallback and blend partner.
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy import ndimage

from ..post import normals_from_height
from ..types import F32, Caps, GeometryResult, ProbeResult

ALPHA_THRESHOLD = 0.5


class AlgorithmicBackend:
    name = "algorithmic"

    def __init__(
        self,
        bevel_weight: float = 0.65,
        detail_weight: float = 0.35,
        strength: float = 1.0,
    ) -> None:
        self.bevel_weight = bevel_weight
        self.detail_weight = detail_weight
        self.strength = strength

    def capabilities(self) -> Caps:
        return Caps(depth=True, normal=True, mask=True, deterministic=True)

    def probe(self) -> ProbeResult:
        return ProbeResult(available=True, device="cpu", detail="pure NumPy/OpenCV, no ML")

    def infer(self, rgb: F32, alpha: F32) -> GeometryResult:
        mask = alpha > ALPHA_THRESHOLD

        # Rounded bevel: distance from the silhouette edge, square-rooted so the
        # profile is spherical rather than conical.
        dist = ndimage.distance_transform_edt(mask).astype(np.float32)
        peak = float(dist.max())
        bevel = np.sqrt(dist / peak) if peak > 0 else dist

        # Luminance detail, lightly blurred so single-pixel noise doesn't spike.
        lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
        detail = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 1.0)

        height = (self.bevel_weight * bevel + self.detail_weight * detail).astype(np.float32)
        height[~mask] = 0.0

        depth = (1.0 - height).astype(np.float32)  # smaller = closer
        normal = normals_from_height(height, mask, strength=self.strength)
        return GeometryResult(depth=depth, normal=normal, mask=mask)
