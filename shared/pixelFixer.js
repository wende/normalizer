/*
 * Pixel-fixer — recover a low-resolution sprite from AI “pseudo-pixel” art by
 * inferring a global square lattice and voting one colour per cell.
 *
 * Pure functions over plain { width, height, data } records — no DOM, no Node
 * APIs. Returns plain records; the browser wraps in ImageData at the boundary,
 * the CLI writes via pngjs.
 *
 * Strict-grid MVP only: one global pitch + offset. Warped lattices, outline
 * repair, and palette clustering are out of scope.
 */

import { grayscaleFromRgba, rgbaOffset } from "./image.js";

export const DEFAULT_PIXEL_FIXER_PARAMS = {
  minPitch: 4,
  maxPitch: 64,
  candidateCount: 3,
  alphaThreshold: 16,
  // Manual overrides: pitch > 0 skips auto-detect; offsetX/Y < 0 means auto.
  pitch: 0,
  offsetX: -1,
  offsetY: -1,
};

/**
 * Nearest-neighbour upscale of an RGBA image by an integer scale factor.
 */
export function upscaleNearest(image, scale) {
  const s = Math.max(1, Math.round(scale));
  const width = image.width * s;
  const height = image.height * s;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y / s);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x / s);
      const si = rgbaOffset(image.width, sx, sy);
      const di = rgbaOffset(width, x, y);
      data[di] = image.data[si];
      data[di + 1] = image.data[si + 1];
      data[di + 2] = image.data[si + 2];
      data[di + 3] = image.data[si + 3];
    }
  }
  return { width, height, data };
}

/**
 * Reconstruct one logical pixel per cell using channel-wise median of opaque
 * samples inside the cell. Empty / mostly-transparent cells stay transparent.
 */
export function reconstructPixelGrid(source, opts) {
  const pitch = Math.max(1, Math.round(opts.pitch));
  const offsetX = ((Math.round(opts.offsetX) % pitch) + pitch) % pitch;
  const offsetY = ((Math.round(opts.offsetY) % pitch) + pitch) % pitch;
  const alphaThreshold = opts.alphaThreshold ?? DEFAULT_PIXEL_FIXER_PARAMS.alphaThreshold;

  const cols = Math.floor((source.width - offsetX) / pitch);
  const rows = Math.floor((source.height - offsetY) / pitch);
  if (cols < 1 || rows < 1) {
    return {
      width: 0,
      height: 0,
      data: new Uint8ClampedArray(0),
      cols: 0,
      rows: 0,
      pitch,
      offsetX,
      offsetY,
    };
  }

  const data = new Uint8ClampedArray(cols * rows * 4);
  const cellArea = pitch * pitch;
  const rs = new Uint8Array(cellArea);
  const gs = new Uint8Array(cellArea);
  const bs = new Uint8Array(cellArea);
  const as = new Uint8Array(cellArea);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let n = 0;
      let opaque = 0;
      const x0 = offsetX + col * pitch;
      const y0 = offsetY + row * pitch;
      for (let dy = 0; dy < pitch; dy += 1) {
        for (let dx = 0; dx < pitch; dx += 1) {
          const si = rgbaOffset(source.width, x0 + dx, y0 + dy);
          const a = source.data[si + 3];
          rs[n] = source.data[si];
          gs[n] = source.data[si + 1];
          bs[n] = source.data[si + 2];
          as[n] = a;
          n += 1;
          if (a >= alphaThreshold) opaque += 1;
        }
      }

      const di = rgbaOffset(cols, col, row);
      if (opaque * 2 < cellArea) {
        data[di] = 0;
        data[di + 1] = 0;
        data[di + 2] = 0;
        data[di + 3] = 0;
        continue;
      }

      // Vote only on opaque samples for RGB; alpha uses the full cell median.
      const rgbCount = packOpaque(rs, gs, bs, as, n, alphaThreshold);
      data[di] = medianUint8(rs, rgbCount);
      data[di + 1] = medianUint8(gs, rgbCount);
      data[di + 2] = medianUint8(bs, rgbCount);
      data[di + 3] = medianUint8(as, n);
    }
  }

  return { width: cols, height: rows, data, cols, rows, pitch, offsetX, offsetY };
}

