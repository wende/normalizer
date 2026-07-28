# Laigter UI Rewrite Plan

Goal: keep laigter's map-generation algorithms bit-for-bit (or near), replace the Qt Widgets UI with a modern stack.

**License note:** laigter is GPL-3.0. Any project that links or embeds its algorithm code must be GPL-compatible.

---

## 1. Where the algorithms live (extraction targets)

All generation math is concentrated in **`laigter/src/image_processor.cpp`** (~1900 lines). It is built on:

| Dependency | Role | Portability |
|---|---|---|
| `thirdparty/CImg.h` | All heavy math (blur, threshold, distance transform, erode/dilate, normalize) | Header-only, zero deps — trivially portable, compiles to WASM |
| `QImage` / `QPainter` | Image I/O, format conversion, overlay compositing, neighbour mosaics | Must be replaced (stb_image or raw RGBA buffers) |
| `QObject`/`QTimer`/`QMutex`/`QtConcurrent` | Debounced recalculation, thread safety, signals | UI-orchestration concern — does **not** belong in the extracted core |
| OpenMP | Parallel pixel loops | Optional; keep behind a flag |

The good news: **the core is already UI-independent in practice** — `main.cpp` contains a headless CLI (`-g -d input.png -n -p -c -o`) that runs the full pipeline without any window. This is the proof the algorithms can be extracted and the harness for golden-output testing.

Files that are *not* algorithms (do not extract):
- `src/open_gl_widget.cpp` (1700 lines) — the live lighting **preview renderer**. The actual look lives in `shaders/fshader.glsl` (GLSL 1.10, ~260 lines), which ports almost directly to WebGL2/GLES.
- `main_window.cpp`, `gui/**` — Qt Widgets chrome, sliders, docks. Discard.
- `src/project.cpp` + `thirdparty/zip.c` — `.laigter` project save/load (zip container). Reimplement or keep for import.
- `gui/presets_manager.cpp` — presets are a plain-text `[Laigter Preset]` + `Key\tValue` format with 34 codes. Keep a parser for backward compatibility.
- `src/brush_interface.h` + plugin loading — Qt-plugin-based paint brushes for overlays. Defer (see §5 feature triage).

### The five algorithm entry points

```
calculate()                         // orchestrator, in dependency order:
├── calculate_distance()            // alpha-channel distance transform (CImg .distance(0))
├── generate_normal_map()           // = weighted blend of 3 normal fields:
│     ├── calculate_normal(gray*10, normal_depth, normal_blur_radius)         // "enhance" (texture emboss)
│     ├── modify_distance() → calculate_normal(dist, bisel_depth*bisel_dist,  // "bump"/bevel from silhouette
│     │                                        bisel_blur_radius)
│     └── calculate_normal(heightOverlay, 5000, 0)                            // painted height overlay
│     → per-pixel: n = enhance*1.5 + bevel*1.5 + overlay; blend normal-overlay by alpha; normalize; map to RGB
├── modify_parallax()  → calculate_parallax()   // Binary | HeightMap types (Quantization/Intervals are TODO stubs upstream)
├── modify_specular()  → calculate_specular()   // contrast-around-threshold, brightness, blur, invert
└── modify_occlusion() → calculate_occlusion()  // optional distance-mode + contrast/bright/blur
```

Cross-cutting mechanics that must survive extraction:
- **`calculate_normal()`**: gradients via central differences (2nd-order one-sided at borders), scaled by `depth/100`, per-axis invert (±1), z=1, transparent pixels forced to (0,0,1).
- **Tileability**: implemented by building a 3×3 neighbour mosaic of the image, running the algorithm on the mosaic, and cropping the center. Also supports sprite-sheets (`h_frames × v_frames`) with per-frame mosaics.
- **Overlays**: each map has a paintable RGBA overlay composited as `result = map*(1-α) + overlay*α` at the end of each `calculate_*`.
- **Custom input maps**: user may supply an external heightmap and/or specular base instead of deriving from the diffuse.
- **Dirty-flag system**: setters mark `enhance_requested` / `bump_requested` / `distance_requested` + per-map counters; a 40 ms timer batches recomputation. This is the recompute dependency graph to replicate in the new UI (in a worker, not in the core).

---

## 2. Complete parameter inventory

Defaults below are the constructor defaults (`image_processor.cpp:40-78`); UI range is from `main_window.ui`. Where the UI widget default differs from the constructor, both are listed.

