# Parallax (Height/Displacement) Map Migration Plan

Port Laigter's parallax-map generator into the shared JS core, the Node CLI,
and the web UI. Ordered **last** of the three remaining maps: it needs the one
genuinely new primitive in the whole migration (morphological erode/dilate) and
depends on the same bevel-distance buffer the normal path produces.

- Upstream reference: `laigter/src/image_processor.cpp:671` (`modify_parallax`),
  driven by `calculate_parallax` at `:242`; depends on `modify_distance` (`:620`).
- Porting analysis already written: `JS_CORE_MIGRATION.md` §4 "Parallax", §5.3
  (erode/dilate), §5.4 (threshold/normalize edge cases), §5.1 (blur).
- Parameter source of truth: `REWRITE_PLAN.md` §2 "Parallax map".

## Scope

- IN: the two **live** parallax types — `Binary` and `HeightMap`. CLI
  `parallax` subcommand, web Parallax panel, PNG export.
- OUT: `Quantization` and `Intervals` types — **empty stubs upstream**
  (`image_processor.cpp:715-723`); omit from UI and CLI per
  `NORMALIZER_FEATURES.md` and `REWRITE_PLAN.md` §"Quantization / Intervals".
- OUT (parity omissions, matching every other ported map — call these out so
  they read as decisions, not oversights):
  - **Non-tileable only.** Upstream `calculate_parallax` crops the 3×3 mosaic
    when `tileable` (`image_processor.cpp:257-262`); we don't port tiling for
    any map, so `generateParallaxMap` produces a single-tile result.
  - **No overlay compositing.** Upstream blends a parallax overlay by alpha
    (`image_processor.cpp:264`); like `generateNormalMap` (overlay is
    caller-side via `blendNormalOverlay`), the shared generator emits the raw
    map and leaves overlay to the caller.

## Algorithm

Two live branches of upstream `modify_parallax`. `dist` below is the bevel
distance buffer from `modify_distance` — the *same* one `generateNormalMap`
already computes internally (a sharing opportunity, `JS_CORE_MIGRATION.md`
§5.8).

**Binary** (`parallaxType === "binary"`):
```
par = grayscale(height ?? diffuse)
par = blur(par, parallaxFocus)
par = threshold(par, parallaxMax)         // strict >, 0/1
par = normalize(par, 0, 255)              // SEE §5.4 flat-image trap
par -= parallaxMin
if !parallaxInvert: par = 255 - par        // note: inverted-by-default polarity
if parallaxErodeDilate > 0: par = dilate(par, n, n)   // n = parallaxErodeDilate
else:                        par = erode(par, -n, -n)
par = blur(par, parallaxSoft)
par = clamp(par, 0, 255)
```

**HeightMap** (`parallaxType === "heightmap"`):
```
par  = grayscale(height ?? diffuse)
par  = (par + dist - 1) / 2 + 0.5          // blend gray with bevel distance
par  = parallaxContrast * par + parallaxMax * (1 - parallaxContrast)
par += parallaxBrightness
par  = blur(par, parallaxSoft)
if parallaxInvert: par = 255 - par
par  = clamp(par, 0, 255)
```

Emit RGBA: `R=G=B=par`, `A = useAlpha ? source.alpha : 255`.

Traps (all from `JS_CORE_MIGRATION.md`):
- **§5.3 erode/dilate — the new primitive.** n up to 99; naive O(n²)/px is
  unusable. Implement a separable sliding-window min/max (van Herk / Gil–Werman),
  O(1)/px, ~40 lines, in `shared/primitives.js`. CImg counts the size as the
  full element width so **n=1 is a no-op** — unit-test against a hand-computed
  5×5 case, do not trust intuition. `erode`=min, `dilate`=max.
- **§5.4 threshold + normalize.** `normalize(0,255)` on a *flat* binary (every
  pixel above or below the threshold) leaves values unchanged in CImg → an
  all-1 image stays 1, giving a near-black parallax at extreme thresholds. Since
  we may diverge, prefer defining `binary ? 255 : 0` and skipping `normalize`;
  document the choice in the code.
- **Inverted-by-default polarity.** Binary applies `255 - par` when *not*
  inverted. Preserve the sign exactly or the map comes out reversed.
