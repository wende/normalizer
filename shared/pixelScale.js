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
 * Convert a screen-pixel spatial radius/distance into art-pixel units for
 * processing at logical resolution. Soft=6 with pixelSize=4 → art radius 1.5,
 * so screen-space softness stays comparable instead of exploding with scale.
 */
export function toArtUnits(screenValue, pixelSize) {
  const s = normalizePixelSize(pixelSize);
  const v = Number(screenValue);
  if (!Number.isFinite(v)) return 0;
  if (s <= 1) return v;
  return v / s;
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

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function pixelsEqual(data, a, b, tolerance) {
  return (
    Math.abs(data[a] - data[b]) <= tolerance &&
    Math.abs(data[a + 1] - data[b + 1]) <= tolerance &&
    Math.abs(data[a + 2] - data[b + 2]) <= tolerance &&
    Math.abs(data[a + 3] - data[b + 3]) <= tolerance
  );
}

/**
 * True when every pixelSize×pixelSize block is uniform within `tolerance`
 * (max channel delta from the block's top-left pixel). Remainder strips when
 * width/height are not divisible by pixelSize are ignored.
 */
export function blocksAreUniform(source, pixelSize, tolerance = 0) {
  const s = normalizePixelSize(pixelSize);
  if (s <= 1) return true;
  const { width: W, height: H, data } = source;
  const tol = Math.max(0, tolerance);
  const wBlocks = Math.floor(W / s);
  const hBlocks = Math.floor(H / s);
  if (wBlocks < 1 || hBlocks < 1) return false;

  for (let by = 0; by < hBlocks; by += 1) {
    for (let bx = 0; bx < wBlocks; bx += 1) {
      const x0 = bx * s;
      const y0 = by * s;
      const base = (y0 * W + x0) * 4;
      for (let yy = y0; yy < y0 + s; yy += 1) {
        for (let xx = x0; xx < x0 + s; xx += 1) {
          if (!pixelsEqual(data, base, (yy * W + xx) * 4, tol)) return false;
        }
      }
    }
  }
  return true;
}

/**
 * Detect the art-pixel block size of a nearest-neighbour upscaled image.
 *
 * Primary signal: GCD of horizontal/vertical solid-color run lengths (ignoring
 * solid full-span rows/cols). That GCD is the smallest repeating unit — e.g.
 * runs of 4 and 8 → pixel size 4. If a crop pollutes the GCD to 1, fall back to
 * the largest scale whose N×N blocks are uniform. Returns 1 for photos /
 * already-1× pixel art / solid fills. `tolerance` allows minor encoder noise.
 */
export function detectPixelSize(source, { maxSize = 64, tolerance = 0 } = {}) {
  const { width: W, height: H, data } = source;
  if (W < 2 || H < 2) return 1;
  const tol = Math.max(0, tolerance);
  let g = 0;

  scan: {
    for (let y = 0; y < H; y += 1) {
      let x = 0;
      while (x < W) {
        const start = x;
        const base = (y * W + x) * 4;
        x += 1;
        while (x < W && pixelsEqual(data, base, (y * W + x) * 4, tol)) x += 1;
        const run = x - start;
        // Solid rows don't constrain the grid (would bias toward image width).
        if (run < W) {
          g = g === 0 ? run : gcd(g, run);
          if (g === 1) break scan;
        }
      }
    }

    for (let x = 0; x < W; x += 1) {
      let y = 0;
      while (y < H) {
        const start = y;
        const base = (y * W + x) * 4;
        y += 1;
        while (y < H && pixelsEqual(data, base, (y * W + x) * 4, tol)) y += 1;
        const run = y - start;
        if (run < H) {
          g = g === 0 ? run : gcd(g, run);
          if (g === 1) break scan;
        }
      }
    }
  }

  if (g === 0) {
    // No interior color changes (solid fill / single-color rows) — not an
    // upscaled sprite; every block size would look "uniform".
    return 1;
  }

  if (g > 1) {
    const limited = Math.min(g, maxSize, W, H);
    if (blocksAreUniform(source, limited, tol)) return limited;
  }

  // Fallback when runs disagree (cropped edge, encoder noise): largest N whose
  // complete N×N blocks are uniform.
  let best = 1;
  const limit = Math.min(maxSize, W, H);
  for (let s = 2; s <= limit; s += 1) {
    if (blocksAreUniform(source, s, tol)) best = s;
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

function clampNormal8(v) {
  let i = (v * 255) | 0;
  if (i < 0) i = 0;
  else if (i > 255) i = 255;
  return i;
}

/**
 * Post-process a tangent-space normal map so each pixelSize×pixelSize block
 * shares one unit normal (average decoded XYZ, renormalize, fill). Needed for
 * AI / already-generated normals that never ran through generateNormalMap's
 * art-scale path. pixelSize <= 1 returns a copy of the input record.
 */
export function pixelateNormalMap(normal, pixelSize) {
  const s = normalizePixelSize(pixelSize);
  const { width, height, data } = normal;
  if (s <= 1) {
    return {
      width,
      height,
      data: data instanceof Uint8ClampedArray
        ? new Uint8ClampedArray(data)
        : new Uint8ClampedArray(data),
    };
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const wBlocks = Math.ceil(width / s);
  const hBlocks = Math.ceil(height / s);

  for (let by = 0; by < hBlocks; by += 1) {
    for (let bx = 0; bx < wBlocks; bx += 1) {
      const x0 = bx * s;
      const y0 = by * s;
      const x1 = Math.min(width, x0 + s);
      const y1 = Math.min(height, y0 + s);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = (y * width + x) * 4;
          sx += data[p] / 127.5 - 1;
          sy += data[p + 1] / 127.5 - 1;
          sz += data[p + 2] / 127.5 - 1;
          n += 1;
        }
      }
      let nx = sx / n;
      let ny = sy / n;
      let nz = sz / n;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const r = clampNormal8(nx * 0.5 + 0.5);
      const g = clampNormal8(ny * 0.5 + 0.5);
      const b = clampNormal8(nz * 0.5 + 0.5);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = (y * width + x) * 4;
          out[p] = r;
          out[p + 1] = g;
          out[p + 2] = b;
          out[p + 3] = data[p + 3];
        }
      }
    }
  }

  return { width, height, data: out };
}
