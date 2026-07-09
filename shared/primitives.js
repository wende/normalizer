// Image-processing primitives shared by the map generators.
//
// Pure functions over typed arrays / plain { width, height, data } records —
// no DOM, no Node APIs. These are the JS equivalents of the CImg operations
// the upstream generators use (see JS_CORE_MIGRATION.md §3).

import { rgbaOffset } from "./image.js";

/**
 * Felzenszwalb–Huttenlocher 1D squared-distance transform of f (length n).
 * Returns a Float32Array of squared distances. This is the same algorithm
 * CImg's .distance(0) reduces to per axis.
 */
export function edt1d(f, n) {
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q += 1) {
    let s = 0;
    do {
      const vk = v[k];
      s = ((f[q] + q * q) - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
      if (s <= z[k]) {
        k -= 1;
      }
    } while (s <= z[k]);
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) {
      k += 1;
    }
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }

  return d;
}

/**
 * Two-pass Euclidean distance transform of a 0/+inf grid (the Felzenszwalb
 * per-axis pass applied along columns then rows, with the final sqrt). `mask`
 * is a Float32Array of length width*height seeded with 0 at background pixels
 * and a large value (e.g. 1e20) at object pixels; the result is the Euclidean
 * distance from each pixel to the nearest background pixel. The same operation
 * CImg's .distance(0) performs.
 */
export function distanceTransform(mask, width, height) {
  const temp = new Float32Array(width * height);
  const column = new Float32Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      column[y] = mask[y * width + x];
    }
    const d = edt1d(column, height);
    for (let y = 0; y < height; y += 1) {
      temp[y * width + x] = d[y];
    }
  }

  const out = new Float32Array(width * height);
  const row = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      row[x] = temp[y * width + x];
    }
    const d = edt1d(row, width);
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.sqrt(d[x]);
    }
  }

  return out;
}

/**
 * Two-pass Euclidean distance transform of an RGBA image's alpha mask. Interior
 * opaque pixels are seeded with +inf, edges/transparent pixels with 0. Returns
 * a Float32Array (width*height) of Euclidean distances (sqrt applied).
 */
export function alphaDistance(image) {
  const width = image.width;
  const height = image.height;
  const inf = 1e20;
  const grid = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const a = image.data[rgbaOffset(width, x, y) + 3];
      grid[i] = a > 0 && x > 0 && y > 0 && x < width - 1 && y < height - 1 ? inf : 0;
    }
  }

  return distanceTransform(grid, width, height);
}

/**
 * Separable finite-kernel Gaussian blur of a single-channel Float32Array.
 * sigma = radius / 3, truncated at 3*sigma. A radius yielding sigma <= 0.01
 * returns a copy unchanged. (Diverges slightly from CImg's recursive IIR blur
 * near borders / large sigma — see JS_CORE_MIGRATION.md §5.1.)
 */
export function gaussianBlur(input, width, height, radius) {
  const sigma = radius / 3;
  if (sigma <= 0.01) {
    return new Float32Array(input);
  }

  const kernelRadius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(kernelRadius * 2 + 1);
  let total = 0;
  for (let i = -kernelRadius; i <= kernelRadius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + kernelRadius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= total;
  }

  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        sum += input[y * width + sx] * kernel[k + kernelRadius];
      }
      temp[y * width + x] = sum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        sum += temp[sy * width + x] * kernel[k + kernelRadius];
      }
      out[y * width + x] = sum;
    }
  }

  return out;
}

/** Hermite smoothstep; clamps t to [0, 1] over [edge0, edge1]. */
export function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
