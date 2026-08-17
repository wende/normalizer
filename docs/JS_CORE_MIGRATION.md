# Removing the C++ Dependency: Full JS Core Migration

> **Status: complete (2026-08-17).** The migration below is done — `shared/`
> holds all four generators, the JS CLI covers the old C++ CLI's flags, and
> `core/`, `CMakeLists.txt`, and the C++ `Makefile` targets are deleted (§7).
> This file is kept because `shared/*.js` cite its §5 pain points (blur
> divergence, premultiplied-alpha traps, erode/dilate semantics, threshold
> edge cases) as their engineering rationale.

How to reimplement everything the C++ core (`core/`) does — and everything it
was *going* to do per [REWRITE_PLAN.md](REWRITE_PLAN.md) §1 — in JavaScript,
so the project has a single implementation with no native toolchain.

Companion to [NORMALIZER_FEATURES.md](NORMALIZER_FEATURES.md), which made the
structural decision ("JS/TS is the single source of truth"); this document is
the engineering detail: what has to be ported, what the pain points are, and
in what order to retire the C++.

## 1. Starting position

There are two implementations today:

| | C++ (`core/src/laigter_core.cpp`, 265 lines) | JS (`web/app.js`, 728 lines) |
|---|---|---|
| Normal map (emboss + bevel + overlay blend) | ✅ | ✅ (independent port) |
| Alpha distance transform | ✅ CImg `.distance(0)` | ✅ Felzenszwalb EDT (`edt1d`/`alphaDistance`) |
| Gaussian blur | CImg `.blur()` (recursive) | Finite-kernel separable Gaussian |
| Height/normal paint overlays | ✅ (API accepts buffers) | ❌ (AI overlay blend only) |
| Parallax / specular / occlusion | ❌ | ❌ |
| Tiling, sprite sheets | ❌ | ❌ |
| CLI / batch | ✅ native (`core/tools/laigter_core_cli.cpp`) | ❌ |

So "reimplement the C++ core in JS" concretely means two things:

1. **Extract** the already-working JS algorithms out of `web/app.js` into a
   shared, environment-agnostic module.
2. **Port the not-yet-implemented algorithms** directly from upstream
   `laigter/src/image_processor.cpp` into that module — skipping C++
   entirely, since the upstream functions are short and their CImg calls map
   to primitives we mostly already have.

The C++ core is *not* the porting source for new maps — upstream is. The C++
core only ever implemented the normal map, which JS already has.

## 2. Target architecture

```
shared/                     ES modules, zero DOM/Node APIs, pure functions
  image.js                  {width, height, data: Uint8ClampedArray} type + helpers
  primitives.js             blur, EDT, erode/dilate, threshold, normalize, cut
  normal.js                 extracted from web/app.js
  parallax.js  specular.js  occlusion.js       ported from upstream
  mosaic.js                 3x3 neighbour mosaic build + center crop
  frames.js                 sprite-sheet split/reassemble
web/app.js                  imports shared/*, keeps only UI/canvas/light code
cli/normalizer.js           Node CLI: PNG I/O + batch walk, imports shared/*
```

Rules that make this work everywhere:

- **No `ImageData` in `shared/`.** `ImageData` doesn't exist in Node. Use a
  plain `{width, height, data}` record; `web/` converts at the boundary
  (`ImageData` is structurally compatible, so this is nearly free).
- **ES modules only**, no bundler: browsers load them natively via
  `<script type="module">` (one-line change to `web/index.html`), Node ≥14
  runs them natively. The no-build-step property of the current app is
  preserved.
- **Pure functions over typed arrays**, params in, buffer out — the same
  shape as the planned C API in REWRITE_PLAN.md §3 Phase 1, minus the ctx
  object (see §5.8 on caching).

## 3. CImg-operation inventory

Every CImg call the four generators use, and its JS status. This is the
complete list — there is nothing else in the upstream generation paths.

