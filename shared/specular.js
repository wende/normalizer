/*
 * Specular-map generation — derived from Laigter's GPL-3.0 image processing
 * logic (laigter/src/image_processor.cpp:729, modify_specular).
 *
 * Pure functions over plain { width, height, data } records — no DOM, no Node
 * APIs. generateSpecularMap returns a plain record; the browser wraps it in
 * ImageData at the boundary, the CLI writes it via pngjs.
 */

import { grayscaleFromRgba } from "./image.js";
import { gaussianBlur } from "./primitives.js";
import { downsampleRgba, normalizePixelSize, toArtUnits, upsampleNearest } from "./pixelScale.js";

/**
 * Default specular-map parameters. Mirrors the CLI defaults so both share one
 * source of truth (the web UI keeps its own prettier blur default in controls.js).
 *
 * `pixelSize` > 1: blur runs at logical (art) resolution — see shared/pixelScale.js.
 */
export const DEFAULT_SPECULAR_PARAMS = {
  specularThresh: 127,
  specularContrast: 1,
  specularBright: 0,
  specularBlur: 3,
  specularInvert: false,
  useAlpha: false,
  pixelSize: 1,
};

/**
 * Generate a grayscale specular reflectivity map from an RGBA source. Per-pixel
 * contrast (pivoted at specularThresh — NOT 0-centered) + brightness, clamped,
 * then a Gaussian blur of sigma=specularBlur, then an optional invert. Returns
 * a plain { width, height, data: Uint8ClampedArray } record (8-bit RGBA,
 * R=G=B=reflectivity). `specularBase` defaults to `source`; the alpha channel
 * always comes from `source`.
 */
export function generateSpecularMap(source, p, specularBase = source) {
  const scale = normalizePixelSize(p?.pixelSize);
  if (scale > 1) {
    const lowSrc = downsampleRgba(source, scale);
    const lowBase = specularBase === source ? lowSrc : downsampleRgba(specularBase, scale);
    const out = generateSpecularMap(
      lowSrc,
      {
        ...p,
        pixelSize: 1,
        specularBlur: toArtUnits(p.specularBlur, scale),
      },
      lowBase,
    );
    return upsampleNearest(out, source.width, source.height, scale);
  }

  const width = source.width;
  const height = source.height;
  // Intentional divergence from upstream: Laigter converts SpecularBase via
  // QImage::Format_Grayscale8, which keeps RGB luminance and ignores alpha, so a
  // transparent-but-colored pixel reads as its luminance. grayscaleFromRgba
  // instead zeros fully-transparent pixels (→ 0 reflectivity). We prefer the
  // latter (transparent regions shouldn't reflect) per the self-regression
  // direction in docs/NORMALIZER_FEATURES.md — do not "restore parity" here.
  const gray = grayscaleFromRgba(specularBase);
  const contrast = p.specularContrast;
  const pivot = p.specularThresh * (1 - contrast);

  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    let v = contrast * gray[i] + pivot;
    v += p.specularBright;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    out[i] = v;
  }

  // gaussianBlur takes a radius and derives sigma = radius/3; upstream passes
  // specularBlur directly as sigma, so multiply by 3 to match. See
  // docs/JS_CORE_MIGRATION.md §5.1.
  const blurred = p.specularBlur > 0 ? gaussianBlur(out, width, height, 3 * p.specularBlur) : out;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, px = 0; i < blurred.length; i += 1, px += 4) {
    let v = blurred[i];
    if (p.specularInvert) v = 255 - v;
    const c = v < 0 ? 0 : v > 255 ? 255 : v;
    data[px] = c;
    data[px + 1] = c;
    data[px + 2] = c;
    data[px + 3] = p.useAlpha ? source.data[px + 3] : 255;
  }

  return { width, height, data };
}
