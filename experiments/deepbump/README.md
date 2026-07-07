# DeepBump CLI (experiment)

Standalone test tool: color image → tangent-space normal map, using
[DeepBump](https://github.com/HugoTini/DeepBump)'s pretrained model. This is a
scratch experiment to evaluate ML-inferred normals — **not** wired into the
normalizer pipeline.

Unlike a text-to-image model, DeepBump is *conditioned on your image*: it
regresses per-pixel surface orientation aligned to the input texture, so the
output geometry actually matches the source instead of hallucinating a new one.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# one-time: download the model (~27MB, not committed)
curl -L -o deepbump256.onnx \
  https://github.com/HugoTini/DeepBump/raw/master/deepbump256.onnx
```

## Usage

```bash
python deepbump.py INPUT.png OUTPUT_normal.png [--overlap SMALL|MEDIUM|LARGE] [-v]
```

- `--overlap` controls tile blending: `LARGE` (default) = best quality / slowest,
  `SMALL` = fastest. The image is processed in 256×256 tiles with wrap padding
  and a pyramidal blend mask, so any input size and tileable textures work.
- Output is OpenGL-convention normals (Y up). Flip the green channel if you need
  DirectX.

## Example

```bash
python deepbump.py sample_input.png sample_normal.png -v
```

`sample_input.png` (a synthetic brick texture) and `sample_normal.png` are
included as a quick sanity check.

## Notes

- Model is CPU inference via `onnxruntime`; runs fine without a GPU.
- The tiling/merge/normalize helpers in `deepbump.py` are lifted verbatim from
  DeepBump (GPL-3.0) to match the original output exactly.
- License: DeepBump is GPL-3.0, same as this repo.

---

## Browser integration (Web Worker) — wired into the app

The same algorithm now runs client-side, off the main thread, behind the
**"AI Normal"** button in the toolbar (previously the unstyled/hidden
`#aiGenerateButton`). Clicking it generates a DeepBump normal map from the
current source image and feeds the existing `aiOverlay` path: **AI Map** mode
shows it raw, and the base normal blends it in at 0.65.

Files:

- `web/deepbump_infer.js` — the inference core (tiling / pyramidal-blend merge /
  normalize) as pure typed-array math, no DOM and no ONNX binding. It takes a
  `runTile` callback, so the **exact same file** runs under `onnxruntime-web`
  (browser) and `onnxruntime-node` (the parity test below).
- `web/deepbump.worker.js` — a classic Web Worker. It pulls `onnxruntime-web`
  from a CDN via `importScripts`, fetches + caches the model (Cache API), and
  runs inference. Classic (not a module) worker on purpose: no bundler config,
  no new npm deps, and it works whether the app is served by Vite or by
  `web/server.js`.
- UI hooks live in `web/src/Toolbar.jsx` (the button) and `web/src/App.jsx`
  (worker lifecycle → `setAiOverlay`).

Preview modes for the AI map (segmented control, top of the preview):

- **AI Map** — the raw DeepBump normal (RGB visualization).
- **AI Lit** — the lit preview driven by the *pure* AI normal under a draggable
  light. This is the real test of the map: drag the light handle and watch the
  DeepBump geometry catch highlights. (The plain **Lit** mode uses the blended
  normal instead.) `aiLitCache` in `App.jsx` only renders while this mode is
  active, so it costs nothing in other views.

Design choices:

- **Single-threaded WASM** (`ort.env.wasm.numThreads = 1`) so it needs no
  `SharedArrayBuffer` and therefore **no COOP/COEP headers**. To go faster
  later, enable the multi-threaded build (add cross-origin isolation headers in
  `web/server.js`) or switch the execution provider to `webgpu`.
- **Model source**: defaults to the DeepBump repo's raw GitHub URL
  (CORS-open), cached after first download. To serve it locally, drop
  `deepbump256.onnx` into `web/`, set `DEFAULT_MODEL_URL = "/deepbump256.onnx"`
  in the worker, and add `.onnx -> application/octet-stream` to `server.js`.
- **Alpha handling**: DeepBump itself only reads RGB, so `colorToNormals` adds
  it back (on by default; `options.maskAlpha`). Transparent source pixels are
  written as a flat, opaque normal (128,128,255) to match the base map, and
  transparent input is flattened to the mean opaque grayscale so the model
  doesn't manufacture a rim/halo at the silhouette. `sample_alpha_*.png` show a
  transparent sprite in and out.
- **Softness**: DeepBump is a smooth CNN estimator, so its normals are inherently
  softer than the analytic emboss/bevel generator. That's expected, not a bug —
  the existing 0.65 `aiOverlay` blend is where you combine DeepBump's global
  form with the analytic map's crisp high-frequency detail; lower the blend
  toward the analytic side for a sharper result.

Parity check (proves the browser core matches upstream DeepBump):

```bash
# from a scratch dir
npm i onnxruntime-node pngjs
# run web/deepbump_infer.js through onnxruntime-node and diff vs the Python output
node verify_web_parity.mjs   # max channel delta observed: 1 LSB
```

`sample_normal_js.png` is the output of this JS core (via the shared
`deepbump_infer.js`) — visually identical to the Python `sample_normal.png`.

Prod-build caveat: under `make web` (server.js) or `vite` dev, files in `web/`
are served at `/`, so `/deepbump.worker.js` and `/deepbump_infer.js` resolve.
For a `vite build`, move those two files into `web/public/` (Vite only copies
`publicDir` + imported assets to `dist/`).
