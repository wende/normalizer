# Laigter Web MVP

Start the local dev server:

```sh
make web
```

Then open:

```text
http://localhost:8765/
```

`make web` runs Vite via `npx vite`, which transforms JSX on the fly — that's
the only path that can serve `web/src/*.jsx` to the browser. `web/server.js`
is a plain static file server for non-JSX assets (and the deepbump worker /
ONNX model); running it directly will not load the UI.

The browser-only path still works by opening [index.html](index.html) directly
or running `make web-static`. Both paths run the same client; the Node server
just adds static-file convenience (and a `text/javascript` content type for
`/web/…` paths).

The page loads the bundled sample image by default, accepts uploaded images,
generates a normal map in Canvas, updates on slider changes with a 40 ms
debounce, includes the upstream Pixelated/Toon render toggles, and exports the
normal map as PNG. No server-side processing is required for any of it.

## AI normal generator (DeepBump, in the browser)

The **AI** pipeline runs DeepBump ([HugoTini/DeepBump] — normal-map inference
from a single image) entirely in the browser. There is no server endpoint and
no external API call.

[web/src/App.jsx](src/App.jsx) spawns [deepbump.worker.js](deepbump.worker.js) as
a classic Web Worker so ONNX inference never blocks the UI thread. The worker:

- Loads `onnxruntime-web` from a CDN via `importScripts` (no bundler, no
  COOP/COEP headers — single-threaded WASM).
- Fetches the DeepBump 256×256 ONNX model from a CDN and caches it in the
  browser's Cache API (~27 MB; downloaded once across sessions).
- Slices the source image into 256×256 tiles with configurable overlap
  (Small / Medium / Large), runs inference per tile, and stitches the result
  back together via [deepbump_infer.js](deepbump_infer.js).
- Streams `progress` and `result` messages back to the main thread.

### Local model fallback

By default the worker downloads `deepbump256.onnx` from
`https://raw.githubusercontent.com/HugoTini/DeepBump/master/deepbump256.onnx`.
To host the model locally instead:

1. Download `deepbump256.onnx` and drop it next to `deepbump.worker.js`
   (in `web/`).
2. In [deepbump.worker.js](deepbump.worker.js), change
   `DEFAULT_MODEL_URL` to `"/deepbump256.onnx"`.
3. `web/server.js` already serves `.onnx` as `application/octet-stream`, so no
   MIME tweak is needed.

### AI controls

The **AI** tab in the side panel exposes the live **Adjust** group (applied
instantly to the generated map) and the **Generation** group (requires a
regenerate to take effect):

| Control | Group | Effect |
|---|---|---|
| Strength | Adjust | %; 100 = as generated, 0 = flat, higher = deeper relief |
| Smooth | Adjust | post-blur radius in px; 0 = off |
| Steps | Adjust | normal-direction quantization for pixel-art facets; 0 = off |
| Invert X / Y / Z | (Normal tab) | channel inversion, applied to both pipelines |
| Denoise | Generation | edge-preserving pre-filter radius (px); 0 = off |
| Overlap | Generation | tile overlap: Small / Medium / Large (larger = smoother seams, slower) |

A **Generate AI Normal** / **Regenerate AI Normal** button (visible in both
the Light and AI tabs while the AI pipeline is selected) kicks off a fresh
inference pass.

### Scope

DeepBump produces **normal maps only**. It does not generate specular,
roughness, metallic, AO, or full PBR material maps. If you need those, the
Procedural pipeline (the Laigter-derived normal generator) is unaffected.
