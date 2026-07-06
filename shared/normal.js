/*
 * Normal-map generation — derived from Laigter's GPL-3.0 image processing logic
 * (laigter/src/image_processor.cpp) and core/src/laigter_core.cpp.
 *
 * Pure functions over plain { width, height, data } records — no DOM, no Node
 * APIs. generateNormalMap returns a plain record; the browser wraps it in
 * ImageData at the boundary, the CLI writes it via pngjs.
 */

import { grayscaleFromRgba } from "./image.js";
import { alphaDistance, gaussianBlur } from "./primitives.js";

/**
 * Default normal-map parameters. Mirrors core/include/laigter_core.h so the CLI
 * and the browser share one source of truth.
 */
export const DEFAULT_NORMAL_PARAMS = {
  normalDepth: 250,
  normalBlurRadius: 6,
  biselDepth: 100,
  biselDistance: 60,
  biselBlurRadius: 10,
  softBisel: true,
  invertX: false,
  invertY: false,
  invertZ: false,
  useAlpha: false,
};

/**
 * Compute a signed tangent-space normal field (3 floats/px) from a height
 * buffer via central differences, with 2nd-order one-sided stencils at borders.
 * The height buffer is blurred first; transparent pixels emit (0, 0, 1).
 */
export function calculateNormal(height, alpha, width, heightPx, depth, blurRadius, p) {
  const img = gaussianBlur(height, width, heightPx, blurRadius);
  const out = new Float32Array(width * heightPx * 3);
  const scale = depth / 100;
  const invertX = p.invertX ? -1 : 1;
  const invertY = p.invertY ? -1 : 1;
  const sample = (x, y) => img[Math.max(0, Math.min(heightPx - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const oi = i * 3;
      if (alpha[i] === 0) {
        out[oi] = 0;
        out[oi + 1] = 0;
        out[oi + 2] = 1;
        continue;
      }

      let dx = 0;
      if (x === 0) {
        dx = -3 * sample(x, y) + 4 * sample(x + 1, y) - sample(x + 2, y);
      } else if (x === width - 1) {
        dx = 3 * sample(x, y) - 4 * sample(x - 1, y) + sample(x - 2, y);
      } else {
        dx = -sample(x - 1, y) + sample(x + 1, y);
      }

      let dy = 0;
      if (y === 0) {
        dy = -3 * sample(x, y) + 4 * sample(x, y + 1) - sample(x, y + 2);
      } else if (y === heightPx - 1) {
        dy = 3 * sample(x, y) - 4 * sample(x, y - 1) + sample(x, y - 2);
      } else {
        dy = -sample(x, y - 1) + sample(x, y + 1);
      }

      out[oi] = -(dx / 255) * scale * invertX;
      out[oi + 1] = (dy / 255) * scale * invertY;
      out[oi + 2] = 1;
    }
  }

  return out;
}

/**
 * Generate a tangent-space normal map from an RGBA source as a weighted blend of
 * three normal fields: emboss (texture detail), bevel (silhouette bump from the
 * alpha distance transform), and a flat height-overlay field. Returns a plain
 * { width, height, data: Uint8ClampedArray } record (8-bit RGBA). Overlay
 * compositing (e.g. the AI normal blend) stays with the caller.
 */
export function generateNormalMap(source, p) {
  const width = source.width;
  const height = source.height;
  const gray = grayscaleFromRgba(source);
  const alpha = new Uint8Array(width * height);
  const embossHeight = new Float32Array(width * height);

  for (let i = 0, px = 0; i < alpha.length; i += 1, px += 4) {
    alpha[i] = source.data[px + 3] > 0 ? 1 : 0;
    embossHeight[i] = gray[i] * 10;
  }

  const distance = alphaDistance(source);
  const bevel = new Float32Array(width * height);
  for (let i = 0; i < bevel.length; i += 1) {
    let d = p.biselDistance !== 0 ? distance[i] * 255 / p.biselDistance : (distance[i] > 0.1 ? 255 : 0);
    d = Math.max(0, Math.min(255, d));
    if (p.softBisel) {
      d = Math.sqrt(1 - (d / 255 - 1) ** 2) * 255;
    }
    bevel[i] = d;
  }

  const zeroHeight = new Float32Array(width * height);
  const emboss = calculateNormal(embossHeight, alpha, width, height, p.normalDepth, p.normalBlurRadius, p);
  const bump = calculateNormal(bevel, alpha, width, height, p.biselDepth * p.biselDistance, p.biselBlurRadius, p);
  const heightOverlay = calculateNormal(zeroHeight, alpha, width, height, 5000, 0, p);
  const data = new Uint8ClampedArray(width * height * 4);
  const invertZ = p.invertZ ? -1 : 1;

  for (let i = 0, px = 0, ni = 0; i < alpha.length; i += 1, px += 4, ni += 3) {
    const nr = emboss[ni] * 1.5 + bump[ni] * 1.5 + heightOverlay[ni];
    const ng = emboss[ni + 1] * 1.5 + bump[ni + 1] * 1.5 + heightOverlay[ni + 1];
    const nb = (emboss[ni + 2] * 1.5 + bump[ni + 2] * 1.5 + heightOverlay[ni + 2]) * invertZ;
    const len = Math.hypot(nr, ng, nb) || 1;
    data[px] = Math.max(0, Math.min(255, 255 * (nr / len * 0.5 + 0.5))) | 0;
    data[px + 1] = Math.max(0, Math.min(255, 255 * (ng / len * 0.5 + 0.5))) | 0;
    data[px + 2] = Math.max(0, Math.min(255, 255 * (nb / len * 0.5 + 0.5))) | 0;
    data[px + 3] = p.useAlpha ? source.data[px + 3] : 255;
  }

  return { width, height, data };
}