### Inputs (per texture/sprite)
| Input | Notes |
|---|---|
| Diffuse image (RGBA) | required; alpha drives the bevel distance-field |
| Custom heightmap | optional, replaces diffuse-derived height |
| Custom specular base | optional, replaces diffuse as specular source |
| Neighbour images (3×3) | for seamless tiling against specific neighbours |
| `h_frames`, `v_frames` | sprite-sheet split (+ animations: named frame lists, fps) |
| `tileable`, `tileX`, `tileY` | tiling toggles |

### Normal map
| Parameter | Type | Default | UI range | Effect / recompute stage |
|---|---|---|---|---|
| `normal_depth` | int | 250 (UI 400) | 0–4000 | emboss strength (÷100 in gradient) — *enhance* |
| `normal_blur_radius` | int | 6 (UI 5) | 0–40 | pre-blur of grayscale (÷3 internally) — *enhance* |
| `normal_bisel_depth` | int | 100 (UI 400) | 0–4000 | bevel strength (multiplied by bisel_distance) — *bump* |
| `normal_bisel_distance` | int | 60 | 0–255 | bevel width; distance field scaled 255/d — *bump+distance* |
| `normal_bisel_blur_radius` | int | 10 | 0–40 | bevel smoothing — *bump* |
| `normal_bisel_soft` | bool | true | — | circular (sqrt) vs linear bevel profile — *bump+distance* |
| `normal_invert_x/y/z` | bool→±1 | off | — | flip channels |
| `use_normal_alpha` | bool | false | — | copy diffuse alpha into output |

### Parallax map
| Parameter | Type | Default | UI range | Notes |
|---|---|---|---|---|
| `parallax_type` | enum | Binary | Binary / HeightMap / Quantization / Intervals | last two are **unimplemented stubs upstream** |
| `parallax_max` (a.k.a. thresh) | int | 140 | 0–255 | binary threshold (`set_parallax_thresh` writes this) |
| `parallax_min` | int | 0 | 0–255 | subtracted floor |
| `parallax_focus` | int | 2 (UI 3) | 0–50 | pre-threshold blur (Binary) |
| `parallax_soft` | int | 3 (UI 10) | 0–50 | post blur |
| `parallax_erode_dilate` | int | 1 (UI 0) | −99–99 | >0 dilate, <0 erode (Binary) |
| `parallax_brightness` | int | 0 | −255–255 | HeightMap type |
| `parallax_contrast` | double | 1.0 | UI 1–4000, **÷1000** | HeightMap type |
| `parallax_quantization` | int | 1 | 1–255 | unused (stub) |
| `parallax_invert` | bool | false | — | |
| `use_parallax_alpha` | bool | false | — | |

### Specular map
| Parameter | Type | Default | UI range | Notes |
|---|---|---|---|---|
| `specular_thresh` | int | 127 | 0–255 | contrast pivot |
| `specular_contrast` | double | 1.0 | UI 1–4000, **÷1000** | `out = c*px + thresh*(1−c)` |
| `specular_bright` | int | 0 | −255–255 | |
| `specular_blur` | int | 3 (UI 10) | 0–50 | |
| `specular_invert` | bool | false | — | |
| `use_specular_alpha` | bool | false | — | |

### Occlusion map
| Parameter | Type | Default | UI range | Notes |
|---|---|---|---|---|
| `occlusion_thresh` | int | 1 | 0–255 | threshold / contrast pivot |
| `occlusion_contrast` | double | 1.0 | UI 1–4000, **÷1000** | |
| `occlusion_bright` | int | 16 (UI 10) | −255–255 | |
| `occlusion_blur` | int | 3 (UI 10) | 0–50 | |
| `occlusion_distance_mode` | bool | true | — | distance-transform-based AO |
| `occlusion_distance` | int | 10 | 0–1024 | distance falloff scale |
| `occlusion_invert` | bool | false | — | |
| `use_occlusion_alpha` | bool | false | — | |

### Preview-only (OpenGL widget — needed for UI parity, not for generation)
Lights (up to 32): position, diffuse color + intensity (0–4.0), specular color + intensity + scatter (1–255); ambient color + intensity (0–1); height blend (`horizontalSliderDiffHeight` −100–100); parallax-view toggle + `parallax_height` (`sliderParallax` 0–300); pixelated; toon; per-texture-lights toggle; blend slider (0–100, diffuse↔normal view); zoom/pan/rotation; background color. These map 1:1 onto uniforms in `shaders/fshader.glsl`.

