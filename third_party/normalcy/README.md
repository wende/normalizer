# normalcy

Sprite-aware normal, height, AO, and specular map generation for 2D game assets.
Drop in a sprite or sprite sheet, pick an AI or algorithmic profile, export
engine-ready maps. See [PLAN.md](PLAN.md) for the roadmap and
[RESEARCH.md](RESEARCH.md) for the research behind it.

## Install

```sh
uv venv && uv pip install -e ".[ai,dev]"
```

The `ai` extra enables the MoGe-2 backend (ONNX Runtime + Hugging Face Hub);
without it the algorithmic backend still works.

## Usage

```sh
# Single sprite → Godot-ready maps (ball_n.png, ball_h.png, ball_ao.png, ball_s.png + sidecar)
normalcy generate ball.png --out maps/ --profile ai --engine godot

# Sprite sheet, sliced 4x2, shared depth normalization across frames
normalcy generate walk.png --grid 4x2 --profile ai

# Algorithmic only (no model download), DirectX-convention normals for Unreal
normalcy generate ball.png --profile algo --engine unreal

# Hybrid: AI form + algorithmic detail, with a volume boost
normalcy generate ball.png --profile hybrid --volume 1.5

# Which backends work on this machine?
normalcy doctor
```

Profiles:

- `ai` — MoGe-2 (ViT-S by default) via ONNX Runtime; native surface normals,
  runs on CPU in ~1–2 s per frame.
- `algo` — bevel-from-alpha + luminance detail; zero dependencies, always available.
- `hybrid` — AI low-frequency form blended with algorithmic high-frequency detail.

Key options: `--background mean|gray|white|black` (alpha composite color —
changes AI-predicted geometry), `--volume` (steepen/flatten normals),
`--extrude` (edge padding past the alpha boundary), `--model-size vits|vitb|vitl`,
`--device cpu|coreml|cuda|auto`.

Every export writes a `<name>.normalcy.json` sidecar recording the full
settings — the non-destructive project file.

## Development

```sh
uv run pytest          # unit + end-to-end tests
uv run ruff check src tests
uv run mypy
```