| CImg op | Used by | JS status |
|---|---|---|
| `.distance(0)` (Euclidean EDT) | normal bevel, occlusion distance mode | ✅ done (`edt1d` — same Felzenszwalb algorithm CImg uses) |
| `.blur(sigma)` | all four maps | ⚠️ done but diverges — see §5.1 |
| `.threshold(t)` | distance prep, parallax Binary, occlusion | trivial (1-line map) |
| `.normalize(0, 255)` | parallax Binary | trivial, but see §5.4 edge case |
| `.cut(0, 255)` | everywhere | ✅ done (clamp) |
| `.erode(n)` / `.dilate(n)` | parallax Binary | ❌ **the only genuinely new primitive** — see §5.3 |
| `.pow(2)` / `.sqrt()` (soft bevel) | normal, occlusion | ✅ done (per-pixel math) |
| `.get_channel(n)`, `.mul()`, scalar ops | everywhere | trivial with typed arrays |
| Qt `Format_Grayscale8` conversion | parallax, specular, occlusion input | ✅ done — `(11r+16g+5b)/32`, exactly Qt's `qGray` (REWRITE_PLAN.md risk register) |

Conclusion: **the port needs one new primitive (morphological erode/dilate)
plus three short per-pixel pipelines.** Upstream `modify_parallax`,
`modify_specular`, `modify_occlusion` are ~40 lines each
(`laigter/src/image_processor.cpp:641-750`).

## 4. Per-algorithm port notes

Line references are to upstream `laigter/src/image_processor.cpp`.

### Specular (easiest — do first) — upstream :729
Grayscale source → `out = contrast*px + thresh*(1-contrast)` → `+bright` →
clamp → blur(specular_blur) → optional invert. Pure per-pixel except the
blur. Params: REWRITE_PLAN.md §2 "Specular map".

### Occlusion — upstream :641
Grayscale → optional invert → if distance mode: threshold(occlusion_thresh),
EDT, `*= 255/occlusion_distance`, clamp, circular profile
`sqrt(1-(x/255-1)²)*255` (same soft-bevel formula as the normal path) →
contrast/bright → clamp → blur. Reuses the existing EDT. Params: §2
"Occlusion map".

### Parallax — upstream :671
Two live types (Quantization/Intervals are upstream stubs — omitted, per
NORMALIZER_FEATURES.md):
- **Binary**: blur(focus) → threshold(max) → normalize(0,255) → `-min` →
  invert-by-default (`255-par` when *not* inverted — note the inverted
  polarity) → dilate/erode by `|erode_dilate|` → blur(soft).
- **HeightMap**: `(gray + bevelDistance − 1)/2 + 0.5` → contrast around
  `parallax_max` → `+brightness` → blur(soft) → optional invert.
  Depends on `modify_distance()` output, i.e. the same bevel-distance buffer
  the normal map uses — a sharing opportunity (§5.8).

### Normal (extract, don't rewrite)
`web/app.js:366-454` already implements the full three-field blend. Two
things change during extraction: accept optional height/normal overlay
buffers (the C++ core's `NormalInputs`, so overlays stay possible per
NORMALIZER_FEATURES.md deferrals), and take grayscale via the shared
converter. The existing "AI overlay" blend (`blendNormalOverlay`) becomes a
caller-side normal-overlay input — the shared module gets one compositing
path instead of two.

### Tiling mosaic + sprite frames — upstream :338-391
Not in the C++ core either; port from upstream: build a 3×3 mosaic (repeat
the frame, or its neighbours, in a 3w×3h buffer), run any generator, crop
the center `(w..2w-1, h..2h-1)` — upstream does exactly this crop at :261,
:292, :322. Pure buffer copying; no new math. Frames: plain rectangular
sub-buffer extraction.

## 5. Pain points

### 5.1 CImg `blur()` is not a Gaussian kernel — biggest fidelity + perf issue
CImg's `blur(sigma)` is a **recursive IIR filter (van Vliet/Deriche)** with
Neumann (clamp) boundaries — a quasi-Gaussian, O(1) per pixel regardless of
sigma. The JS `gaussianBlur` in `web/app.js:320` is a true finite-kernel
Gaussian truncated at 3σ. Consequences:

- **Fidelity**: output differs from upstream by a few LSB, more near borders
  and at large sigma. Under "free to diverge" (NORMALIZER_FEATURES.md) this
  is acceptable — the JS look is arguably *more* correct. Accept it; the
  self-regression goldens pin the JS behavior.
