/*
 * DeepBump color -> normal inference core (GPL-3.0, derived from
 * https://github.com/HugoTini/DeepBump). Environment-agnostic: pure typed-array
 * math with no DOM, no ONNX binding. The caller supplies `runTile`, an async
 * function that takes a Float32Array of one 1x256x256 grayscale tile and returns
 * a Float32Array of the model's 3x256x256 output. That lets the SAME code run
 * under onnxruntime-web (browser worker) and onnxruntime-node (parity test).
 *
 * Loaded as a classic script via importScripts() in the worker, and as a
 * side-effecting ES module in Node — both just set `<global>.DeepBumpInfer`.
 */
(function (root) {
  "use strict";

  const TILE = 256;
  // Overlap presets -> stride, matching DeepBump's module_color_to_normals.py.
  const OVERLAPS = {
    SMALL: (TILE / 6) | 0, // 42
    MEDIUM: (TILE / 4) | 0, // 64
    LARGE: (TILE / 2) | 0, // 128
  };

  const mod = (a, n) => ((a % n) + n) % n;

  // Mean of RGB in [0,1], stored float32 (matches DeepBump's np.float32
  // grayscale). When bgThreshold >= 0, transparent pixels (alpha <= threshold)
  // are replaced with the mean grayscale of the opaque pixels. Transparent PNG
  // pixels usually carry RGB=0 (black), which DeepBump would read as a hard
  // luminance cliff at the silhouette and turn into an outward bevel/halo;
  // flattening the background to a neutral value removes that artifact.
  function toGray(data, W, H, bgThreshold) {
    const g = new Float32Array(W * H);
    let sum = 0;
    let count = 0;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const v = (data[p] + data[p + 1] + data[p + 2]) / 3 / 255;
      g[i] = v;
      if (bgThreshold < 0 || data[p + 3] > bgThreshold) {
        sum += v;
        count++;
      }
    }
    if (bgThreshold >= 0 && count > 0 && count < W * H) {
      const mean = sum / count;
      for (let i = 0, p = 0; i < W * H; i++, p += 4) {
        if (data[p + 3] <= bgThreshold) g[i] = mean;
      }
    }
    return g;
  }

  function computePadding(H, W, stride) {
    let padH = 0;
    let padW = 0;
    const remH = mod(H - TILE, stride);
    const remW = mod(W - TILE, stride);
    if (remH !== 0) padH = stride - remH;
    if (remW !== 0) padW = stride - remW;
    if (TILE > H) padH = TILE - H;
    if (TILE > W) padW = TILE - W;
    const padLeft = ((padW / 2) | 0) + stride;
    const padRight = padW % 2 === 0 ? padLeft : padLeft + 1;
    const padTop = ((padH / 2) | 0) + stride;
    const padBottom = padH % 2 === 0 ? padTop : padTop + 1;
    return { padLeft, padRight, padTop, padBottom };
  }

  function linspace(a, b, n) {
    const o = new Float64Array(n);
    if (n === 1) {
      o[0] = a;
      return o;
    }
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) o[i] = a + step * i;
    return o;
  }

  function scalingMask(side) {
    const s = new Float64Array(side * side);
    for (let h = 0; h < side; h++) {
      for (let w = 0; w < side; w++) {
        const sh = h / (side - 1);
        const sw = w / (side - 1);
        let v = 0;
        if (h >= w && h <= side - w) v = sw;
        if (h <= w && h <= side - w) v = sh;
        if (h >= w && h >= side - w) v = 1 - sh;
        if (h <= w && h >= side - w) v = 1 - sw;
        s[h * side + w] = 2 * v;
      }
    }
    return s;
  }

  function cornerMask(side) {
    const c = new Float64Array(side * side);
    const sc = scalingMask(side);
    for (let h = 0; h < side; h++) {
      for (let w = 0; w < side; w++) {
        let v = 0;
        if (h >= w) v = 1 - h / (side - 1);
        if (h <= w) v = 1 - w / (side - 1);
        c[h * side + w] = v - 0.25 * sc[h * side + w];
      }
    }
    return c;
  }

  const rot180 = (a, side) => {
    const o = new Float64Array(side * side);
    for (let h = 0; h < side; h++)
      for (let w = 0; w < side; w++)
        o[h * side + w] = a[(side - 1 - h) * side + (side - 1 - w)];
    return o;
  };
  const flipCols = (a, side) => {
    const o = new Float64Array(side * side);
    for (let h = 0; h < side; h++)
      for (let w = 0; w < side; w++) o[h * side + w] = a[h * side + (side - 1 - w)];
    return o;
  };
  const flipRows = (a, side) => {
    const o = new Float64Array(side * side);
    for (let h = 0; h < side; h++)
      for (let w = 0; w < side; w++) o[h * side + w] = a[(side - 1 - h) * side + w];
    return o;
  };

  // Pyramidal blend mask for overlapping tiles (DeepBump generate_mask).
  function generateMask(stride) {
    const ramp = TILE - stride;
    const m = new Float64Array(TILE * TILE).fill(1);
    const lin01 = linspace(0, 1, ramp);
    const lin10 = linspace(1, 0, ramp);

    for (let h = ramp; h < TILE - ramp; h++)
      for (let w = 0; w < ramp; w++) m[h * TILE + w] = lin01[w];
    for (let h = ramp; h < TILE - ramp; h++)
      for (let w = 0; w < ramp; w++) m[h * TILE + (TILE - ramp + w)] = lin10[w];
    for (let h = 0; h < ramp; h++)
      for (let w = ramp; w < TILE - ramp; w++) m[h * TILE + w] = lin01[h];
    for (let h = 0; h < ramp; h++)
      for (let w = ramp; w < TILE - ramp; w++) m[(TILE - ramp + h) * TILE + w] = lin10[h];

    let corner = rot180(cornerMask(ramp), ramp); // top-left
    for (let h = 0; h < ramp; h++)
      for (let w = 0; w < ramp; w++) m[h * TILE + w] = corner[h * ramp + w];
    corner = flipCols(corner, ramp); // top-right
    for (let h = 0; h < ramp; h++)
      for (let w = 0; w < ramp; w++) m[h * TILE + (TILE - ramp + w)] = corner[h * ramp + w];
    corner = flipRows(corner, ramp); // bottom-right
    for (let h = 0; h < ramp; h++)
      for (let w = 0; w < ramp; w++)
        m[(TILE - ramp + h) * TILE + (TILE - ramp + w)] = corner[h * ramp + w];
    corner = flipCols(corner, ramp); // bottom-left
    for (let h = 0; h < ramp; h++)
      for (let w = 0; w < ramp; w++) m[(TILE - ramp + h) * TILE + w] = corner[h * ramp + w];
    return m;
  }

  const clampTrunc = (v) => {
    let iv = (v * 255) | 0; // truncate, matching numpy .astype(uint8)
    if (iv < 0) iv = 0;
    else if (iv > 255) iv = 255;
    return iv;
  };

  /**
   * @param image   {data:Uint8ClampedArray(RGBA), width, height}
   * @param overlap "SMALL" | "MEDIUM" | "LARGE"
   * @param runTile async (Float32Array[256*256]) => Float32Array[3*256*256]
   * @param onProgress optional (done,total) => void
   * @returns {data:Uint8ClampedArray(RGBA), width, height}  (OpenGL normals)
   */
  async function colorToNormals(image, overlap, runTile, onProgress, options) {
    const opts = options || {};
    const maskAlpha = opts.maskAlpha !== false; // respect transparency by default
    const threshold = opts.alphaThreshold ?? 0; // alpha <= threshold => background
    const { data, width: W, height: H } = image;
    const stride = TILE - (OVERLAPS[overlap] ?? OVERLAPS.LARGE);
    const gray = toGray(data, W, H, maskAlpha ? threshold : -1);

    const { padLeft, padRight, padTop, padBottom } = computePadding(H, W, stride);
    const paddedH = H + padTop + padBottom;
    const paddedW = W + padLeft + padRight;
    const hRange = (((paddedH - TILE) / stride) | 0) + 1;
    const wRange = (((paddedW - TILE) / stride) | 0) + 1;

    const mask = generateMask(stride);
    const plane = paddedH * paddedW;
    const merged = new Float64Array(3 * plane);
    const total = hRange * wRange;
    let done = 0;
    if (onProgress) onProgress(0, total);

    for (let hi = 0; hi < hRange; hi++) {
      for (let wi = 0; wi < wRange; wi++) {
        const baseR = hi * stride;
        const baseC = wi * stride;

        const tile = new Float32Array(TILE * TILE);
        for (let th = 0; th < TILE; th++) {
          const sr = mod(baseR + th - padTop, H);
          for (let tw = 0; tw < TILE; tw++) {
            const sc = mod(baseC + tw - padLeft, W);
            tile[th * TILE + tw] = gray[sr * W + sc];
          }
        }

        const out = await runTile(tile); // Float32Array 3*256*256

        for (let c = 0; c < 3; c++) {
          const mo = c * plane;
          const co = c * TILE * TILE;
          for (let th = 0; th < TILE; th++) {
            const mrow = mo + (baseR + th) * paddedW + baseC;
            const trow = co + th * TILE;
            const mkrow = th * TILE;
            for (let tw = 0; tw < TILE; tw++) {
              merged[mrow + tw] += out[trow + tw] * mask[mkrow + tw];
            }
          }
        }

        done++;
        if (onProgress) onProgress(done, total);
      }
    }

    // Crop back to original size + normalize each pixel to a unit vector.
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        // Transparent source -> flat, opaque normal (matches the base normal
        // map's background and gives a clean silhouette instead of a halo).
        if (maskAlpha && data[p + 3] <= threshold) {
          rgba[p] = 128;
          rgba[p + 1] = 128;
          rgba[p + 2] = 255;
          rgba[p + 3] = 255;
          continue;
        }
        const mi = (y + padTop) * paddedW + (x + padLeft);
        let r = merged[mi] - 0.5;
        let g = merged[plane + mi] - 0.5;
        let b = merged[2 * plane + mi] - 0.5;
        const len = Math.sqrt(r * r + g * g + b * b) || 1;
        r = (r / len) * 0.5 + 0.5;
        g = (g / len) * 0.5 + 0.5;
        b = (b / len) * 0.5 + 0.5;
        rgba[p] = clampTrunc(r);
        rgba[p + 1] = clampTrunc(g);
        rgba[p + 2] = clampTrunc(b);
        rgba[p + 3] = 255;
      }
    }
    return { data: rgba, width: W, height: H };
  }

  root.DeepBumpInfer = { colorToNormals, OVERLAPS, TILE };
})(typeof self !== "undefined" ? self : globalThis);
