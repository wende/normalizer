/*
 * Parallax (height/displacement) map generation — derived from Laigter's
 * GPL-3.0 image processing logic (laigter/src/image_processor.cpp:671,
 * modify_parallax), driven by calculate_parallax at :242.
 *
 * Pure functions over plain { width, height, data } records — no DOM, no Node
 * APIs. generateParallaxMap returns a plain record; the browser wraps it in
 * ImageData at the boundary, the CLI writes it via pngjs.
 *
 * Only the two live upstream types are ported (Binary, HeightMap); the
 * Quantization/Intervals cases are empty stubs upstream and omitted per
 * docs/NORMALIZER_FEATURES.md. Non-tileable + no overlay compositing, matching the
 * other ported maps (see docs/PARALLAX_MAP_PLAN.md "Scope").
 */

import { grayscaleFromRgba } from "./image.js";
import { alphaDistance, gaussianBlur, dilate, erode } from "./primitives.js";

/**
 * Default parallax-map parameters. Mirrors the CLI defaults so both share one
 * source of truth (the web UI keeps prettier blur defaults in controls.js).
 * biselDistance/softBisel are internal inputs to the HeightMap bevel-distance
 * recompute (the same buffer the normal path produces); they are not user-facing
 * parallax knobs and have no CLI flag / UI slider.
 */
export const DEFAULT_PARALLAX_PARAMS = {
  parallaxType: "binary",
  parallaxMax: 140,
  parallaxMin: 0,
  parallaxFocus: 2,
  parallaxSoft: 3,
  parallaxErodeDilate: 1,
  parallaxBrightness: 0,
  parallaxContrast: 1,
  parallaxInvert: false,
  useAlpha: false,
  // HeightMap bevel-distance inputs (mirror DEFAULT_NORMAL_PARAMS). Local until
  // the §5.8 cache hooks let this share the normal path's buffer.
  biselDistance: 60,
  softBisel: true,
};

/**
 * Bevel-distance buffer = upstream modify_distance() output (the same buffer
 * generateNormalMap computes internally). Recomputed locally here per the
 * docs/PARALLAX_MAP_PLAN.md "Shared bevel distance" trap: sharing needs the §5.8
 * cache hooks, and without them HeightMap re-runs the EDT regardless.
 */
function computeBevelDistance(source, p) {
  const distance = alphaDistance(source);
  const bevel = new Float32Array(distance.length);
  for (let i = 0; i < bevel.length; i += 1) {
    let d = p.biselDistance !== 0 ? (distance[i] * 255) / p.biselDistance : distance[i] > 0.1 ? 255 : 0;
    d = d < 0 ? 0 : d > 255 ? 255 : d;
    if (p.softBisel) d = Math.sqrt(1 - (d / 255 - 1) ** 2) * 255;
    bevel[i] = d;
  }
  return bevel;
}

/**
 * Generate a grayscale parallax (displacement) map from an RGBA source. Two
 * live types: `binary` (threshold → invert-by-default → erode/dilate → soft
 * blur) and `heightmap` (gray blended with the bevel distance → contrast around
 * parallaxMax → brightness → soft blur → optional invert). Returns a plain
 * { width, height, data: Uint8ClampedArray } record (8-bit RGBA, R=G=B=height).
 *
 * `height` defaults to `source` (grayscaled) — there is no separate height-image
 * loader yet, exactly as generateNormalMap does; keep the param for parity.
 * `bevelDistance` optionally supplies the normal path's bevel buffer (HeightMap
 * only); if absent it is recomputed locally from biselDistance/softBisel.
 */
export function generateParallaxMap(source, p, height = source, bevelDistance = null) {
  const width = source.width;
  const heightPx = source.height;
  let par = grayscaleFromRgba(height);

  if (p.parallaxType === "heightmap") {
    const dist = bevelDistance || computeBevelDistance(source, p);
    for (let i = 0; i < par.length; i += 1) {
      let v = (par[i] + dist[i] - 1) / 2 + 0.5;
      v = p.parallaxContrast * v + p.parallaxMax * (1 - p.parallaxContrast);
      v += p.parallaxBrightness;
      par[i] = v;
    }
    par = p.parallaxSoft > 0 ? gaussianBlur(par, width, heightPx, 3 * p.parallaxSoft) : par;
    if (p.parallaxInvert) {
      for (let i = 0; i < par.length; i += 1) par[i] = 255 - par[i];
    }
  } else {
    // Binary. parallaxFocus is the pre-blur (Binary-only upstream — HeightMap
    // skips straight to the soft post-blur).
    if (p.parallaxFocus > 0) par = gaussianBlur(par, width, heightPx, 3 * p.parallaxFocus);
    // §5.4 decision: define threshold as a strict `>` to 0/255 directly
    // and SKIP normalize(0,255). CImg's normalize is a no-op on a flat (all-above
    // or all-below-threshold) image, so the upstream map comes out near-black at
    // extreme thresholds; we avoid that since parity is a non-goal.
    for (let i = 0; i < par.length; i += 1) {
      par[i] = par[i] > p.parallaxMax ? 255 : 0;
    }
    for (let i = 0; i < par.length; i += 1) par[i] -= p.parallaxMin;
    // Inverted-by-default polarity: upstream applies 255-par when NOT inverted.
    if (!p.parallaxInvert) {
      for (let i = 0; i < par.length; i += 1) par[i] = 255 - par[i];
    }
    const n = p.parallaxErodeDilate;
    par = n > 0 ? dilate(par, width, heightPx, n) : erode(par, width, heightPx, -n);
    par = p.parallaxSoft > 0 ? gaussianBlur(par, width, heightPx, 3 * p.parallaxSoft) : par;
  }

  const data = new Uint8ClampedArray(width * heightPx * 4);
  for (let i = 0, px = 0; i < par.length; i += 1, px += 4) {
    const c = par[i] < 0 ? 0 : par[i] > 255 ? 255 : par[i];
    data[px] = c;
    data[px + 1] = c;
    data[px + 2] = c;
    data[px + 3] = p.useAlpha ? source.data[px + 3] : 255;
  }

  return { width, height: heightPx, data };
}
