# CLAUDE.md

This file provides guidance to coding agents working in this repository. `AGENTS.md` is a symlink to it, so both names resolve to this one file — edit here, never fork the content.

## Project

`normalizer` is a Laigter-derived normal/texture-map generator (GPL-3.0). Two implementations share one source of truth:

- Browser UI (`web/`) — a Preact app in `web/src/` (JSX), served/built by Vite (`vite.config.js`; `make web`). It imports the `shared/` algorithms directly.
- Node CLI (`cli/normalizer.js`) — uses `pngjs` for PNG I/O, ES modules.

Both import pure-function algorithms from `shared/`. The C++ rewrite (`core/`) was retired 2026-08-17 per `docs/JS_CORE_MIGRATION.md` §7 — `shared/` + the JS CLI are the only implementation. Upstream Laigter is **not vendored** — no submodule, no upstream assets; read it on GitHub ([azagaya/laigter](https://github.com/azagaya/laigter)) when you need the porting reference.

## Upstream Laigter is a reference, not a source

Nothing from upstream [azagaya/laigter](https://github.com/azagaya/laigter) (Qt/C++) may land in this repo — not as a submodule, not as sample art, icons, screenshots, or fixtures. The repo was de-vendored 2026-08-17; only the GPL-3.0 derivation headers remain (text attribution, legally required).

- **No shipped code imports it.** `shared/`, `cli/`, and `web/src/` must never depend on it at runtime. Where our code is *derived* from it — e.g. `web/src/litGL.js` from upstream's `shaders/fshader.glsl` — that's a header comment crediting the port, not a dependency.
- **Never take assets from upstream.** Use ours (below).
- Read upstream on GitHub to answer "what does upstream do here?" when porting a parameter or chasing an algorithm question.

### Our own sample and fixture assets

When you need an input image — a demo, a doc screenshot, a manual e2e, an engine-integration check — use ours:

| Asset | What it is |
|---|---|
| `web/demo.png` | The sample the web UI loads (`SAMPLE_SRC` in `web/src/App.jsx`); base name `demo`, which is what an Export Pack is named. The default choice for anything demo- or integration-shaped. |
| `web/demo_ai_normal.png` | Precomputed AI normal for the same sample, used by the DeepBump path. |
| `tests/fixtures/inputs/generated/*.png` | Synthetic tolerance probes from `scripts/generate_fixture_images.py` (`hard_edges`, `alpha_badge`, `soft_gradient_alpha`, …). Made for the golden harness — right for parity/tolerance work, wrong for anything visual. |

## Commands

All commands are run from the repo root.

| Task | Command |
|---|---|
| Install JS deps | `make install` (or `npm install`) |
| Run web server (dev) | `make web` (Vite, port 8765) or `WEB_PORT=9000 make web` |
| Run smoke (JS CLI) | `make smoke` |
| Generate fixtures | `make fixtures` |
| Run golden suite against current impl | `make current-goldens` |
| Run Node CLI smoke against goldens | `make js-smoke` (requires `make install` first) |
| Preview self-regression check | `make preview-self-check` — reruns preview cases and diffs Node output against itself |
| Unit tests | `npm test` — runs the `tests/*.test.js` suite |
| Static file server (no API) | `make web-static` |
| Clean build artifacts | `make clean` |

`make web` runs the Vite dev server (JSX transform + HMR for `web/src/`), also serving `shared/` from the repo root. There is no DB, no API endpoint, and no native asset — AI generation runs entirely in the browser via `web/deepbump.worker.js`. `make web-static` (or the standalone `web/server.js`) serves the same tree without Vite for a no-build/offline check, but won't transform JSX.

## Architecture

### Single source of truth: `shared/`

Pure-function ES modules, no DOM, no Node APIs. Record shape is `{ width, height, data }`; `ImageData` satisfies it structurally.

- `shared/image.js` — RGBA helpers. `grayscaleFromRgba` uses Qt `qGray` weights `(11r+16g+5b)/32` and zeros RGB for fully transparent pixels (required for upstream parity).
- `shared/primitives.js` — `edt1d` (Felzenszwalb), `alphaDistance` (two-pass EDT), `gaussianBlur` (finite-kernel, σ=radius/3, diverges from CImg's recursive IIR — see `docs/JS_CORE_MIGRATION.md` §5.1), `smoothstep`, `erode`/`dilate` (van Herk / Gil–Werman).
- `shared/normal.js` — `generateNormalMap(source, params)` returns `{ width, height, data }`. Defaults live in `DEFAULT_NORMAL_PARAMS`. Blends three normal fields (emboss × 1.5 + bevel × 1.5 + height-overlay) into a tangent-space normal.
- `shared/specular.js` — `generateSpecularMap(source, params, specularBase = source)` — contrast/brightness/blur/invert grayscale map.
- `shared/parallax.js` — `generateParallaxMap(source, params, height = source, bevelDistance = null)` — Binary and HeightMap displacement maps.

### Consumers

- `web/src/` — Preact app (entry `main.jsx` → `App.jsx`). `previewRender.js` is the boundary that imports `shared/` and converts to/from `ImageData`. All controls live in one `ControlsPanel.jsx` — each map is a `{showX && …}` block gated by a `TABS` map (there are no per-map panel components), with matching preview `MODES` in `PreviewTabBar.jsx`. State is per-map React hooks in `App.jsx`; each map recomputes in a 40ms-debounced `useEffect` on the main thread today (single worker is a planned hygiene step in `docs/NORMALIZER_FEATURES.md` §2).
- `cli/normalizer.js` — the only CLI now that `core/` is retired. Uses `pngjs` for I/O. Subcommands: `normal`, `specular`, `parallax`, `occlusion`, `ai`.

### Golden harness

- `tests/golden/manifest.json` — declarative cases with per-case `tolerance` (`max_channel_delta`, `max_pixels_over_tolerance`).
- `scripts/generate_fixture_images.py` — deterministic PNG inputs into `tests/fixtures/inputs/generated/`.
- `scripts/run_core_cases.py` — drives the JS CLI through the manifest (defaults to `cli/normalizer.js`).
- `scripts/diff_pngs.py` — stdlib-only pixel diff using `scripts/golden_png.py` (no Pillow).
- Upstream parity is dropped (`docs/NORMALIZER_FEATURES.md` §4) and the upstream goldens are gone (laigter de-vendored 2026-08-17). The planned self-baseline repurposing (`docs/NORMALIZER_FEATURES.md` §2) is unstarted — see `PUBLISH_CHECKLIST.md` #7.

### Serving the web app

- `make web` runs Vite (`vite.config.js`): it transforms the JSX under `web/src/`, serves `web/`, and also serves `shared/` from the repo root (the app imports the shared modules directly). Vite is the normal dev path. The app's sample is `web/demo.png`.
- `web/server.js` is a dependency-free static server for the same tree (no JSX transform); `make web-static` is the equivalent via `python3 -m http.server`. Both exist for no-build/offline checks.
- The AI pipeline runs DeepBump via `web/deepbump.worker.js` in a Web Worker — no server endpoint is involved. The worker loads `onnxruntime-web` from a CDN, fetches and caches `deepbump256.onnx`, and runs tiled inference. See `web/README.md` for the controls and local-model fallback.

## Conventions

- **License**: every file derived from Laigter must carry the GPL-3.0 derivation header (see top of `cli/normalizer.js`, `shared/normal.js`).
- **Pure functions over typed arrays** in `shared/` — input params in, new buffer out. No mutation of caller data.
- **No `ImageData` in `shared/`** — keeps it Node-loadable. Browser converts at the boundary.
- **No build step for `shared/`**: it stays plain ESM — imported by the Vite-built web app (through `web/src/previewRender.js`) and by Node (the CLI) directly. Only the web UI's JSX goes through Vite; `shared/` never does.
- **Parameter names** come from the JS module (`DEFAULT_NORMAL_PARAMS`); CLI flag names match. The golden manifest uses the C++-era names (`normal_depth` vs `normalDepth`) — `scripts/run_core_cases.py` bridges the two.
- **Tolerance defaults**: ±2 LSB max channel delta, 0 pixels over tolerance. Browser and CLI can differ by ±1 LSB on semi-transparent edges due to canvas premultiplication round-trips — adjust per-case tolerance if needed.

## Key references

- `docs/NORMALIZER_FEATURES.md` — implement/defer/drop decisions; the active roadmap.
- `docs/JS_CORE_MIGRATION.md` — completed C++→JS migration; kept for the §5 pain points (blur divergence, straight vs premultiplied alpha, erode/dilate, EDT caching) cited from `shared/*.js`.
- `docs/REWRITE_PLAN.md` — original Qt→modern rewrite plan; superseded (historical), still authoritative for parameter ranges/defaults (§2).
- `tests/golden/README.md` — golden harness usage.

## Things to know before editing

- Nothing from upstream Laigter may land in this repo — no submodule, no assets. Our sample is `web/demo.png`. See "Upstream Laigter is a reference, not a source" above.
- The browser and CLI both load `shared/` modules directly. Editing `shared/normal.js` affects both; verify with `make js-smoke` after non-trivial changes.
- `alphaDistance` is the most expensive primitive and is currently recomputed on every slider tick (the debounced recompute `useEffect`s in `web/src/App.jsx`). Cache hooks are planned in `docs/JS_CORE_MIGRATION.md` §5.8 but not yet wired.
- `gaussianBlur` diverges from CImg by a few LSB at borders / large sigma; this is accepted under "free to diverge" but documented in the function header.
- The web server is static-only — no server-side dependency is required for the AI pipeline. To run offline, drop `deepbump256.onnx` next to `web/deepbump.worker.js` and point `DEFAULT_MODEL_URL` at it.