/**
 * Detect likely global square lattices and reconstruct the top candidates.
 * Returns { candidates: [{ pitch, offsetX, offsetY, cols, rows, score, sprite }] }
 * sorted by ascending score (lower is better).
 */
export function detectPixelGrid(source, params = {}) {
  const p = { ...DEFAULT_PIXEL_FIXER_PARAMS, ...params };
  const minPitch = Math.max(2, Math.round(p.minPitch));
  const maxPitch = Math.max(minPitch, Math.min(
    Math.round(p.maxPitch),
    Math.floor(Math.min(source.width, source.height) / 2),
  ));
  const candidateCount = Math.max(1, Math.round(p.candidateCount));
  const alphaThreshold = p.alphaThreshold;

  // Manual pitch: search offsets (or use fixed ones) and return one candidate.
  if (p.pitch > 0) {
    const pitch = Math.max(minPitch, Math.min(maxPitch, Math.round(p.pitch)));
    const fixed = scorePitch(source, pitch, alphaThreshold, p.offsetX, p.offsetY);
    return { candidates: fixed ? [fixed] : [] };
  }

  const pitches = findPitchCandidates(source, minPitch, maxPitch, Math.max(8, candidateCount * 3));
  const scored = [];
  const seen = new Set();

  for (const pitch of pitches) {
    const best = scorePitch(source, pitch, alphaThreshold, -1, -1);
    if (!best) continue;
    const key = `${best.pitch}:${best.offsetX}:${best.offsetY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push(best);
  }

  // Also try neighbour pitches around the best autocorrelation peaks in case
  // the true pitch sits between local maxima.
  for (const pitch of pitches.slice(0, 4)) {
    for (const delta of [-1, 1]) {
      const alt = pitch + delta;
      if (alt < minPitch || alt > maxPitch) continue;
      const best = scorePitch(source, alt, alphaThreshold, -1, -1);
      if (!best) continue;
      const key = `${best.pitch}:${best.offsetX}:${best.offsetY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push(best);
    }
  }

  scored.sort((a, b) => a.score - b.score);
  const filtered = suppressHarmonics(scored);
  return { candidates: filtered.slice(0, candidateCount) };
}

/**
 * Convenience entry used by the CLI: auto-detect (or manual override) and
 * return the best low-res sprite as a plain { width, height, data } record.
 */
export function fixPixels(source, params = {}) {
  const { candidates } = detectPixelGrid(source, params);
  if (!candidates.length) {
    return { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  }
  const best = candidates[0];
  return {
    width: best.sprite.width,
    height: best.sprite.height,
    data: best.sprite.data,
  };
}

// --- internals -------------------------------------------------------------

function packOpaque(rs, gs, bs, as, n, alphaThreshold) {
  let w = 0;
  for (let i = 0; i < n; i += 1) {
    if (as[i] < alphaThreshold) continue;
    rs[w] = rs[i];
    gs[w] = gs[i];
    bs[w] = bs[i];
    w += 1;
  }
  return w;
}

function medianUint8(values, count) {
  if (count <= 0) return 0;
  // Partial selection via copy + sort is fine at cell scale (≤ 64²).
  const slice = Array.from(values.subarray(0, count));
  slice.sort((a, b) => a - b);
  const mid = count >> 1;
  if (count & 1) return slice[mid];
  return (slice[mid - 1] + slice[mid]) >> 1;
}

function findPitchCandidates(source, minPitch, maxPitch, limit) {
  const gray = grayscaleFromRgba(source);
  const { width, height } = source;

  const colEnergy = new Float64Array(width);
  const rowEnergy = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x + 1 < width) {
        const dx = Math.abs(gray[i + 1] - gray[i]);
        colEnergy[x] += dx;
      }
      if (y + 1 < height) {
        const dy = Math.abs(gray[i + width] - gray[i]);
        rowEnergy[y] += dy;
      }
    }
  }

  const colAc = autocorrelation(colEnergy, minPitch, maxPitch);
  const rowAc = autocorrelation(rowEnergy, minPitch, maxPitch);
  // Combine axes so square pitches that appear on both rise to the top.
  const combined = new Float64Array(maxPitch + 1);
  for (let lag = minPitch; lag <= maxPitch; lag += 1) {
    combined[lag] = colAc[lag] * rowAc[lag];
  }

  const peaks = localMaxima(combined, minPitch, maxPitch);
  peaks.sort((a, b) => b.score - a.score);

  const out = [];
  const used = new Set();
  for (const peak of peaks) {
    if (used.has(peak.lag)) continue;
    used.add(peak.lag);
    out.push(peak.lag);
    if (out.length >= limit) break;
  }

  // Guarantee a dense fallback scan of common pitches if edges are weak.
  if (out.length < 3) {
    for (let lag = minPitch; lag <= Math.min(maxPitch, 32); lag += 1) {
      if (used.has(lag)) continue;
      used.add(lag);
      out.push(lag);
      if (out.length >= limit) break;
    }
  }

  return out;
}