- **Performance — this one is not optional**: kernel cost is O(6σ) per pixel
  per pass. Specular/occlusion/parallax blur params go to **50** (sigma
  passed directly, unlike the normal path's radius/3 — don't mix these up:
  `calculate_normal` divides by 3, `modify_*` do not). At σ=50 on 512²
  that's ~300 taps × 2 passes × 262k px ≈ 150M multiply-adds per map —
  hundreds of ms of jank. **Fix**: implement a recursive Gaussian
  (Young–van Vliet, ~60 lines) or a 3-pass box blur (Kovesi's box-size
  formula) in `shared/primitives.js` and use it above a small sigma cutoff.
  This is the main new "hard" code in the whole migration.

### 5.2 Straight vs premultiplied alpha
Two separate traps:

- **Overlay compositing**: upstream composites
  `map*(1-α) + overlay_channel` *without* multiplying the overlay by α
  (`image_processor.cpp:264,295,325`) — correct only because Qt hands it
  **premultiplied** buffers. Canvas `getImageData` is **straight** alpha.
  The JS composite must be `map*(1-α) + overlay*α` (the C++ core already
  corrected this the same way at `laigter_core.cpp:207`).
- **Canvas round-trip lossiness**: `drawImage` → `getImageData`
  premultiplies and un-premultiplies internally, so RGB under partial alpha
  comes back slightly altered. The browser can't avoid it for decoded
  images; the Node CLI reading PNGs directly won't have it. Result: browser
  and CLI can differ by ±1 LSB on semi-transparent edge pixels. Set the
  golden-diff tolerance accordingly (exact match only where α ∈ {0, 255}).

### 5.3 Morphological erode/dilate (the one new primitive)
Parallax Binary needs `dilate(n,n)`/`erode(n,n)` with an n×n rectangular
structuring element, n up to 99. Naive is O(n²) per pixel — at n=99 that's
10k comparisons/px, unusable. A separable sliding-window min/max
(van Herk/Gil–Werman) is O(1) per pixel and ~40 lines. Semantics to match:
CImg treats the size as the full element width (so n=1 is a no-op) — write a
unit test against a hand-computed 5×5 case rather than trusting intuition.

### 5.4 `threshold` + `normalize` edge cases
Upstream parallax Binary does `.threshold(max).normalize(0,255)`. Two traps:
- CImg `threshold` is a strict `>` comparison producing 0/1; keep the same
  comparison direction or thresholds shift by one level.
- `normalize(0,255)` on a **flat** image (everything above or below the
  threshold) is CImg-defined to leave values unchanged — i.e. an all-1
  binary image stays 1, not 255, and the parallax comes out near-black.
  This is a real upstream behavior users hit at extreme thresholds. Decide
  explicitly: replicate it, or (better, since we may diverge) define
  `binary ? 255 : 0` and skip normalize. Document the choice in the code.

Related upstream oddity, for the porter's awareness: statements like
`m_distance.channel(3).threshold(0.1) * 255.0f;` (:536) — the `* 255` result
is **discarded** (no assignment). The buffer really is 0/1 at that point.
Don't "fix" this by multiplying; the JS EDT input already matches (0/1 via
`a > 0` in `alphaDistance`).

### 5.5 float32 vs float64
CImg pipelines run in `float`; JS math is double (Float32Array storage but
double arithmetic). Divergence is sub-LSB after the final quantization to
bytes in practice, but it exists — one more reason bit-exactness with the
old golden PNGs is off the table (already accepted). Keep `Float32Array` for
storage (halves memory, which matters at 3×3-mosaic × sprite-sheet sizes)
and don't chase the arithmetic difference.

### 5.6 PNG I/O in Node (the CLI's only real dependency question)
The browser gets PNG codec for free (canvas). Node has none built in.
Options:
- **`pngjs`** (pure JS, zero native code): the pragmatic choice. One
  `devDependency`-class dep confined to `cli/`; `shared/` stays
  dependency-free.
- Hand-rolled codec over `node:zlib`: ~200 lines for 8-bit RGBA
  encode/decode; only worth it if the zero-dependency property is sacred.
- `sharp`: **no** — it's a native binary, which defeats the purpose of this
  entire migration.

Watch for: 16-bit PNGs (upstream works internally in RGBA64 — see 5.7),
indexed/grayscale PNG color types (pngjs normalizes to RGBA8 — fine), and
gamma chunks (ignore them; upstream does too).

