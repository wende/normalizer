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
  // Subsample large cells for the median vote — full 64² sorts are wasteful.
  const sampleStep = pitch > 8 ? Math.max(1, Math.floor(pitch / 8)) : 1;
  const maxSamples = Math.ceil(pitch / sampleStep) ** 2;
  const rs = new Uint8Array(maxSamples);
  const gs = new Uint8Array(maxSamples);
  const bs = new Uint8Array(maxSamples);
  const as = new Uint8Array(maxSamples);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let n = 0;
      let opaque = 0;
      let seen = 0;
      const x0 = offsetX + col * pitch;
      const y0 = offsetY + row * pitch;
      for (let dy = 0; dy < pitch; dy += sampleStep) {
        for (let dx = 0; dx < pitch; dx += sampleStep) {
          const si = rgbaOffset(source.width, x0 + dx, y0 + dy);
          const a = source.data[si + 3];
          rs[n] = source.data[si];
          gs[n] = source.data[si + 1];
          bs[n] = source.data[si + 2];
          as[n] = a;
          n += 1;
          seen += 1;
          if (a >= alphaThreshold) opaque += 1;
        }
      }

      const di = rgbaOffset(cols, col, row);
      if (opaque * 2 < seen) {
        data[di] = 0;
        data[di + 1] = 0;
        data[di + 2] = 0;
        data[di + 3] = 0;
        continue;
      }

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
 *
 * Ranking uses a cheap subsampled variance search; only the final top-N get a
 * full median reconstruct. Designed to stay interactive on ~1k² sources.
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
    const ranked = rankPitch(source, pitch, alphaThreshold, p.offsetX, p.offsetY);
    if (!ranked) return { candidates: [] };
    return { candidates: [finalizeCandidate(source, ranked, alphaThreshold)] };
  }

  const pitches = findPitchCandidates(source, minPitch, maxPitch, Math.max(6, candidateCount * 2));
  const ranked = [];
  const seenPitch = new Set();

  for (const pitch of pitches) {
    if (seenPitch.has(pitch)) continue;
    seenPitch.add(pitch);
    const best = rankPitch(source, pitch, alphaThreshold, -1, -1);
    if (best) ranked.push(best);
  }

  // Neighbours of the strongest autocorrelation peaks only.
  for (const pitch of pitches.slice(0, 3)) {
    for (const delta of [-1, 1]) {
      const alt = pitch + delta;
      if (alt < minPitch || alt > maxPitch || seenPitch.has(alt)) continue;
      seenPitch.add(alt);
      const best = rankPitch(source, alt, alphaThreshold, -1, -1);
      if (best) ranked.push(best);
    }
  }

  ranked.sort((a, b) => a.score - b.score);
  const filtered = suppressHarmonics(ranked).slice(0, candidateCount);
  return {
    candidates: filtered.map((r) => finalizeCandidate(source, r, alphaThreshold)),
  };
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
        colEnergy[x] += Math.abs(gray[i + 1] - gray[i]);
      }
      if (y + 1 < height) {
        rowEnergy[y] += Math.abs(gray[i + width] - gray[i]);
      }
    }
  }

  const colAc = autocorrelation(colEnergy, minPitch, maxPitch);
  const rowAc = autocorrelation(rowEnergy, minPitch, maxPitch);
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
  if (!peaks.length) {
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      peaks.push({ lag, score: scores[lag] });
    }
  }
  return peaks;
}

function suppressHarmonics(scored) {
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
 * Cheap rank: find best offsets via subsampled variance only. No median yet.
 */
function rankPitch(source, pitch, alphaThreshold, fixedOx, fixedOy) {
  const cols = Math.floor(source.width / pitch);
  const rows = Math.floor(source.height / pitch);
  if (cols < 2 || rows < 2) return null;

  let bestOx = 0;
  let bestOy = 0;
  let bestVar = Infinity;

  if (fixedOx >= 0 && fixedOy >= 0) {
    bestOx = ((fixedOx % pitch) + pitch) % pitch;
    bestOy = ((fixedOy % pitch) + pitch) % pitch;
    bestVar = gridVariance(source, pitch, bestOx, bestOy, alphaThreshold);
  } else {
    // Aggressive coarse sweep — pitch/4 steps, then nested refine down to 1px.
    const coarseStep = Math.max(1, Math.floor(pitch / 4));
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
    for (let step = Math.max(1, Math.floor(coarseStep / 2)); ; step = Math.floor(step / 2) || 1) {
      const centerOx = bestOx;
      const centerOy = bestOy;
      for (let dy = -step * 2; dy <= step * 2; dy += step) {
        for (let dx = -step * 2; dx <= step * 2; dx += step) {
          const ox = (((centerOx + dx) % pitch) + pitch) % pitch;
          const oy = (((centerOy + dy) % pitch) + pitch) % pitch;
          const v = gridVariance(source, pitch, ox, oy, alphaThreshold);
          if (v < bestVar) {
            bestVar = v;
            bestOx = ox;
            bestOy = oy;
          }
        }
      }
      if (step === 1) break;
    }
  }

  const logicalCols = Math.floor((source.width - bestOx) / pitch);
  const logicalRows = Math.floor((source.height - bestOy) / pitch);
  if (logicalCols < 1 || logicalRows < 1) return null;

  const sizePrior = sizePenalty(logicalCols, logicalRows, source.width, source.height, pitch);
  const pitchBias = pitch * pitch;
  const score = bestVar / pitchBias + sizePrior;

  return {
    pitch,
    offsetX: bestOx,
    offsetY: bestOy,
    cols: logicalCols,
    rows: logicalRows,
    score,
    variance: bestVar,
  };
}

function finalizeCandidate(source, ranked, alphaThreshold) {
  const sprite = reconstructPixelGrid(source, {
    pitch: ranked.pitch,
    offsetX: ranked.offsetX,
    offsetY: ranked.offsetY,
    alphaThreshold,
  });
  return {
    ...ranked,
    cols: sprite.cols,
    rows: sprite.rows,
    sprite,
  };
}

/**
 * Subsampled within-cell RGB variance. Samples a sparse grid of cells but
 * every pixel inside each sampled cell (needed to discriminate 1px offsets).
 */
function gridVariance(source, pitch, offsetX, offsetY, alphaThreshold) {
  const cols = Math.floor((source.width - offsetX) / pitch);
  const rows = Math.floor((source.height - offsetY) / pitch);
  if (cols < 1 || rows < 1) return Infinity;

  const cellStride = Math.max(1, Math.floor(Math.min(cols, rows) / 12));

  let totalVar = 0;
  let cells = 0;

  for (let row = 0; row < rows; row += cellStride) {
    for (let col = 0; col < cols; col += cellStride) {
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
          // Count transparent samples as black so mixed alpha/empty borders
          // raise variance and prefer offsets that hug the opaque content.
          const opaque = source.data[si + 3] >= alphaThreshold;
          const r = opaque ? source.data[si] : 0;
          const g = opaque ? source.data[si + 1] : 0;
          const b = opaque ? source.data[si + 2] : 0;
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

function sizePenalty(cols, rows, srcW, srcH, pitch) {
  const logical = cols * rows;
  const sourcePixels = Math.max(1, srcW * srcH);
  const coverage = (cols * pitch * rows * pitch) / sourcePixels;
  let penalty = 0;
  if (logical < 4) penalty += 50;
  if (cols < 2 || rows < 2) penalty += 50;
  if (coverage < 0.4) penalty += (0.4 - coverage) * 20;
  if (pitch <= 2 && logical > sourcePixels * 0.5) penalty += 30;
  return penalty;
}