function autocorrelation(signal, minLag, maxLag) {
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const centered = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    centered[i] = signal[i] - mean;
    energy += centered[i] * centered[i];
  }
  const out = new Float64Array(maxLag + 1);
  if (energy < 1e-9) return out;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i += 1) {
      sum += centered[i] * centered[i + lag];
    }
    out[lag] = sum / energy;
  }
  return out;
}

function localMaxima(scores, minLag, maxLag) {
  const peaks = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const prev = lag > minLag ? scores[lag - 1] : -Infinity;
    const next = lag < maxLag ? scores[lag + 1] : -Infinity;
    const v = scores[lag];
    if (v >= prev && v >= next && v > 0) {
      peaks.push({ lag, score: v });
    }
  }
  // If no clear peaks, fall back to global ranking of all lags.
  if (!peaks.length) {
    for (let lag = minPitchSafe(minLag); lag <= maxLag; lag += 1) {
      peaks.push({ lag, score: scores[lag] });
    }
  }
  return peaks;
}

function minPitchSafe(minLag) {
  return minLag;
}

function suppressHarmonics(scored) {
  // Drop smaller pitches that evenly divide a better (already-kept) pitch when
  // both have near-zero variance — they are the same lattice subdivided.
  const kept = [];
  for (const cand of scored) {
    const dominated = kept.some((better) => {
      if (better.pitch <= cand.pitch) return false;
      if (better.pitch % cand.pitch !== 0) return false;
      return better.variance < 1 && cand.variance < 1;
    });
    if (!dominated) kept.push(cand);
  }
  return kept;
}

/**
 * Find best offsets for a pitch (or use fixed ones) and return a scored
 * candidate with a median-reconstructed sprite.
 */
function scorePitch(source, pitch, alphaThreshold, fixedOx, fixedOy) {
  const cols = Math.floor(source.width / pitch);
  const rows = Math.floor(source.height / pitch);
  if (cols < 2 || rows < 2) return null;

  let bestOx = 0;
  let bestOy = 0;
  let bestVar = Infinity;

  if (fixedOx >= 0 && fixedOy >= 0) {
    bestOx = fixedOx % pitch;
    bestOy = fixedOy % pitch;
    bestVar = gridVariance(source, pitch, bestOx, bestOy, alphaThreshold);
  } else {
    // Coarse then refine: step-2 sweep, then ±1 neighbourhood around the winner.
    const coarseStep = pitch > 8 ? 2 : 1;
    for (let oy = 0; oy < pitch; oy += coarseStep) {
      for (let ox = 0; ox < pitch; ox += coarseStep) {
        const v = gridVariance(source, pitch, ox, oy, alphaThreshold);
        if (v < bestVar) {
          bestVar = v;
          bestOx = ox;
          bestOy = oy;
        }
      }
    }
    if (coarseStep > 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const ox = (((bestOx + dx) % pitch) + pitch) % pitch;
          const oy = (((bestOy + dy) % pitch) + pitch) % pitch;
          const v = gridVariance(source, pitch, ox, oy, alphaThreshold);
          if (v < bestVar) {
            bestVar = v;
            bestOx = ox;
            bestOy = oy;
          }
        }
      }
    }
  }

  const sprite = reconstructPixelGrid(source, {
    pitch,
    offsetX: bestOx,
    offsetY: bestOy,
    alphaThreshold,
  });
  if (sprite.cols < 1 || sprite.rows < 1) return null;

  const reconError = reconstructionError(source, sprite, pitch, bestOx, bestOy, alphaThreshold);
  const sizePrior = sizePenalty(sprite.cols, sprite.rows, source.width, source.height, pitch);
  // Prefer larger pitches when variance is similar — pitch/2 harmonics of a
  // true lattice also have near-zero within-cell variance.
  const pitchBias = pitch * pitch;
  const score = (bestVar + reconError * 0.5) / pitchBias + sizePrior;

  return {
    pitch,
    offsetX: bestOx,
    offsetY: bestOy,
    cols: sprite.cols,
    rows: sprite.rows,
    score,
    variance: bestVar,
    reconError,
    sprite,
  };
}

