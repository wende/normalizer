# Normalizer Feature Plan

Prioritized implement/defer/drop split of the remaining work from
[REWRITE_PLAN.md](REWRITE_PLAN.md), decided 2026-07-06.
Status re-verified 2026-07-29 after merging the occlusion and web-worker
branches; lit-preview alpha shadow was later dropped (see §4).

## Decisions this plan is based on

- **Goal**: personal tool first, maybe public later — keep doors open cheaply.
- **Fidelity**: free to diverge from upstream Laigter. Output is judged on its
  own merits, not pixel-diffed against upstream. This invalidates the
  bit-exactness premise of REWRITE_PLAN.md (Phase 0 and the §3 "don't rewrite
  the math" argument).
- **Workflows that matter**: sprite sheets/animation, tileable textures,
  batch export. Not: custom heightmaps, painted overlays.

## Structural decision: JS/TS is the single source of truth

The repo currently has two implementations of the normal-map math:
`web/app.js` (browser) and `core/src/laigter_core.cpp` (native CLI). Every
new map type would double that work. Since upstream parity is no longer a
goal, the C++/CImg core loses its reason to exist.

**Decision**: extract the algorithms from `web/app.js` into a shared JS
module that runs in both the browser and a Node CLI. The C++ core
(`core/`) and the WASM plan (REWRITE_PLAN.md §3 Phase 1–2) are retired.
Consequences:

- Batch export ships as a Node CLI — no Tauri, no File System Access API.
- WASM build, Emscripten, TS wrapper, and WASM/core CI parity drop off the
  list entirely (not deferred — removed).
- The remaining map types (parallax/specular/occlusion) are
  threshold/contrast/blur/distance ops, simpler than the normal path already
  ported. Typed-array JS is fast enough at sprite scale; revisit WASM only
  if profiling demands it.

---

## 1. Implement now

Ordered. Parameter names, ranges, and defaults for each map come from the
inventory in REWRITE_PLAN.md §2.

**All four maps are now shipped.** The remaining work is workflow features
(5–8), not generators.

1. ✅ ~~**Shared algorithm module + Node CLI skeleton**~~ — DONE
   (`6e2414a`, `b5b9dee`). `shared/` holds `image.js`, `normal.js`,
   `primitives.js`, `preview.js`; `cli/normalizer.js` is the Node CLI.
2. ✅ ~~**Parallax map generation + panel**~~ — DONE (`ef44eaf`).
   `shared/parallax.js` (Binary + HeightMap), `cli/normalizer.js parallax`
   subcommand, web Parallax panel + preview tab, `tests/parallax.test.js`.
3. ✅ ~~**Specular map generation + panel**~~ — DONE (`8bcd80f`, `23fc05a`).
   `shared/specular.js`, `cli/normalizer.js specular` subcommand, web
   Specular panel + preview tab, `tests/specular.test.js`.
4. ✅ ~~**Occlusion map generation + panel**~~ — DONE (merged
   `add-occlusion-map`). `shared/occlusion.js` (flat + distance-transform
   AO), `cli/normalizer.js occlusion` subcommand, web Occlusion panel +
   preview tab, `tests/occlusion.test.js`. `shared/primitives.js` gained
   `distanceTransform` (extracted from `alphaDistance`).
5. ❌ **Export with suffix convention** — NOT STARTED. CLI takes a single
   explicit output path; no `_n/_p/_s/_o` logic anywhere. Web export uses
   `normalizer-<map>.png` filenames instead (`App.jsx`).
6. ❌ **Tileable 3×3 neighbour mosaics** — NOT STARTED. No tileX/tileY,
   mosaic, or center-crop code. (Original intent: compute on mosaic, crop
   center, per REWRITE_PLAN.md §1 "Tileability"; plain self-tiling first,
   neighbour-image inputs can wait.)
7. ❌ **Sprite-sheet splitting + animation playback** — NOT STARTED. No
   `h_frames`/`v_frames`/frame-list/fps code (the only "sprite"/"frame" hits
   in `web/` are the preview light sprite and a code comment).
8. ❌ **Node CLI batch export** — NOT STARTED. `cli/normalizer.js` is
   single-input/single-output, `normal`/`specular`/`parallax`/`occlusion`
   subcommands only; no folder scan, suffixes, recursion, or `--check-changes`.

## 2. Implement cheaply alongside (hygiene, not features)

- ✅ ~~**Single Web Worker recompute**~~ — DONE (merged
  `feat/web-worker-recompute`). The procedural normal recompute (EDT +
  blurs, the expensive path) runs in `web/src/normal.worker.js` via
  `useNormalWorker.js`; specular/parallax/occlusion stay on the main thread
  (cheap). Add a per-map pool only if profiling shows it hurts.
- 🟡 **Self-regression goldens** — PARTIAL. `make js-smoke` and
  `make preview-self-check` run the JS CLI and compare Node output against
  itself, but `tests/golden/manifest.json` still describes itself as
  "validating the Laigter rewrite against upstream Laigter" and the upstream
  PNGs are still checked in as the primary target for `make golden`. The
  full conversion (drop upstream comparison, keep only self-regression) is
  not done. See `PREVIEW_GOLDEN_STRATEGY.md`.
- ✅ ~~**Unit tests wired into npm**~~ — DONE. `npm test` runs
  `tests/specular.test.js`, `tests/parallax.test.js`, and
  `tests/occlusion.test.js`.

## 3. Defer (real value, wrong time — with re-entry triggers)

| Item | Plan ref | Trigger to revisit | Status (2026-07-07) |
|---|---|---|---|
| React + TS + Vite shell | §3 Phase 3.1 | Vanilla UI state handling starts fighting us (~4 more panels will roughly triple `app.js`). Cheap middle step available now: convert the shared module to TypeScript. | 🟡 Partial — Preact + Vite + JSX shell landed (`cd8084d` "Rewrite web UI in Preact"; `web/src/*.jsx`). Not React, not TS. |
| WebGL2 port of `fshader.glsl` + full lights/ambient/specular/parallax preview | §3 Phase 3.2, §2 "Preview-only" | When parallax generation lands — a parallax map you can't preview is hard to tune. | 🟡 Partial — Canvas2D lit preview with specular/scatter light controls shipped (`b5b9dee`, `0a94e62`, `d4e9030`; `shared/preview.js`, `web/src/previewRender.js`). `web/src/litGL.js` is a WebGL2 lit preview that uses the specular map; parallax preview is a raw-map tab, not displacement-mapped lighting. |
| Custom heightmap / specular base inputs (UI) | §2 "Inputs" | User demand. Generation code keeps accepting an optional height/specular source so only UI is missing. | 🟡 Partial — `generateSpecularMap(source, p, specularBase = source)` and `generateParallaxMap(source, p, height = source, bevelDistance = null)` accept optional sources; no UI loaders exist. `generateNormalMap` still takes no height/spec source. |
| Tauri desktop packaging | §3 Phase 3.1 | Only if folder-watch or distribution to non-terminal users becomes a goal; Node CLI covers batch until then. | ❌ Still deferred. |
| Performance budget validation | §3 Phase 4.3 | Don't formalize; log recompute time in dev, look at it as each map lands. | ❌ Still deferred (no recompute-time logging in `web/`). |
| New project zip format | §3 Phase 3.6 | Project firms up into a product. Until then: JSON settings export alongside PNGs. | ❌ Still deferred. |

## 4. Drop (invalidated by the decisions above)

- 🟡 **Upstream golden corpus / pixel-diff parity** — DECLARED but only
  PARTIALLY EXECUTED. `tests/golden/upstream/` is still checked in and
  `make golden` still compares C++ output against it, but the JS CLI is
  already validated only against itself (`make js-smoke`,
  `make preview-self-check`). The harness is meant to survive only in its
  self-regression role (§2 above); the full switch is unstarted.
- ✅ ~~**WASM build, TS wrapper, Node WASM smoke test, WASM/core CI parity**~~
  — DROPPED. No Emscripten/WASM/`.ts` anywhere in the tree; decision held.
- ✅ ~~**Legacy preset import** and **`.laigter` project import**~~ — DROPPED.
  Neither present. (Revisit only if this becomes a public successor.)
- ✅ ~~**Paint overlays in UI**~~ — DROPPED (2026-07-28). Hand-painted
  height/normal overlays are out of scope for a personal tool; slider-driven
  generation + AI normal blend cover the workflows that matter. No brush
  canvas will be added. (`blendNormalOverlay` stays for the AI pipeline only.)
- ✅ ~~**Lit-preview alpha / drop shadow**~~ — DROPPED for now. Shipped via
  `codex/park-alpha-shadow` (`762bc15`, merged `400cf3a`) as a preview-only
  contact shadow (band-projected silhouette + softness taps in
  `web/src/shadow.js`, Shadow card in the Light tab, draggable contact
  handle, `litGL` mode-2 pass). It did not behave as intended in practice,
  so the UI, math module, shader pass, unit tests, and e2e coverage were
  removed. Revisit only with a clearer silhouette / ground-plane model.

## Known loss / escape hatch

Dropping upstream parity strands the C++ core and the golden-vs-upstream
tooling as sunk cost. Accepted. **Before deleting `core/` or
`tests/golden/upstream/`**: confirm `make regenerate-goldens` against an
upstream build still works, or keep the upstream PNGs checked in — rebuilding
upstream Laigter with Qt later is the expensive part if bit-exactness is
ever wanted again (REWRITE_PLAN.md Phase 0).

Status (2026-07-07): neither deletion has happened — `core/` (with
`include/`, `src/`, `tools/`) and `tests/golden/upstream/` are both still
present. Consistent with the escape hatch: still reclaimable.

## Not in this plan, but shipped

- **AI normal map generator (DeepBump in the browser)** — `web/src/App.jsx`
  spawns `web/deepbump.worker.js` as a Web Worker that runs DeepBump
  inference via `onnxruntime-web` (loaded from CDN, single-threaded WASM,
  no COOP/COEP). AI tab in `web/src/ControlsPanel.jsx` exposes Strength /
  Smooth / Steps (live) and Denoise / Overlap (regenerate). The model can be
  self-hosted by dropping `deepbump256.onnx` next to the worker and editing
  `DEFAULT_MODEL_URL`. Scope is normal maps only — no specular/roughness/AO.
- **Invert X/Y/Z is CLI-only by design** — the shared normal generator and
  the CLI support channel inversion, but the web UI deliberately does not
  expose it. These are pipeline-correction flags for CLI/batch use; in the
  browser the user can flip the source image instead. Documented here so it
  is not mistaken for an unfinished feature.
