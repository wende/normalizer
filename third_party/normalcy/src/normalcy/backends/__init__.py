"""Geometry backends. Import concrete backends lazily via `get_backend`."""

from __future__ import annotations

from .base import GeometryBackend


def get_backend(name: str, **kwargs: object) -> GeometryBackend:
    if name in ("algo", "algorithmic"):
        from .algorithmic import AlgorithmicBackend

        return AlgorithmicBackend(**kwargs)  # type: ignore[arg-type]
    if name in ("ai", "moge", "moge-onnx"):
        from .moge_onnx import MogeOnnxBackend

        return MogeOnnxBackend(**kwargs)  # type: ignore[arg-type]
    raise ValueError(f"unknown backend: {name!r}")


__all__ = ["GeometryBackend", "get_backend"]