### Export / batch (CLI parity)
Output map selection (n/p/c/o), per-map filename suffixes (`_n`, `_p`, `_s`, `_o`), output dir, flatten, recursive scan, `--check-changes`, preset file to apply.

---

## 3. Architecture of the rewrite

### Recommended stack

**C++ core → WASM module; UI in TypeScript + React; live preview in WebGL2; shipped as a web app and/or Tauri desktop app.**

Why this over alternatives:
- *Port to Rust/TS*: rewriting ~2k lines of subtle CImg math guarantees behavioral drift; the algorithms are the one thing that works. Don't rewrite them.
- *Electron + N-API native addon*: works, but you inherit per-platform native builds; WASM gives one artifact that runs in browser and desktop shells alike.
- *Keep Qt, use QML*: better than Widgets but doesn't meet "newer technology" and keeps the toolchain.
- The preview shader is GLSL 1.10 and translates nearly line-for-line to WebGL2 GLSL ES 3.00.

```
┌────────────────────────────────────────────────────────┐
│ UI (React + TS)                                        │
│  param panels · preset manager · sprite/animation ·    │
│  export dialog                                         │
│        │ params (JSON)            ▲ RGBA buffers       │
│        ▼                          │                    │
│ Worker pool (Web Workers)                              │
│  debounce (~40ms) · dirty-graph scheduler              │
│        │                                               │
│        ▼                                               │
│ laigter-core.wasm  (C++ + CImg, no Qt)                 │
│  normal / parallax / specular / occlusion / distance   │
└────────────┬───────────────────────────────────────────┘
             ▼
 WebGL2 preview (port of fshader.glsl: lights, parallax,
 toon, pixelated) — textures updated from worker output
```

### Phase 0 — Golden-output safety net (do this first)
1. Build upstream laigter (`qmake && make`, Qt 6).
2. Assemble a corpus: ~15 representative sprites (opaque, alpha-heavy, pixel-art, photo texture, sprite-sheet, tileable).
3. Script the existing CLI over a parameter sweep (defaults + each param at min/mid/max, each parallax type, tileable on/off) and store all outputs as golden PNGs.
4. Every later step is validated by pixel-diff against these (tolerance: exact for threshold ops; ±1–2 LSB for blur/float paths, document any deviation).

### Phase 1 — Extract `laigter-core` (C++, no Qt)
1. New directory `core/` with CImg vendored. Target: pure functions over raw buffers.
2. Define the API around a plain settings struct mirroring §2 (one source of truth — a JSON/YAML param registry from which both the C header and the TS types/UI metadata are generated: name, type, range, default, map, dirty-stage).
   ```c
   laigter_ctx*  laigter_create(const uint8_t* rgba, int w, int h, const laigter_frames* frames);
   void          laigter_set_heightmap(laigter_ctx*, const uint8_t* rgba);   // optional
   void          laigter_set_specular_base(laigter_ctx*, const uint8_t* rgba);
   void          laigter_set_neighbour(laigter_ctx*, int dx, int dy, const uint8_t* rgba);
   void          laigter_generate_normal   (laigter_ctx*, const laigter_normal_params*,    uint8_t* out);
   void          laigter_generate_parallax (laigter_ctx*, const laigter_parallax_params*,  uint8_t* out);
   void          laigter_generate_specular (laigter_ctx*, const laigter_specular_params*,  uint8_t* out);
   void          laigter_generate_occlusion(laigter_ctx*, const laigter_occlusion_params*, uint8_t* out);
   ```
   `ctx` caches the expensive intermediates exactly as the original does (`m_distance`, `m_gray`, `m_emboss_normal`, `m_distance_normal`, neighbour mosaic) and invalidates them per the dirty-stage table.
3. Mechanical port of `image_processor.cpp`:
   - Keep every CImg call untouched.
   - Replace `QImage2CImg`/`CImg2QImage` with buffer packing; replace `QPainter` mosaic/compositing with CImg `draw_image`.
   - Delete QObject/QTimer/QMutex/signals — concurrency moves to the caller.
   - Overlays become optional RGBA inputs to each generate call (compositing stays in core so goldens match).
4. Rebuild the original CLI on top of `laigter-core` (native binary, stb_image for I/O) → run golden suite → fix until green. **This gate ends the phase.**

### Phase 2 — WASM binding
1. Emscripten build (`-O3`, single-threaded first; `-pthread` + OpenMP later only if profiling demands it — SharedArrayBuffer requires COOP/COEP headers).
2. Thin TS wrapper: typed params (generated from the registry), zero-copy views into WASM heap, transferable output buffers.
3. Node smoke test: run the golden suite through WASM, diff against Phase-1 native output.

