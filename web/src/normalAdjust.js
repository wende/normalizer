/*
 * Post-process tweaks for a tangent-space normal map. Pure, deterministic, and
 * instant — no re-inference. Operates on plain { width, height, data } records
 * (RGBA Uint8ClampedArray), so the exact math is testable in Node; the browser
 * wrapper returns an ImageData for the canvas / lit preview.
 *
 * Order: decode -> optional smooth (blur the vector field) -> scale tangent XY
 * by `strength` -> optional axis inverts -> renormalize -> re-encode.
 *   strength  1 = as generated, >1 = deeper/steeper relief, 0 = flat
 *   smooth    post blur radius in px (softens detail/noise)
 *   invertX/Y/Z  flip a channel (Invert Y = OpenGL <-> DirectX green flip)
 */

function clamp8(v) {
  let i = (v * 255) | 0;
  if (i < 0) i = 0;
  else if (i > 255) i = 255;
  return i;
}

// Snap v in [-1,1] to one of `levels` evenly spaced values. `levels` is odd so
// 0 is always representable — flat surfaces stay flat, tilts snap to facets.
function quantStep(v, levels) {
  if (v < -1) v = -1;
  else if (v > 1) v = 1;
  const t = (v + 1) * 0.5;
  return (Math.round(t * (levels - 1)) / (levels - 1)) * 2 - 1;
}

// Separable box blur over a single float plane, edge-clamped.
function boxBlur(src, W, H, r) {
  const win = 2 * r + 1;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let dx = -r; dx <= r; dx++) {
        let xx = x + dx;
        if (xx < 0) xx = 0;
        else if (xx >= W) xx = W - 1;
        s += src[row + xx];
      }
      tmp[row + x] = s / win;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) {
        let yy = y + dy;
        if (yy < 0) yy = 0;
        else if (yy >= H) yy = H - 1;
        s += tmp[yy * W + x];
      }
      out[y * W + x] = s / win;
    }
  }
  return out;
}

/**
 * Pure transform: RGBA in -> new RGBA Uint8ClampedArray out.
 * @param {Uint8ClampedArray} data  source RGBA normal map
 */
export function adjustNormalData(data, width, height, params = {}) {
  const strength = params.strength ?? 1;
  const smooth = Math.round(params.smooth ?? 0);
  const invertX = !!params.invertX;
  const invertY = !!params.invertY;
  const invertZ = !!params.invertZ;
  const n = width * height;

  let nx = new Float32Array(n);
  let ny = new Float32Array(n);
  let nz = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    nx[i] = data[p] / 127.5 - 1;
    ny[i] = data[p + 1] / 127.5 - 1;
    nz[i] = data[p + 2] / 127.5 - 1;
  }

  if (smooth > 0) {
    nx = boxBlur(nx, width, height, smooth);
    ny = boxBlur(ny, width, height, smooth);
    nz = boxBlur(nz, width, height, smooth);
  }

  // `steps` (>=1) quantizes the normal direction for a stepped/flat-faceted,
  // pixel-art look. levels = 2*steps+1 keeps 0 (flat) representable.
  const steps = Math.round(params.steps ?? 0);
  const quantize = steps >= 1;
  const levels = 2 * steps + 1;

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let x = nx[i] * strength;
    let y = ny[i] * strength;
    if (invertX) x = -x;
    if (invertY) y = -y;
    let z;
    if (quantize) {
      // Snap the tangent slope to discrete levels, then rebuild Z so every
      // facet is a single unit normal → hard-edged flat bands when lit.
      x = quantStep(x, levels);
      y = quantStep(y, levels);
      const t = x * x + y * y;
      if (t > 1) {
        const s = 1 / Math.sqrt(t);
        x *= s;
        y *= s;
        z = 0;
      } else {
        z = Math.sqrt(1 - t);
      }
      if (invertZ) z = -z;
    } else {
      z = nz[i];
      if (invertZ) z = -z;
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      x /= len;
      y /= len;
      z /= len;
    }
    out[p] = clamp8(x * 0.5 + 0.5);
    out[p + 1] = clamp8(y * 0.5 + 0.5);
    out[p + 2] = clamp8(z * 0.5 + 0.5);
    out[p + 3] = data[p + 3];
  }
  return out;
}

export function isIdentityAdjust(params = {}) {
  return (
    (params.strength ?? 1) === 1 &&
    !(Math.round(params.smooth ?? 0) > 0) &&
    !(Math.round(params.steps ?? 0) >= 1) &&
    !params.invertX &&
    !params.invertY &&
    !params.invertZ
  );
}

/**
 * Browser wrapper: returns an ImageData ready for canvas / renderLit. Returns
 * the input unchanged when the params are a no-op (avoids recompute + LSB drift).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} normal
 */
export function adjustNormalMap(normal, params = {}) {
  if (isIdentityAdjust(params)) return normal;
  const data = adjustNormalData(normal.data, normal.width, normal.height, params);
  return new ImageData(data, normal.width, normal.height);
}
