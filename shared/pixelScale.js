// Pixel-art scale helpers — process maps at logical (art) resolution when the
// source is nearest-neighbour upscaled (N×N identical blocks pretending to be
// one big pixel). Soft/blur/distance then operate in art pixels, and the result
// is nearest-upsampled back so facets stay blocky.
//
// Pure functions over plain { width, height, data } records — no DOM, no Node.

/**
 * Clamp/round a pixel-size control to a usable integer (>= 1).
 */
export function normalizePixelSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/**
 * Downsample an RGBA image by averaging each pixelSize×pixelSize block into one
 * logical pixel. Truncates any remainder strip when width/height are not
 * divisible by pixelSize (those edge pixels are filled from the last logical
 * sample on upsample).
 */
export function downsampleRgba(source, pixelSize) {
  const s = normalizePixelSize(pixelSize);
  if (s <= 1) {
    return {
      width: source.width,
      height: source.height,
      data: source.data instanceof Uint8ClampedArray
        ? new Uint8ClampedArray(source.data)
        : new Uint8ClampedArray(source.data),
    };
  }

  const { width: W, height: H, data } = source;
  const w = Math.max(1, Math.floor(W / s));
  const h = Math.max(1, Math.floor(H / s));
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const x0 = x * s;
      const y0 = y * s;
      const x1 = Math.min(W, x0 + s);
      const y1 = Math.min(H, y0 + s);
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const p = (yy * W + xx) * 4;
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          a += data[p + 3];
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }

  return { width: w, height: h, data: out };
}

/**
 * Downsample a single-channel Float32 buffer the same way as downsampleRgba
 * (block average). Used when an optional height/bevel buffer is passed alongside
 * a pixel-scaled source.
 */
export function downsampleFloat(input, width, height, pixelSize) {
  const s = normalizePixelSize(pixelSize);
  if (s <= 1) return new Float32Array(input);

  const w = Math.max(1, Math.floor(width / s));
  const h = Math.max(1, Math.floor(height / s));
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      const x0 = x * s;
      const y0 = y * s;
      const x1 = Math.min(width, x0 + s);
      const y1 = Math.min(height, y0 + s);
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          sum += input[yy * width + xx];
          n += 1;
        }
      }
      out[y * w + x] = sum / n;
    }
  }

  return out;
}

/**
 * Nearest-neighbour upsample an RGBA map so each logical pixel becomes a
 * pixelSize×pixelSize block (clamped for remainder strips).
 */
export function upsampleNearest(map, targetWidth, targetHeight, pixelSize) {
  const s = normalizePixelSize(pixelSize);
  const { width: w, height: h, data } = map;
  if (s <= 1 && w === targetWidth && h === targetHeight) {
    return {
      width: targetWidth,
      height: targetHeight,
      data: data instanceof Uint8ClampedArray ? new Uint8ClampedArray(data) : new Uint8ClampedArray(data),
    };
  }

  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(h - 1, Math.floor(y / s));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(w - 1, Math.floor(x / s));
      const si = (sy * w + sx) * 4;
      const oi = (y * targetWidth + x) * 4;
      out[oi] = data[si];
      out[oi + 1] = data[si + 1];
      out[oi + 2] = data[si + 2];
      out[oi + 3] = data[si + 3];
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}

/**
 * True when every pixelSize×pixelSize block is uniform within `tolerance`
 * (max channel delta from the block's top-left pixel).
 */
export function blocksAreUniform(source, pixelSize, tolerance = 0) {
  const s = normalizePixelSize(pixelSize);
  if (s <= 1) return true;
  const { width: W, height: H, data } = source;
  if (W % s !== 0 || H % s !== 0) return false;
  const tol = Math.max(0, tolerance);

  for (let y0 = 0; y0 < H; y0 += s) {
    for (let x0 = 0; x0 < W; x0 += s) {
      const base = (y0 * W + x0) * 4;
      const br = data[base];
      const bg = data[base + 1];
      const bb = data[base + 2];
      const ba = data[base + 3];
      for (let yy = y0; yy < y0 + s; yy += 1) {
        for (let xx = x0; xx < x0 + s; xx += 1) {
          const p = (yy * W + xx) * 4;
          if (
            Math.abs(data[p] - br) > tol ||
            Math.abs(data[p + 1] - bg) > tol ||
            Math.abs(data[p + 2] - bb) > tol ||
            Math.abs(data[p + 3] - ba) > tol
          ) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

/**
 * Detect the largest integer pixel size where the image divides evenly into
 * uniform blocks (classic nearest-neighbour upscale). Returns 1 when no larger
 * scale fits. `tolerance` allows minor encoder noise inside a block.
 */
export function detectPixelSize(source, { maxSize = 64, tolerance = 0 } = {}) {
  const { width: W, height: H } = source;
  const limit = Math.min(maxSize, W, H);
  let best = 1;
  for (let s = 2; s <= limit; s += 1) {
    if (W % s !== 0 || H % s !== 0) continue;
    if (blocksAreUniform(source, s, tolerance)) best = s;
  }
  return best;
}

/**
 * Run `generate(lowResSource)` at logical resolution when pixelSize > 1, then
 * nearest-upsample back to the original dimensions. Soft/blur radii and
 * distance knobs then mean art-pixels instead of screen-pixels.
 */
export function atPixelScale(source, pixelSize, generate) {
  const s = normalizePixelSize(pixelSize);
  if (s <= 1) return generate(source);
  const low = downsampleRgba(source, s);
  const result = generate(low);
  return upsampleNearest(result, source.width, source.height, s);
}
