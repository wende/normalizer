"""Engine export presets and the JSON sidecar (the non-destructive project file)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import orjson
from PIL import Image


@dataclass(frozen=True)
class EnginePreset:
    name: str
    flip_green: bool  # False = OpenGL Y+ (green up), True = DirectX Y-
    notes: str


PRESETS = {
    "godot": EnginePreset(
        "godot", flip_green=False, notes="CanvasTexture: normal_texture + specular_texture"
    ),
    "unity": EnginePreset(
        "unity",
        flip_green=False,
        notes="URP 2D Renderer secondary textures: _NormalMap, _MaskTex; "
        "atlas layout must match the diffuse atlas",
    ),
    "unreal": EnginePreset(
        "unreal", flip_green=True, notes="Paper2D lit sprite material, DirectX-convention normal"
    ),
    "gl": EnginePreset("gl", flip_green=False, notes="generic OpenGL Y+ convention"),
    "dx": EnginePreset("dx", flip_green=True, notes="generic DirectX Y- convention"),
}

SUFFIXES = {"normal": "_n", "height": "_h", "ao": "_ao", "specular": "_s"}


def save_png(path: Path, array: np.ndarray) -> None:
    # uint16 arrays become 16-bit grayscale PNGs (height maps need the
    # precision for displacement); everything else is 8-bit.
    Image.fromarray(array).save(path)


def export_maps(
    out_dir: Path,
    stem: str,
    maps: dict[str, np.ndarray],
    preset: EnginePreset,
    settings: dict[str, Any],
) -> dict[str, str]:
    """Write map PNGs plus a sidecar JSON with full settings provenance."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, str] = {}
    for kind, array in maps.items():
        filename = f"{stem}{SUFFIXES[kind]}.png"
        save_png(out_dir / filename, array)
        written[kind] = filename

    sidecar = {
        "normalcy": settings.pop("version", "0.1.0"),
        "engine": {
            "preset": preset.name,
            "normal_convention": "directx-y-down" if preset.flip_green else "opengl-y-up",
            "notes": preset.notes,
        },
        "maps": written,
        "settings": settings,
    }
    sidecar_path = out_dir / f"{stem}.normalcy.json"
    sidecar_path.write_bytes(orjson.dumps(sidecar, option=orjson.OPT_INDENT_2))
    written["sidecar"] = sidecar_path.name
    return written