### 5.7 8-bit vs 16-bit internals
Upstream allocates neighbour mosaics as `Format_RGBA64_Premultiplied`
(:395) and converts through 16-bit in places. The JS core is 8-bit in/out
with float intermediates — strictly *less* quantization than upstream's
8→16→8 hops in most paths. Accepted divergence; note it in the goldens
README so a future "why doesn't this match upstream" investigation starts
here.

### 5.8 What replaces the cached ctx / dirty-stage graph
REWRITE_PLAN.md §3 Phase 1 planned a C `ctx` caching `m_distance`, `m_gray`,
mosaics, with dirty-stage invalidation. In JS, don't build an object system —
keep pure functions and cache at the **call site** (the worker), keyed on
what actually invalidates each intermediate:

| Cached buffer | Recompute when |
|---|---|
| grayscale | source/heightmap changes |
| alpha EDT (`alphaDistance`) | source alpha changes (not on any slider!) |
| bevel distance (`modify_distance`) | EDT, `bisel_distance`, `bisel_soft` |
| 3×3 mosaic | source, tiling toggles, frame grid |

The EDT is the expensive one and is currently recomputed on **every slider
tick** (`generateNormalMap` calls `alphaDistance` unconditionally) — hoisting
it behind a cache is the single biggest perf win available, bigger than any
blur optimization, and it's also what parallax-HeightMap and
occlusion-distance-mode will share.

### 5.9 Keeping the UI responsive
Everything above lands on the main thread today. With four maps × mosaic ×
sigma-50 blurs, that's guaranteed jank. Per NORMALIZER_FEATURES.md §2: one
Web Worker, existing 40ms debounce, `postMessage` with **transferred**
`ArrayBuffer`s (zero-copy). `shared/` being DOM-free is what makes the same
code loadable in the worker and in Node without modification.

### 5.10 GPL follows the port
The JS functions are translations of Laigter's GPL-3.0 code — the license
obligation transfers to the JS regardless of language or how many times it's
rewritten (REWRITE_PLAN.md license note). Keep the derivation header comments
(as `laigter_core.cpp` does) on `shared/normal.js`, `parallax.js`, etc.

## 6. Order of work

Roughly matches NORMALIZER_FEATURES.md §1, refined by the dependencies above:

1. **Extract `shared/`** from `web/app.js` (image record, primitives, normal
   path); convert `web/index.html` to module scripts. No behavior change —
   verify with a manual before/after export diff.
2. **Node CLI skeleton** (`cli/` + pngjs): load PNG → `generateNormalMap` →
   save PNG. This is the moment the golden harness can switch targets.
3. **Repoint goldens**: `tests/golden/manifest.json` cases run through the
   Node CLI; current JS output becomes the pinned expectation
   (self-regression role per NORMALIZER_FEATURES.md §2). Keep
   `tests/golden/upstream/*.png` checked in as frozen reference.
4. **New primitives**: fast blur (5.1), erode/dilate (5.3) — with unit tests
   (a hand-computed small case each), since goldens won't cover them until
   the maps exist.
5. **Specular → occlusion → parallax** (easiest-first; parallax last because
   it needs erode/dilate and the shared bevel-distance cache). Panel + CLI
   flag + golden cases per map.
6. **EDT/bevel caching + single worker** (5.8, 5.9).
7. **Mosaic + frames** modules; wire tiling and sprite sheets through all
   four generators.
8. **Retire C++** — see checklist.

## 7. C++ retirement checklist

Delete only when all boxes tick:

- [ ] `make golden` passes with the harness pointed at the Node CLI
      (`scripts/run_core_cases.py` currently shells out to
      `build/laigter-core-cli` — swap the binary path).
- [ ] Node CLI covers every flag the C++ CLI had
      (`core/tools/laigter_core_cli.cpp`).
- [ ] `tests/golden/upstream/*.png` are committed (they're irreplaceable
      without a Qt build of upstream).
- [ ] One final side-by-side: C++ CLI output vs Node CLI output on the
      fixture corpus, differences eyeballed and accepted (they will not be
      bit-identical — see 5.1, 5.5 — the check is "no visible regression").

Then: remove `core/`, `CMakeLists.txt`, the C++ targets in `Makefile`, and
`build/`. The `laigter/` upstream checkout stays — it's the porting
reference for parallax/specular/occlusion/mosaic and the license root.
