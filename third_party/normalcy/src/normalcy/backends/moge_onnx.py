"""MoGe-2 (Microsoft, MIT) via ONNX Runtime — the portable AI default.

Uses the official ONNX exports (`Ruicheng/moge-2-vit{s,b,l}-normal-onnx`):
raw forward pass with dynamic resolution, outputs affine point map, surface
normals (native — no lossy depth→normal step), validity mask, metric scale.
The omitted post-processing (focal recovery, shift correction) is not needed
for sprites: we only want relative depth + normals inside a silhouette.
"""

from __future__ import annotations

from functools import cached_property
from typing import Any

import cv2
import numpy as np

from ..post import fill_nearest
from ..types import F32, Caps, GeometryResult, ProbeResult

MODEL_REPOS = {
    "vits": "Ruicheng/moge-2-vits-normal-onnx",
    "vitb": "Ruicheng/moge-2-vitb-normal-onnx",
    "vitl": "Ruicheng/moge-2-vitl-normal-onnx",
}
PATCH = 14
ALPHA_THRESHOLD = 0.5
MASK_THRESHOLD = 0.5


def _inference_dims(width: int, height: int, token_budget: int) -> tuple[int, int, int]:
    """Pick H,W (multiples of the ViT patch size) so token count ≈ budget."""
    scale = float(np.sqrt(token_budget * PATCH * PATCH / (width * height)))
    w = max(PATCH, round(width * scale / PATCH) * PATCH)
    h = max(PATCH, round(height * scale / PATCH) * PATCH)
    return w, h, (w // PATCH) * (h // PATCH)


class MogeOnnxBackend:
    name = "moge-onnx"

    def __init__(
        self,
        size: str = "vits",
        device: str = "cpu",
        token_budget: int = 1800,
    ) -> None:
        if size not in MODEL_REPOS:
            raise ValueError(f"unknown MoGe size {size!r}; expected one of {sorted(MODEL_REPOS)}")
        self.size = size
        self.device = device
        self.token_budget = token_budget
        self._resolved_providers: list[str] = []

    def capabilities(self) -> Caps:
        return Caps(depth=True, normal=True, mask=True, deterministic=self.device == "cpu")

    def _providers(self) -> list[Any]:
        import onnxruntime as ort

        available = ort.get_available_providers()
        providers: list[Any] = []
        if self.device in ("coreml", "auto") and "CoreMLExecutionProvider" in available:
            providers.append("CoreMLExecutionProvider")
        if self.device in ("cuda", "auto") and "CUDAExecutionProvider" in available:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")
        return providers

    @cached_property
    def _session(self) -> Any:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        model_path = hf_hub_download(MODEL_REPOS[self.size], "model.onnx")
        session = ort.InferenceSession(model_path, providers=self._providers())
        self._resolved_providers = list(session.get_providers())
        return session

    def probe(self) -> ProbeResult:
        try:
            import onnxruntime as ort
        except ImportError:
            return ProbeResult(
                available=False, device="none", detail="onnxruntime not installed (pip extra: ai)"
            )
        try:
            from huggingface_hub import hf_hub_download

            hf_hub_download(MODEL_REPOS[self.size], "model.onnx")
        except Exception as exc:  # model not cached and not downloadable
            return ProbeResult(available=False, device="none", detail=f"model unavailable: {exc}")
        return ProbeResult(
            available=True,
            device=self.device,
            detail=f"MoGe-2 {self.size} ONNX; providers={ort.get_available_providers()}",
        )

    def infer(self, rgb: F32, alpha: F32) -> GeometryResult:
        src_h, src_w = rgb.shape[:2]
        infer_w, infer_h, num_tokens = _inference_dims(src_w, src_h, self.token_budget)
        resized = cv2.resize(rgb, (infer_w, infer_h), interpolation=cv2.INTER_AREA)

        image = resized.transpose(2, 0, 1)[None].astype(np.float32)
        points, normal, model_mask, _scale = self._session.run(
            None, {"image": image, "num_tokens": np.array(num_tokens, dtype=np.int64)}
        )

        depth = points[0, ..., 2].astype(np.float32)  # camera-space z, larger = farther
        normal = normal[0].astype(np.float32)
        valid = model_mask[0] > MASK_THRESHOLD

        # MoGe uses OpenCV camera coordinates (x right, y down, z forward);
        # canonical space is OpenGL (x right, y up, z toward viewer).
        normal[..., 1] = -normal[..., 1]
        normal[..., 2] = -normal[..., 2]

        # Model-invalid pixels inside the sprite get nearest valid values; the
        # sprite alpha, not the model mask, is the authority on the silhouette.
        if valid.any():
            depth = fill_nearest(depth, valid)
            for c in range(3):
                normal[..., c] = fill_nearest(normal[..., c], valid)

        depth = cv2.resize(depth, (src_w, src_h), interpolation=cv2.INTER_LINEAR)
        normal = cv2.resize(normal, (src_w, src_h), interpolation=cv2.INTER_LINEAR)
        norm = np.linalg.norm(normal, axis=-1, keepdims=True)
        normal = (normal / np.maximum(norm, 1e-8)).astype(np.float32)

        mask = alpha > ALPHA_THRESHOLD
        return GeometryResult(depth=depth.astype(np.float32), normal=normal, mask=mask)