- **§5.1 blur sigma — slow blur, deferred debt.** `parallaxFocus`/`parallaxSoft`
  are sigmas (range 0–50); call `gaussianBlur(...,3*sigma)`. **There is no fast
  blur** — the §5.1 recursive/box blur was never built, and `shared/primitives.js`
  ships only the finite-kernel `gaussianBlur` (which specular already uses at
  `shared/specular.js:58`). We accept the same deferred debt here, but note it is
  *sharper* than specular's: specular runs one blur pass, whereas **Binary runs
  two** (focus pre-blur + soft post-blur) at up to σ=50 (≈900-tap kernel) on the
  main thread every 40 ms slider tick. If tuning proves unusable, building the
  fast blur is the fix — but that is out of scope for this map and tracked
  separately in `JS_CORE_MIGRATION.md` §5.1. Do not treat the fast blur as an
  available drop-in in the steps below.
- **Shared bevel distance — recompute locally for now.** `dist` == `modify_distance`
  output, driven by the normal params `biselDistance`/`softBisel`. HeightMap
  parallax needs the same distance buffer, but the §5.8 cache hooks that would let
  it *share* the normal path's buffer do not exist yet — extracting/sharing without
  them buys nothing (HeightMap recomputes the EDT either way). **Recompute the
  distance locally** in `generateParallaxMap`; wire sharing only when the
  single-worker recompute (`NORMALIZER_FEATURES.md` §2) lands. Note this makes the
  EDT — and thus the `edt1d` Float32 leading-seed-drop bug (memory:
  `edt1d-float32-precision-bug`) — a **third** dependent alongside normal bevel and
  occlusion; the self-regression goldens will pin its slightly-off output.

## Parameters

| shared / web param | CLI flag | type | default | range | notes |
|---|---|---|---|---|---|
| `parallaxType` | `--parallax-type <binary\|heightmap>` | enum | binary | binary/heightmap | stubs omitted |
| `parallaxMax` (thresh) | `--parallax-max` | int | 140 | 0–255 | Binary threshold / HeightMap contrast pivot |
| `parallaxMin` | `--parallax-min` | int | 0 | 0–255 | Binary floor |
| `parallaxFocus` | `--parallax-focus` | int | 2 (UI 3) | 0–50 | Binary pre-blur sigma |
| `parallaxSoft` | `--parallax-soft` | int | 3 (UI 10) | 0–50 | post-blur sigma |
| `parallaxErodeDilate` | `--parallax-erode-dilate` | int | 1 (UI 0) | −99–99 | >0 dilate, <0 erode (Binary) |
| `parallaxBrightness` | `--parallax-brightness` | int | 0 | −255–255 | HeightMap |
| `parallaxContrast` | `--parallax-contrast` | float | 1.0 | 0.001–4.0 (UI 1–4000 ÷1000) | HeightMap |
| `parallaxInvert` | `--parallax-invert` | bool | false | — | |
| `useAlpha` | `--use-parallax-alpha` | bool | false | — | |

All defaults verified against upstream initializers `image_processor.cpp:57-66`
(`parallax_max=140`, `min=0`, `invert=false`, `focus=2`, `soft=3`,
`type=Binary`, `brightness=0`, `contrast=1`, `erode_dilate=1`).

(`parallaxQuantization` exists upstream but drives only the stub types — omit.)

`height` is future scaffolding: the web UI has no separate height-image loader,
so `height` always defaults to `source` (grayscaled) today, exactly as
`generateNormalMap` does. Keep the parameter for parity, but nothing feeds it a
distinct buffer until a height loader exists.

## Shared module — `shared/parallax.js`

```js
export const DEFAULT_PARALLAX_PARAMS = { parallaxType:"binary", parallaxMax:140,
  parallaxMin:0, parallaxFocus:2, parallaxSoft:3, parallaxErodeDilate:1,
  parallaxBrightness:0, parallaxContrast:1, parallaxInvert:false, useAlpha:false };

// height: optional diffuse override.
// bevelDistance: optional Float32 buffer from the normal path (HeightMap type);
//   if absent, compute it locally from biselDistance/softBisel.
export function generateParallaxMap(source, p, height = source, bevelDistance = null) {
  // returns { width, height, data }
}
```

- GPL-3.0 header. Reuse `grayscaleFromRgba`, `gaussianBlur`, and the new
  `erode`/`dilate`. HeightMap needs the bevel distance: **recompute it locally**
  from `biselDistance`/`softBisel` for now rather than factoring `modify_distance`
  out of `shared/normal.js` — the extraction only pays off once the §5.8 cache
  hooks let the buffer actually be shared (see the "Shared bevel distance" trap
  and Open decisions).

