# Occlusion (Ambient Occlusion) Map Migration Plan

Port Laigter's occlusion-map generator into the shared JS core, the Node CLI,
and the web UI. Ordered **second** of the three remaining maps: it adds one
reusable primitive (a general distance transform) on top of the specular-style
per-pixel pipeline, and reuses the soft-bevel circular profile the normal path
already ships.

- Upstream reference: `laigter/src/image_processor.cpp:641` (`modify_occlusion`),
  driven by `calculate_occlusion` at `:305`.
- Porting analysis already written: `JS_CORE_MIGRATION.md` §4 "Occlusion", §3
  (op inventory), §5.1 (blur).
- Parameter source of truth: `REWRITE_PLAN.md` §2 "Occlusion map".

## Scope

- IN: grayscale-derived AO with an optional distance-transform mode,
  contrast/brightness/blur/invert, CLI `occlusion` subcommand, web Occlusion
  panel, PNG export.
- OUT: custom heightmap input (deferred, `NORMALIZER_FEATURES.md` §3 —
  generation already accepts an optional height source). Tiling via the shared
  mosaic wrapper.

## Algorithm

Upstream `modify_occlusion`, transcribed (note **default is distance mode ON**):

```
occ = grayscale(height ?? diffuse)                   // Float32, [0,255]
if occlusionInvert: occ = 255 - occ

if occlusionDistanceMode:
    occ = threshold(occ, occlusionThresh)  // > thresh -> 1, else 0  (0/1 mask)
    if occlusionDistance != 0:
        occ = distanceTransform(occ)       // EDT to nearest 0 pixel
        occ *= 255 / occlusionDistance
    occ = clamp(occ, 0, 255)
    occ = sqrt(1 - (occ/255 - 1)^2) * 255  // circular "soft bevel" profile

occ = occlusionContrast * occ + occlusionThresh * (1 - occlusionContrast)
occ += occlusionBright
occ = clamp(occ, 0, 255)
occ = blur(occ, occlusionBlur)                       // sigma = occlusionBlur
```

Emit RGBA: `R=G=B=occ`, `A = useAlpha ? source.alpha : 255`.

Notes for the porter:
- **Distance transform is on the thresholded grayscale, not alpha.** The
  existing `alphaDistance` in `shared/primitives.js` is hard-wired to the alpha
  channel and the interior mask. Factor its two-pass `edt1d` body into a general
  `distanceTransform(mask, width, height)` that takes any 0/`inf` grid, then
  have `alphaDistance` call it. Occlusion builds the mask from
  `threshold(gray, occlusionThresh)`. (`edt1d` itself — the Felzenszwalb pass
  CImg also uses — is already correct per `JS_CORE_MIGRATION.md` §3.)
- **Circular profile** `sqrt(1-(x/255-1)^2)*255` is the *same* formula the
  soft-bevel normal path uses (`modify_distance`, `image_processor.cpp:636`);
  keep one helper if convenient.
- **Threshold semantics** (`JS_CORE_MIGRATION.md` §5.4): CImg `threshold(t)` is a
  strict `>` producing 0/1; keep the direction or AO shifts by one level.
- **Blur sigma mismatch** (§5.1): as with specular, `occlusionBlur` is a sigma;
  call `gaussianBlur(occ, w, h, 3*occlusionBlur)` or use the fast blur.
- **Non-distance mode** skips threshold/EDT/profile entirely — it is just the
  specular-style contrast/bright/blur on the (optionally inverted) grayscale.

## Parameters

| shared / web param | CLI flag | type | default | range | notes |
|---|---|---|---|---|---|
| `occlusionThresh` | `--occlusion-thresh` | int | 1 | 0–255 | threshold + contrast pivot |
| `occlusionContrast` | `--occlusion-contrast` | float | 1.0 | 0.001–4.0 (UI 1–4000 ÷1000) | |
| `occlusionBright` | `--occlusion-bright` | int | 16 (UI 10) | −255–255 | |
| `occlusionBlur` | `--occlusion-blur` | int | 3 (UI 10) | 0–50 | sigma; ×3 for `gaussianBlur` radius |
| `occlusionDistanceMode` | `--occlusion-flat` (to disable) | bool | true | — | distance-transform AO |
| `occlusionDistance` | `--occlusion-distance` | int | 10 | 0–1024 | falloff scale (0 = skip EDT) |
| `occlusionInvert` | `--occlusion-invert` | bool | false | — | |
| `useAlpha` | `--use-occlusion-alpha` | bool | false | — | |

## Shared module — `shared/occlusion.js`

```js
export const DEFAULT_OCCLUSION_PARAMS = { occlusionThresh:1, occlusionContrast:1,
  occlusionBright:16, occlusionBlur:3, occlusionDistanceMode:true,
  occlusionDistance:10, occlusionInvert:false, useAlpha:false };

// height: optional { width, height, data } — defaults to source (diffuse).
export function generateOcclusionMap(source, p, height = source) {
  // returns { width, height, data }
}
```

- GPL-3.0 header. Reuse `grayscaleFromRgba`, the new `distanceTransform`, and
  `gaussianBlur`.

## New primitive — `shared/primitives.js`

- `distanceTransform(mask, width, height)` — extract from `alphaDistance`
  (two `edt1d` passes + `sqrt`). Unit test: known point-mask → analytic
  distances. Then rewrite `alphaDistance` as a thin caller so its goldens stay
  green.

## CLI / Web / Preview / Tests

- **CLI**: `occlusion` subcommand, USAGE, PNG round-trip; smoke case.
- **Web**: `OcclusionPanel` with a distance-mode toggle that shows/hides the
  distance slider; recompute wire-up in `App.jsx`; Occlusion preview tab; `_o`
  export suffix.
- **Preview**: raw-map tab first. Multiplying AO into the lit preview
  (`shared/preview.js`) is optional polish, not required for this plan.
- **Tests**: unit for the per-pixel math (flat mode, exact) and for
  `distanceTransform`; self-regression goldens covering distance-mode on/off,
  `occlusionDistance` at {0, mid, high}, invert on/off. Tolerance per §5.2.

## Checklist

1. `distanceTransform` primitive + unit test; refactor `alphaDistance` onto it.
2. `shared/occlusion.js` + defaults.
3. Unit test for flat-mode per-pixel pipeline.
4. Blur via `gaussianBlur(...,3*blur)` (or §5.1 fast blur if janky).
5. CLI `occlusion` subcommand + smoke.
6. Web Occlusion panel (distance-mode toggle) + preview tab + `_o` export.
7. Self-regression goldens.

## Open decisions

- **CLI flag for distance mode**: default-true bool is awkward as `--x`. Suggest
  `--occlusion-flat` to *disable* distance mode (keeps the common path
  flagless), or a `--occlusion-distance-mode <0|1>` explicit form for parity
  with the sweep script. Pick one and document it in USAGE.
- **AO in lit preview**: defer unless tuning needs it.
