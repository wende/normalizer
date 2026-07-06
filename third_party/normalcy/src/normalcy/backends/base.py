"""The backend adapter contract (PLAN.md §Architecture)."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..types import F32, Caps, GeometryResult, ProbeResult


@runtime_checkable
class GeometryBackend(Protocol):
    """Every backend converts to the canonical representation defined in
    `GeometryResult`; no backend-specific behavior leaks past this interface."""

    name: str

    def capabilities(self) -> Caps: ...

    def probe(self) -> ProbeResult: ...

    def infer(self, rgb: F32, alpha: F32) -> GeometryResult:
        """rgb: (H,W,3) float32 in [0,1], already composited onto a background.
        alpha: (H,W) float32 in [0,1], the sprite silhouette.
        Returns maps at the same (H,W) as the input."""
        ...
