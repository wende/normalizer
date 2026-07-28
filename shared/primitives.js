// Image-processing primitives shared by the map generators.
//
// Pure functions over typed arrays / plain { width, height, data } records —
// no DOM, no Node APIs. These are the JS equivalents of the CImg operations
// the upstream generators use (see docs/JS_CORE_MIGRATION.md §3).

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
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
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

  const temp = new Float32Array(width * height);
  const column = new Float32Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      column[y] = grid[y * width + x];
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
 * Separable finite-kernel Gaussian blur of a single-channel Float32Array.
 * sigma = radius / 3, truncated at 3*sigma. A radius yielding sigma <= 0.01
 * returns a copy unchanged. (Diverges slightly from CImg's recursive IIR blur
 * near borders / large sigma — see docs/JS_CORE_MIGRATION.md §5.1.)
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

/**
 * Separable 1D morphological filter (van Herk / Gil–Werman), O(1)/px for a
 * window of radius r. `op` is Math.max (dilate) or Math.min (erode). Borders
 * are replicate-padded. Returns a new Float32Array of length L.
 *
 * Block-aligned forward (fwd) and backward (bwd) running op: any radius-r
 * window [i, i+2r] is covered by bwd[i] (i→block end) ∪ fwd[i+2r] (block
 * start→i+2r). See docs/JS_CORE_MIGRATION.md §5.3.
 */
function morph1D(src, L, r, op) {
  if (r <= 0) return new Float32Array(src);
  const w = 2 * r + 1;
  const N = L + 2 * r;
  const pad = new Float32Array(N);
  for (let i = 0; i < r; i += 1) pad[i] = src[0];
  pad.set(src, r);
  for (let i = 0; i < r; i += 1) pad[L + r + i] = src[L - 1];

  const fwd = new Float32Array(N);
  const bwd = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    fwd[i] = i % w === 0 ? pad[i] : op(fwd[i - 1], pad[i]);
  }
  for (let i = N - 1; i >= 0; i -= 1) {
    // The trailing block is partial when N is not a multiple of w; reset there too.
    bwd[i] = i === N - 1 || (i + 1) % w === 0 ? pad[i] : op(bwd[i + 1], pad[i]);
  }

  const out = new Float32Array(L);
  for (let i = 0; i < L; i += 1) {
    out[i] = op(bwd[i], fwd[i + 2 * r]);
  }
  return out;
}

/**
 * Separable n×n morphological filter along both axes. `n` is the full element
 * width; n ≤ 1 is a no-op (returns a copy). CImg counts the size the same way,
 * so dilate(buf,w,h,1) is identity. `op` is Math.max or Math.min.
 */
function morph(buf, w, h, n, op) {
  if (n <= 1) return new Float32Array(buf);
  const r = n >> 1;
  const tmp = new Float32Array(w * h);
  const row = new Float32Array(w);
  for (let y = 0; y < h; y += 1) {
    const base = y * w;
    for (let x = 0; x < w; x += 1) row[x] = buf[base + x];
    const filtered = morph1D(row, w, r, op);
    for (let x = 0; x < w; x += 1) tmp[base + x] = filtered[x];
  }
  const out = new Float32Array(w * h);
  const col = new Float32Array(h);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) col[y] = tmp[y * w + x];
    const filtered = morph1D(col, h, r, op);
    for (let y = 0; y < h; y += 1) out[y * w + x] = filtered[y];
  }
  return out;
}

/** n×n rectangular dilation (max filter); n ≤ 1 is a no-op. */
export function dilate(buf, w, h, n) {
  return morph(buf, w, h, n, Math.max);
}

/** n×n rectangular erosion (min filter); n ≤ 1 is a no-op. */
export function erode(buf, w, h, n) {
  return morph(buf, w, h, n, Math.min);
}
