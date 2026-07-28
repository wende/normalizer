/*
 * Occlusion-map generation — derived from Laigter's GPL-3.0 image processing
 * logic (laigter/src/image_processor.cpp:641, modify_occlusion).
 *
 * Pure functions over plain { width, height, data } records — no DOM, no Node
 * APIs. generateOcclusionMap returns a plain record; the browser wraps it in
 * ImageData at the boundary, the CLI writes it via pngjs.
 */

import { grayscaleFromRgba } from "./image.js";
import { distanceTransform, gaussianBlur } from "./primitives.js";
import { downsampleRgba, normalizePixelSize, toArtUnits, upsampleNearest } from "./pixelScale.js";

/**
 * Default occlusion-map parameters. Mirrors the CLI defaults so both share one
 * source of truth (the web UI keeps its own prettier blur/bright defaults in
 * controls.js). Distance mode defaults ON — the common path.
 *
 * `pixelSize` > 1: blur/distance run at logical (art) resolution — see
 * shared/pixelScale.js.
 */
export const DEFAULT_OCCLUSION_PARAMS = {
  occlusionThresh: 1,
  occlusionContrast: 1,
  occlusionBright: 16,
  occlusionBlur: 3,
  occlusionDistanceMode: true,
  occlusionDistance: 10,
  occlusionInvert: false,
  useAlpha: false,
  pixelSize: 1,
};

// Circular "soft bevel" profile upstream uses for the distance-shaded occlusion
// (and the normal path): maps [0,255] → [0,255] along a quarter circle.
function circularProfile(v) {
  const t = v / 255 - 1;
  return Math.sqrt(1 - t * t) * 255;
}

/**
 * Generate a grayscale ambient-occlusion map from an RGBA source. In distance
 * mode (default) the grayscale is thresholded, run through a Euclidean distance
 * transform, scaled by 255/occlusionDistance, and shaped by the circular
 * profile; flat mode skips that and operates on the raw grayscale. Either way
 * the result then gets contrast (pivoted at occlusionThresh) + brightness,
 * clamp, and a Gaussian blur of sigma=occlusionBlur. Returns a plain
 * { width, height, data: Uint8ClampedArray } record (8-bit RGBA, R=G=B=AO).
 * `heightSource` defaults to `source`; alpha always comes from `source`.
 */
export function generateOcclusionMap(source, p, heightSource = source) {
  const scale = normalizePixelSize(p?.pixelSize);
  if (scale > 1) {
    const lowSrc = downsampleRgba(source, scale);
    const lowHeight = heightSource === source ? lowSrc : downsampleRgba(heightSource, scale);
    const out = generateOcclusionMap(
      lowSrc,
      {
        ...p,
        pixelSize: 1,
        occlusionBlur: toArtUnits(p.occlusionBlur, scale),
        occlusionDistance: toArtUnits(p.occlusionDistance, scale),
      },
      lowHeight,
    );
    return upsampleNearest(out, source.width, source.height, scale);
  }

  const width = source.width;
  const height = source.height;
  const n = width * height;
  const occ = grayscaleFromRgba(heightSource);

  if (p.occlusionInvert) {
    for (let i = 0; i < n; i += 1) {
      occ[i] = 255 - occ[i];
    }
  }

  if (p.occlusionDistanceMode) {
    const inf = 1e20;
    const mask = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      // Strict > matches CImg threshold(t); see JS_CORE_MIGRATION.md §5.4.
      mask[i] = occ[i] > p.occlusionThresh ? inf : 0;
    }

    let dist;
    if (p.occlusionDistance !== 0) {
      dist = distanceTransform(mask, width, height);
      const scale = 255 / p.occlusionDistance;
      for (let i = 0; i < n; i += 1) {
        dist[i] *= scale;
      }
    } else {
      // Distance 0 skips the EDT: the thresholded mask (0/1) is shaped directly.
      dist = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        dist[i] = mask[i] === 0 ? 0 : 1;
      }
    }

    for (let i = 0; i < n; i += 1) {
      let d = dist[i];
      d = d < 0 ? 0 : d > 255 ? 255 : d;
      occ[i] = circularProfile(d);
    }
  }

  const contrast = p.occlusionContrast;
  const pivot = p.occlusionThresh * (1 - contrast);
  for (let i = 0; i < n; i += 1) {
    let v = contrast * occ[i] + pivot + p.occlusionBright;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    occ[i] = v;
  }

  // gaussianBlur takes a radius and derives sigma = radius/3; upstream passes
  // occlusionBlur directly as sigma, so multiply by 3 to match. See
  // JS_CORE_MIGRATION.md §5.1.
  const blurred = p.occlusionBlur > 0 ? gaussianBlur(occ, width, height, 3 * p.occlusionBlur) : occ;

  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0, px = 0; i < n; i += 1, px += 4) {
    const v = blurred[i] < 0 ? 0 : blurred[i] > 255 ? 255 : blurred[i];
    data[px] = v;
    data[px + 1] = v;
    data[px + 2] = v;
    data[px + 3] = p.useAlpha ? source.data[px + 3] : 255;
  }

  return { width, height, data };
}