### Phase 3 — New UI
1. **Shell**: React + TypeScript + Vite. Desktop packaging via Tauri 2 (needed for folder-watch batch export and native file dialogs; the same code runs as a plain web app for single files).
2. **Preview**: WebGL2 canvas; port `fshader.glsl` + `vshader.glsl` (uniform-for-uniform: 32 lights, ambient, parallax occlusion-mapping toggle, toon, pixelated, texture blend). Drag-to-move lights on canvas, like the original.
3. **Recompute pipeline** (replicates the original's responsiveness model):
   - Slider change → mark dirty stage (distance/enhance/bump/per-map) → debounce 40 ms → post params to worker → worker calls only the needed `laigter_generate_*` → texture upload.
   - One worker per map type so a slow normal recompute never blocks specular preview.
4. **Panels** (mirror §2 tables; ranges/defaults come from the generated registry): Normal, Parallax, Specular, Occlusion, Tiling/Sprite-sheet, Lights/Preview, Export.
5. **Presets**: parse the legacy `[Laigter Preset]` tab-separated format for import; store new presets as JSON.
6. **Projects**: import `.laigter` zip (images + settings) for migration; new format = zip of PNGs + `project.json`.
7. **Sprite sheets & animation**: frame splitter (h/v counts), animation named frame lists, fps playback — all already modeled in core inputs.
8. **Export**: per-map suffix convention (`_n/_p/_s/_o`), batch a folder (Tauri), `--check-changes`-style mtime skip.

### Phase 4 — Parity validation & release
1. Golden suite runs in CI against the WASM core on every commit.
2. Side-by-side manual QA: old vs new app on the corpus, all sliders.
3. Perf budget: ≤100 ms recompute for a 512² sprite at defaults (original achieves this with OpenMP; profile before adding WASM threads).

### Deliberately deferred (decide later, don't block the rewrite)
- **Overlay painting / brush plugins** (Qt plugin system, `brush_interface.h`): core keeps accepting overlay buffers from day one, so painting can be added later as an in-UI canvas tool — no plugin system needed.
- **Quantization / Intervals parallax types**: unimplemented stubs upstream; omit from the new UI.
- Translations (the old app ships 12 locales) — use i18n framework from the start, port strings later.

### Risk register
| Risk | Mitigation |
|---|---|
| Hidden Qt behavior in conversions (premultiplied alpha, grayscale weighting in `convertToFormat`) | Golden tests catch it; replicate Qt's RGB→gray coefficients exactly (Qt uses 0.299/0.587/0.114 int approximation) |
| CImg `blur()` float drift across compilers/WASM | Tolerance-based diffing; pin Emscripten version |
| OpenMP loops silently serialize in WASM | Acceptable initially; measure, then enable pthreads if needed |
| GPL-3 obligations | Keep the whole app GPL-3; no proprietary distribution |

### Current completion status (2026-07-06)
The MVP vertical slice is partially complete: `core/` now has a Qt-free normal-map generation API and native CLI, and `web/` has a dependency-free browser UI that loads the bundled sample or uploaded images, exposes the normal-map controls, exports a normal PNG, previews split/lit/normal/diffuse modes, includes pixelated and toon generation toggles, controls light height, and supports one draggable Laigter-textured light source. Still not implemented: golden-output corpus and pixel-diff validation, the full cached core context and dirty-stage graph, parallax/specular/occlusion generation, tileable neighbour mosaics, sprite sheets and animation, custom heightmap/specular inputs in the UI, WASM bindings, TypeScript wrapper, Web Workers, React/Vite/Tauri shell, WebGL2 shader preview, complete multi-light/ambient/specular/parallax preview controls, full parameter panels, presets, project import/export, batch export, CI parity validation, and performance-budget validation.

### Current completion status update (2026-07-06)
Golden-output validation is now implemented for the current normal-map MVP: the repo has a deterministic manifest, generated fixture corpus, upstream golden PNGs, current-output runner, stdlib PNG pixel-diff tool, and Make targets for `fixtures`, `current-goldens`, `regenerate-goldens`, `regenerate-goldens-local`, and `golden`. `make golden` currently passes against upstream Laigter for seven default normal-map cases with a maximum tolerated per-channel delta of 2. During this work the core and browser grayscale conversion were adjusted to match upstream's Qt-compatible behavior, including zeroing fully transparent RGB before grayscale conversion.
