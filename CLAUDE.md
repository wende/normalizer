# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`normalizer` is a Laigter-derived normal/texture-map generator (GPL-3.0). Two implementations share one source of truth:

- Browser UI (`web/`) — vanilla JS + Vite/Preact config, no build step for the modules it loads.
- Node CLI (`cli/normalizer.js`) — uses `pngjs` for PNG I/O, ES modules.

Both import pure-function algorithms from `shared/`. Upstream Laigter lives in `laigter/` as the porting reference and license root; the C++ rewrite (`core/`) is on the way out per `NORMALIZER_FEATURES.md`.

## Commands

All commands are run from the repo root.

| Task | Command |
|---|---|
| Install JS deps | `make install` (or `npm install`) |
| Build C++ core | `make` — produces `build/laigter-core-cli` |
| Run web server (dev) | `make web` (port 8765) or `PORT=9000 make web` |
| Run smoke (C++ CLI) | `make smoke` |
| Generate fixtures | `make fixtures` |
| Run golden suite against current impl | `make current-goldens` (uses C++ CLI by default) |
| Run Node CLI smoke against goldens | `make js-smoke` (requires `make install` first) |
| Regenerate goldens (manual path) | `make regenerate-goldens UPSTREAM_LAIGTER=/path/to/laigter` |
| Regenerate goldens (local Qt build) | `make regenerate-goldens-local` |
| Full golden gate | `make golden` — builds, regenerates `tests/golden/current/`, diffs via `scripts/diff_pngs.py` |
| Static file server (no API) | `make web-static` |
| Clean build artifacts | `make clean` |

The web server is static-only; it serves `web/`, `laigter/`, and `shared/`. No DB, no API endpoints, no native assets. AI generation runs entirely in the browser via `web/deepbump.worker.js`.

## Architecture

### Single source of truth: `shared/`

Pure-function ES modules, no DOM, no Node APIs. Record shape is `{ width, height, data }`; `ImageData` satisfies it structurally.

- `shared/image.js` — RGBA helpers. `grayscaleFromRgba` uses Qt `qGray` weights `(11r+16g+5b)/32` and zeros RGB for fully transparent pixels (required for upstream parity).
- `shared/primitives.js` — `edt1d` (Felzenszwalb), `alphaDistance` (two-pass EDT), `gaussianBlur` (finite-kernel, σ=radius/3, diverges from CImg's recursive IIR — see `JS_CORE_MIGRATION.md` §5.1), `smoothstep`.
- `shared/normal.js` — `generateNormalMap(source, params)` returns `{ width, height, data }`. Defaults live in `DEFAULT_NORMAL_PARAMS`. Blends three normal fields (emboss × 1.5 + bevel × 1.5 + height-overlay) into a tangent-space normal.

### Consumers

- `web/app.js` — imports from `shared/` via relative paths. UI state lives in a plain object, debounced 40ms, recomputed on the main thread today (single worker is a planned hygiene step in `NORMALIZER_FEATURES.md` §2).
- `cli/normalizer.js` — mirrors the C++ CLI's argument/exit contract so `scripts/run_core_cases.py --cli` can swap either. Uses `pngjs` for I/O.

### C++ core (retiring)

`core/` mirrors the JS core via CImg. The `Makefile` and `CMakeLists.txt` build it; once the JS CLI covers every flag and `make golden` passes against the Node CLI, delete `core/`, `CMakeLists.txt`, the C++ targets in `Makefile`, and `build/` per `JS_CORE_MIGRATION.md` §7.

### Golden harness

- `tests/golden/manifest.json` — declarative cases with per-case `tolerance` (`max_channel_delta`, `max_pixels_over_tolerance`).
- `scripts/generate_fixture_images.py` — deterministic PNG inputs into `tests/fixtures/inputs/generated/`.
- `scripts/run_core_cases.py` — drives either CLI through the manifest. Defaults to `build/laigter-core-cli`; pass `--cli cli/normalizer.js` to point at the JS CLI.
- `scripts/generate_goldens.py` — invokes an upstream Laigter binary.
- `scripts/diff_pngs.py` — stdlib-only pixel diff using `scripts/golden_png.py` (no Pillow).
- Per `NORMALIZER_FEATURES.md` §2, the harness will be repurposed to pin our own output (self-regression) once upstream parity is no longer the gate.

### Web server (`web/server.js`)

- Serves `web/` statically; also serves `laigter/` and `shared/` from repo root (used by the browser to load upstream sample images and shared modules).
- The AI pipeline runs DeepBump via `web/deepbump.worker.js` in a Web Worker — no server endpoint is involved. The worker loads `onnxruntime-web` from a CDN, fetches and caches `deepbump256.onnx`, and runs tiled inference. See `web/README.md` for the controls and local-model fallback.

## Conventions

- **License**: every file derived from Laigter must carry the GPL-3.0 derivation header (see top of `cli/normalizer.js`, `shared/normal.js`, `core/src/laigter_core.cpp`).
- **Pure functions over typed arrays** in `shared/` — input params in, new buffer out. No mutation of caller data.
- **No `ImageData` in `shared/`** — keeps it Node-loadable. Browser converts at the boundary.
- **No bundler**: `shared/` is consumed by `<script type="module">` in `web/index.html` and by Node directly.
- **Parameter names** come from the JS module (`DEFAULT_NORMAL_PARAMS`); CLI flag names match. C++ names differ (`normal_depth` vs `normalDepth`) — `scripts/run_core_cases.py` bridges the two.
- **Tolerance defaults**: ±2 LSB max channel delta, 0 pixels over tolerance. Browser and CLI can differ by ±1 LSB on semi-transparent edges due to canvas premultiplication round-trips — adjust per-case tolerance if needed.

## Key references

- `NORMALIZER_FEATURES.md` — implement/defer/drop decisions; the active roadmap.
- `JS_CORE_MIGRATION.md` — engineering detail for retiring the C++ core; pain points (blur divergence, straight vs premultiplied alpha, erode/dilate, EDT caching).
- `REWRITE_PLAN.md` — original Qt→modern rewrite plan; largely superseded for WASM/Tauri/React paths, still authoritative for parameter ranges/defaults.
- `tests/golden/README.md` — golden harness usage.

## Things to know before editing

- The browser and CLI both load `shared/` modules directly. Editing `shared/normal.js` affects both; verify with `make js-smoke` after non-trivial changes.
- `alphaDistance` is the most expensive primitive and is currently recomputed on every slider tick in `web/app.js`. Cache hooks are planned in `JS_CORE_MIGRATION.md` §5.8 but not yet wired.
- `gaussianBlur` diverges from CImg by a few LSB at borders / large sigma; this is accepted under "free to diverge" but documented in the function header.
- The web server is static-only — no server-side dependency is required for the AI pipeline. To run offline, drop `deepbump256.onnx` next to `web/deepbump.worker.js` and point `DEFAULT_MODEL_URL` at it.