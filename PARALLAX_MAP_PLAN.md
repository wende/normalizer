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
- **§5.1 blur sigma.** `parallaxFocus`/`parallaxSoft` are sigmas (range 0–50);
  call `gaussianBlur(...,3*sigma)` or use the fast blur.
- **Shared bevel distance.** `dist` == `modify_distance` output, driven by the
  normal params `biselDistance`/`softBisel`. HeightMap parallax must read the
  same distance buffer; expose it from the normal path rather than recomputing
  (see §5.8 caching hooks).

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

(`parallaxQuantization` exists upstream but drives only the stub types — omit.)

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

- GPL-3.0 header. Reuse `grayscaleFromRgba`, `gaussianBlur`, the new
  `erode`/`dilate`, and (HeightMap) the shared bevel-distance computation —
  factor `modify_distance` out of `shared/normal.js` into a shared helper so
  both maps call it.

## New primitives — `shared/primitives.js`

- `dilate(buf, w, h, n)` / `erode(buf, w, h, n)` — separable O(1)/px min/max,
  n×n rectangular element, n=1 is a no-op. Shared unit test on a 5×5 fixture.
- `bevelDistance(...)` helper extracted from the normal path (also usable by
  occlusion's distance mode) — optional refactor, keeps HeightMap parallax from
  duplicating the EDT.

## CLI / Web / Preview / Tests

- **CLI**: `parallax` subcommand with a `--parallax-type` switch that gates the
  Binary-only vs HeightMap-only flags; USAGE lists both groups; PNG round-trip;
  smoke case per type.
- **Web**: `ParallaxPanel` with a type selector that swaps the visible controls
  (Binary: max/min/focus/soft/erode-dilate/invert; HeightMap: max/brightness/
  contrast/soft/invert). Recompute wire-up in `App.jsx`; Parallax preview tab;
  `_p` export suffix. Contrast slider UI 1–4000 ÷1000.
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
2. Extract `bevelDistance` from `shared/normal.js` (shared with occlusion).
3. `shared/parallax.js` + defaults; implement Binary then HeightMap.
4. Resolve the §5.4 normalize decision in code + comment.
5. Blur via `gaussianBlur(...,3*sigma)` (or §5.1 fast blur).
6. CLI `parallax` subcommand (type-gated flags) + smoke per type.
7. Web Parallax panel (type selector) + preview tab + `_p` export.
8. Self-regression goldens.

## Open decisions

- **Replicate the flat-image `normalize` quirk (§5.4) or fix it?** Recommend
  fixing (`binary ? 255 : 0`) since parity is a non-goal — but pin whichever
  with a golden so it does not silently drift.
- **Share bevel distance across normal/parallax/occlusion now, or recompute?**
  Sharing needs the §5.8 cache hooks; if those slip, recompute locally first and
  wire the cache when the single-worker recompute (`NORMALIZER_FEATURES.md` §2)
  lands — the EDT is the most expensive primitive.
