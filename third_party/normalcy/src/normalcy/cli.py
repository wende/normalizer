from __future__ import annotations

from pathlib import Path

import typer

app = typer.Typer(help="Sprite-aware normal-map generation toolkit.")

PROFILES = ("ai", "algo", "hybrid")


@app.callback()
def main() -> None:
    """Sprite-aware normal-map generation toolkit."""


@app.command()
def doctor() -> None:
    """Report which geometry backends are usable on this machine."""
    from .backends import get_backend

    for name in ("algorithmic", "moge-onnx"):
        backend = get_backend(name)
        result = backend.probe()
        status = "ok" if result.available else "unavailable"
        typer.echo(f"[{status}] {backend.name}: {result.detail} (device: {result.device})")


@app.command()
def generate(
    source: Path = typer.Argument(..., exists=True, dir_okay=False, help="Sprite or sheet PNG"),
    out: Path = typer.Option(Path("."), "--out", "-o", help="Output directory"),
    profile: str = typer.Option("ai", "--profile", "-p", help="ai | algo | hybrid"),
    engine: str = typer.Option("godot", "--engine", "-e", help="godot | unity | unreal | gl | dx"),
    grid: str = typer.Option("", "--grid", "-g", help="Slice sheet as COLSxROWS, e.g. 4x2"),
    background: str = typer.Option("mean", "--background", help="mean | gray | white | black"),
    strength: float = typer.Option(1.0, "--strength", help="Normal detail strength"),
    volume: float = typer.Option(
        1.0, "--volume", help="Form boost: >1 steepens normals, <1 flattens"
    ),
    extrude: int = typer.Option(4, "--extrude", help="Edge extrusion in px past alpha"),
    detail_blend: float = typer.Option(
        0.35, "--detail-blend", help="Hybrid: algorithmic detail weight over AI form"
    ),
    model_size: str = typer.Option("vits", "--model-size", help="MoGe size: vits | vitb | vitl"),
    device: str = typer.Option("cpu", "--device", help="cpu | coreml | cuda | auto"),
) -> None:
    """Generate normal/height/AO/specular maps for a sprite or sprite sheet."""
    from . import __version__
    from .backends import get_backend
    from .export import PRESETS, export_maps
    from .ingest import Frame, assemble_sheet, load_rgba, slice_grid
    from .pipeline import PipelineOptions, process_frames

    if profile not in PROFILES:
        raise typer.BadParameter(f"profile must be one of {PROFILES}")
    if engine not in PRESETS:
        raise typer.BadParameter(f"engine must be one of {tuple(PRESETS)}")

    rgba = load_rgba(source)
    sheet_shape = (int(rgba.shape[0]), int(rgba.shape[1]))
    if grid:
        try:
            cols, rows = (int(part) for part in grid.lower().split("x"))
        except ValueError as exc:
            raise typer.BadParameter("grid must look like 4x2") from exc
        frames = slice_grid(rgba, cols, rows)
    else:
        frames = [Frame(rgba=rgba, x=0, y=0, index=0)]

    if profile == "algo":
        backend = get_backend("algorithmic", strength=strength)
        detail_backend = None
    else:
        backend = get_backend("moge-onnx", size=model_size, device=device)
        probe = backend.probe()
        if not probe.available:
            typer.echo(f"AI backend unavailable ({probe.detail}); falling back to algorithmic.")
            backend = get_backend("algorithmic", strength=strength)
        detail_backend = (
            get_backend("algorithmic", strength=strength) if profile == "hybrid" else None
        )

    options = PipelineOptions(
        background=background,
        strength=strength,
        volume=volume,
        extrude=extrude,
        detail_blend=detail_blend if profile == "hybrid" else 0.0,
    )
    typer.echo(
        f"Processing {len(frames)} frame(s) with {backend.name} "
        f"({backend.probe().device}), profile={profile}, engine={engine}"
    )
    frame_maps = process_frames(frames, backend, options, detail_backend)

    preset = PRESETS[engine]
    kinds = list(frame_maps[0].encoded)
    sheet_maps = {
        kind: assemble_sheet(frames, [fm.encoded[kind] for fm in frame_maps], sheet_shape)
        for kind in kinds
    }
    if preset.flip_green and "normal" in sheet_maps:
        sheet_maps["normal"][..., 1] = 255 - sheet_maps["normal"][..., 1]

    settings = {
        "version": __version__,
        "source": source.name,
        "profile": profile,
        "backend": backend.name,
        "device": backend.probe().device,
        "grid": grid or None,
        "background": background,
        "strength": strength,
        "volume": volume,
        "extrude": extrude,
        "detail_blend": options.detail_blend,
        "model_size": model_size if backend.name == "moge-onnx" else None,
    }
    written = export_maps(out, source.stem, sheet_maps, preset, settings)
    for kind, filename in written.items():
        typer.echo(f"  {kind}: {out / filename}")


@app.command()
def preview(
    source: Path = typer.Argument(..., exists=True, dir_okay=False, help="Sprite or sheet PNG"),
    maps: Path = typer.Option(
        Path("."), "--maps", "-m", help="Directory holding <name>_n.png and the sidecar"
    ),
    out: Path = typer.Option(
        None, "--out", "-o", help="Preview PNG path (default: <maps>/<name>_preview.png)"
    ),
    ambient: float = typer.Option(0.25, "--ambient", help="Ambient light floor, 0..1"),
    scale: int = typer.Option(
        0, "--scale", help="Nearest-neighbor upscale per panel (0 = auto to ~256px)"
    ),
) -> None:
    """Relight a sprite with its generated normal map — the built-in eyeball test.

    Writes one image: diffuse | normal map | relit from left/top/right/bottom.
    """
    import orjson

    from .export import save_png
    from .ingest import load_rgba
    from .relight import preview_strip

    normal_path = maps / f"{source.stem}_n.png"
    if not normal_path.exists():
        raise typer.BadParameter(
            f"{normal_path} not found — run `normalcy generate` first or point --maps at it"
        )

    flip_green = False
    sidecar_path = maps / f"{source.stem}.normalcy.json"
    if sidecar_path.exists():
        sidecar = orjson.loads(sidecar_path.read_bytes())
        flip_green = sidecar.get("engine", {}).get("normal_convention") == "directx-y-down"

    rgba = load_rgba(source)
    normal_encoded = load_rgba(normal_path)[..., :3]
    if normal_encoded.shape[:2] != rgba.shape[:2]:
        raise typer.BadParameter(
            f"normal map {normal_encoded.shape[1]}x{normal_encoded.shape[0]} does not match "
            f"sprite {rgba.shape[1]}x{rgba.shape[0]}"
        )

    strip = preview_strip(rgba, normal_encoded, flip_green, ambient=ambient, scale=scale)
    out_path = out if out is not None else maps / f"{source.stem}_preview.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    save_png(out_path, strip)
    typer.echo(f"Preview ({'DX' if flip_green else 'GL'} normals): {out_path}")


if __name__ == "__main__":
    app()