function gridVariance(source, pitch, offsetX, offsetY, alphaThreshold) {
  const cols = Math.floor((source.width - offsetX) / pitch);
  const rows = Math.floor((source.height - offsetY) / pitch);
  if (cols < 1 || rows < 1) return Infinity;

  let totalVar = 0;
  let cells = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = offsetX + col * pitch;
      const y0 = offsetY + row * pitch;
      let n = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumR2 = 0;
      let sumG2 = 0;
      let sumB2 = 0;

      for (let dy = 0; dy < pitch; dy += 1) {
        for (let dx = 0; dx < pitch; dx += 1) {
          const si = rgbaOffset(source.width, x0 + dx, y0 + dy);
          if (source.data[si + 3] < alphaThreshold) continue;
          const r = source.data[si];
          const g = source.data[si + 1];
          const b = source.data[si + 2];
          sumR += r;
          sumG += g;
          sumB += b;
          sumR2 += r * r;
          sumG2 += g * g;
          sumB2 += b * b;
          n += 1;
        }
      }
      if (n < 2) continue;
      const inv = 1 / n;
      const vr = sumR2 * inv - (sumR * inv) * (sumR * inv);
      const vg = sumG2 * inv - (sumG * inv) * (sumG * inv);
      const vb = sumB2 * inv - (sumB * inv) * (sumB * inv);
      totalVar += vr + vg + vb;
      cells += 1;
    }
  }

  return cells ? totalVar / cells : Infinity;
}

function reconstructionError(source, sprite, pitch, offsetX, offsetY, alphaThreshold) {
  let err = 0;
  let count = 0;
  for (let row = 0; row < sprite.rows; row += 1) {
    for (let col = 0; col < sprite.cols; col += 1) {
      const ci = rgbaOffset(sprite.cols, col, row);
      const cr = sprite.data[ci];
      const cg = sprite.data[ci + 1];
      const cb = sprite.data[ci + 2];
      const ca = sprite.data[ci + 3];
      const x0 = offsetX + col * pitch;
      const y0 = offsetY + row * pitch;
      for (let dy = 0; dy < pitch; dy += 1) {
        for (let dx = 0; dx < pitch; dx += 1) {
          const si = rgbaOffset(source.width, x0 + dx, y0 + dy);
          const sa = source.data[si + 3];
          if (sa < alphaThreshold && ca < alphaThreshold) continue;
          err += Math.abs(source.data[si] - cr)
            + Math.abs(source.data[si + 1] - cg)
            + Math.abs(source.data[si + 2] - cb)
            + Math.abs(sa - ca);
          count += 1;
        }
      }
    }
  }
  return count ? err / count : Infinity;
}

function sizePenalty(cols, rows, srcW, srcH, pitch) {
  // Soft priors only — extreme sizes, not ordinary small sprites like 4×3.
  const logical = cols * rows;
  const sourcePixels = Math.max(1, srcW * srcH);
  const coverage = (cols * pitch * rows * pitch) / sourcePixels;
  let penalty = 0;
  if (logical < 4) penalty += 50;
  if (cols < 2 || rows < 2) penalty += 50;
  if (coverage < 0.4) penalty += (0.4 - coverage) * 20;
  // Near 1:1 with the source means the "grid" is just individual pixels.
  if (pitch <= 2 && logical > sourcePixels * 0.5) penalty += 30;
  return penalty;
}
