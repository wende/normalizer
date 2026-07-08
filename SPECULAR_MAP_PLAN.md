# Specular Map Migration Plan

Port Laigter's specular-map generator into the shared JS core, the Node CLI,
and the web UI. Ordered **first** of the three remaining maps because it is the
simplest: a per-pixel contrast/brightness/invert pipeline around a single blur,
no distance transform, no morphology.

- Upstream reference: `laigter/src/image_processor.cpp:729` (`modify_specular`),
  driven by `calculate_specular` at `:275`.
- Porting analysis already written: `JS_CORE_MIGRATION.md` §4 "Specular", §3
  (CImg op inventory), §5.1 (blur), §5.2 (alpha).
- Parameter source of truth: `REWRITE_PLAN.md` §2 "Specular map".

## Scope

- IN: grayscale-derived specular from the diffuse, contrast/brightness/blur/
  invert controls, CLI `specular` subcommand, web Specular panel, PNG export.
- OUT (deferred): custom specular-base input map (upstream `SpecularBase` /
  `customSpecularMap`) — generation accepts an optional source buffer now so
  only the UI is missing later (mirrors `NORMALIZER_FEATURES.md` §3 "Custom
  heightmap / specular base inputs"). Tileable neighbour mosaic is handled by
  the shared tiling wrapper, not here.

## Algorithm

Upstream `modify_specular`, transcribed:

```
src   = grayscale(specularBase ?? diffuse)          // Float32, [0,255]
out   = contrast * src + thresh * (1 - contrast)     // contrast pivot at thresh
out  += bright
out   = clamp(out, 0, 255)
out   = blur(out, specularBlur)                      // sigma = specularBlur
if invert: out = 255 - out
```

Emit RGBA: `R=G=B=out`, `A = useAlpha ? source.alpha : 255`.

Notes for the porter:
- **Blur sigma mismatch** (`JS_CORE_MIGRATION.md` §5.1): `modify_specular` passes
  the param *directly as sigma*, whereas `shared/primitives.js` `gaussianBlur`
  takes a **radius** and internally uses `sigma = radius/3`. Call it as
  `gaussianBlur(out, w, h, 3 * specularBlur)` to get the same sigma, or add a
  sigma-based blur. `specularBlur` ranges to 50, so §5.1's perf fix (recursive
  or box blur above a small sigma cutoff) applies here too.
- Contrast pivot: `contrast*px + thresh*(1-contrast)` rotates values around
  `thresh`, it is not a 0-centered contrast. Keep the formula literally.
- Fully-transparent pixels: `grayscaleFromRgba` already zeroes them.

## Parameters

| shared / web param | CLI flag | type | default | range | notes |
|---|---|---|---|---|---|
| `specularThresh` | `--specular-thresh` | int | 127 | 0–255 | contrast pivot |
| `specularContrast` | `--specular-contrast` | float | 1.0 | 0.001–4.0 (UI 1–4000 ÷1000) | |
| `specularBright` | `--specular-bright` | int | 0 | −255–255 | |
| `specularBlur` | `--specular-blur` | int | 3 (UI 10) | 0–50 | sigma; ×3 for `gaussianBlur` radius |
| `specularInvert` | `--specular-invert` | bool | false | — | |
| `useAlpha` | `--use-specular-alpha` | bool | false | — | copy source alpha |

## Shared module — `shared/specular.js`

Mirror the shape of `shared/normal.js`:

```js
export const DEFAULT_SPECULAR_PARAMS = { specularThresh:127, specularContrast:1,
  specularBright:0, specularBlur:3, specularInvert:false, useAlpha:false };

// source: { width, height, data } RGBA diffuse.
// specularBase: optional { width, height, data } — defaults to source.
export function generateSpecularMap(source, p, specularBase = source) {
  // returns { width, height, data }  (Uint8ClampedArray RGBA)
}
```

- GPL-3.0 derivation header (copy from `shared/normal.js`).
- Reuse `grayscaleFromRgba` from `shared/image.js` and `gaussianBlur` from
  `shared/primitives.js`. No new primitive required.

## CLI — `cli/normalizer.js`

- Add a `specular` subcommand next to `normal`, same arg/exit contract
  (`failUsage`/`fail`/`requireValue`, strtol-style int parsing already present).
- USAGE block mirroring the normal one; flags per the table above.
- Read 8-bit PNG → `generateSpecularMap` → write 8-bit RGBA PNG.

## Web UI

- New `SpecularPanel` (follow `web/src/ControlsPanel.jsx` + `ControlCard.jsx`
  patterns; contrast slider is UI 1–4000 mapped ÷1000, matching upstream).
- Wire into the recompute path in `web/src/App.jsx`; add a Specular preview tab
  (`web/src/PreviewTabBar.jsx`) showing the raw map.
- Export: `_s` suffix (see `EXPORT` note below); coordinate with the shared
  export-suffix work in `NORMALIZER_FEATURES.md` §1.5.

## Tests

- Unit: pin the per-pixel math on a tiny hand-computed fixture (contrast pivot,
  bright clamp, invert) — no blur, so it is exact and fast.
- Golden: add self-regression cases to `tests/golden/manifest.json` (defaults +
  each param at min/mid/max, invert on/off) once `generateSpecularMap` lands;
  drive via `scripts/run_core_cases.py --cli cli/normalizer.js`. Tolerance per
  `JS_CORE_MIGRATION.md` §5.2 (exact where α∈{0,255}, ±1 LSB on semi-transparent
  edges browser-vs-CLI).

## Checklist

1. `shared/specular.js` + `DEFAULT_SPECULAR_PARAMS`.
2. Unit test for the per-pixel pipeline.
3. Blur call: reuse `gaussianBlur(...,3*blur)`; if profiling janks at σ→50,
   pull in the §5.1 fast blur (shared with occlusion/parallax).
4. CLI `specular` subcommand + USAGE + smoke.
5. Web Specular panel + preview tab + `_s` export.
6. Self-regression goldens.

## Open decisions

- **Fast blur now or later?** Specular alone rarely needs it, but occlusion and
  parallax do; implementing the §5.1 blur once here pays off for all three.
- **Expose custom specular base in UI?** Deferred per `NORMALIZER_FEATURES.md`;
  keep the `specularBase` parameter in the signature so it is UI-only later.