## New primitives — `shared/primitives.js`

- `dilate(buf, w, h, n)` / `erode(buf, w, h, n)` — separable O(1)/px min/max,
  n×n rectangular element, n=1 is a no-op. Shared unit test on a 5×5 fixture.

(No `bevelDistance` extraction this pass — HeightMap recomputes the distance
locally; extracting a shared helper is deferred to the §5.8 cache work, when
normal/parallax/occlusion can genuinely share one buffer.)

## CLI / Web / Preview / Tests

- **CLI**: `parallax` subcommand with a `--parallax-type` switch; USAGE lists
  both flag groups; PNG round-trip; smoke case per type. **Flag gating is
  accept-and-ignore, not reject** — the existing parser only fails on *unknown*
  options (`cli/normalizer.js:116,146`); a known flag that belongs to the other
  type (e.g. `--parallax-erode-dilate` under `--parallax-type heightmap`) is
  parsed and silently ignored, matching upstream's single-struct behavior. Do
  not add per-type rejection.
- **Web**: fold parallax into the existing Preact controls the way specular is
  wired — there are **no per-map panel components**. Mirror specular across
  `web/src/` (`controls.js` `DEFAULT_PARALLAX`/`buildParallaxParams`;
  `ControlsPanel.jsx` `parallax` `TABS` entry + `showParallax` block;
  `previewRender.js` `generateParallax`; `App.jsx` state/recompute/export;
  `PreviewTabBar.jsx` `MODES` entry). The type selector is a radio group inside
  the parallax block (reuse the `radio-group` pattern already used for bump
  profile / AI overlap) that conditionally renders the visible controls — Binary:
  max/min/focus/soft/erode-dilate/invert; HeightMap: max/brightness/contrast/
  soft/invert. Export filename is **`laigter-parallax.png`** (the existing
  `laigter-<map>.png` convention — `App.jsx:260-261` exports
  `laigter-specular.png`/`laigter-normal.png`; there is no `_s`/`_n`/`_p`
  suffix token); contrast slider UI 1–4000 ÷1000.
- **Preview**: raw-map tab. Live parallax-occlusion preview is a WebGL2 concern
  deferred in `NORMALIZER_FEATURES.md` §3 — a flat height preview is enough to
  tune the map.
- **Tests**:
  - Unit: `erode`/`dilate` 5×5 fixture (n=1 no-op, n=3 known result); Binary
    polarity + normalize decision on a tiny image; HeightMap blend math.
  - Golden: self-regression cases — each type, threshold/erode-dilate/soft at
    min/mid/max, invert on/off. Tolerance per §5.2.

## Checklist

1. `dilate`/`erode` primitives + 5×5 unit test.
2. `shared/parallax.js` + defaults; implement Binary then HeightMap. Compute the
   bevel distance **locally** (recompute, do not extract/share — see the "Shared
   bevel distance" trap). Extraction is deferred to the §5.8 cache work.
3. Resolve the §5.4 normalize decision in code + comment.
4. Blur via `gaussianBlur(...,3*sigma)` — slow blur only; the fast blur does not
   exist and is out of scope.
5. CLI `parallax` subcommand (accept-and-ignore flag gating, not rejection) +
   smoke per type.
6. Web wiring (mirror specular, no new panel component): `controls.js`
   defaults/build fn, `ControlsPanel.jsx` parallax block + `TABS` entry (radio
   type selector swapping the visible controls), `previewRender.js` generator,
   `App.jsx` state/recompute/export as `laigter-parallax.png`,
   `PreviewTabBar.jsx` preview tab.
7. Self-regression goldens.

## Open decisions

- **Replicate the flat-image `normalize` quirk (§5.4) or fix it?** Recommend
  fixing (`binary ? 255 : 0`) since parity is a non-goal — but pin whichever
  with a golden so it does not silently drift.
- **Share bevel distance across normal/parallax/occlusion now, or recompute?**
  **Decided: recompute locally** this pass. Sharing needs the §5.8 cache hooks,
  and without them extraction buys nothing (HeightMap re-runs the EDT regardless);
  wire the shared buffer when the single-worker recompute
  (`NORMALIZER_FEATURES.md` §2) lands — the EDT is the most expensive primitive.
