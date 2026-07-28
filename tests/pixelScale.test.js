// Pixel-art scale helpers + normal-map integration.
//   node tests/pixelScale.test.js

import { strict as assert } from "node:assert";
import {
  blocksAreUniform,
  detectPixelSize,
  downsampleRgba,
  normalizePixelSize,
  upsampleNearest,
} from "../shared/pixelScale.js";
import { generateNormalMap, DEFAULT_NORMAL_PARAMS } from "../shared/normal.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok: ${name}`);
}

// 2×2 logical checkerboard upscaled 4× → 8×8 of uniform 4×4 blocks.
function makeUpscaledChecker(scale) {
  const logical = [
    [255, 0],
    [0, 255],
  ];
  const W = 2 * scale;
  const H = 2 * scale;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = logical[Math.floor(y / scale)][Math.floor(x / scale)];
      const p = (y * W + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

check("normalizePixelSize clamps junk to 1", () => {
  assert.equal(normalizePixelSize(0), 1);
  assert.equal(normalizePixelSize(-3), 1);
  assert.equal(normalizePixelSize(NaN), 1);
  assert.equal(normalizePixelSize(4.6), 5);
});

check("detectPixelSize finds nearest-neighbour upscale", () => {
  const src = makeUpscaledChecker(4);
  assert.equal(detectPixelSize(src), 4);
  assert.equal(blocksAreUniform(src, 4), true);
  assert.equal(blocksAreUniform(src, 3), false);
});

check("detectPixelSize returns 1 for non-blocky noise", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 37) & 255;
    data[i + 1] = (i * 91) & 255;
    data[i + 2] = (i * 13) & 255;
    data[i + 3] = 255;
  }
  assert.equal(detectPixelSize({ width: 4, height: 4, data }), 1);
});

check("detectPixelSize returns 1 for solid fill", () => {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40;
    data[i + 1] = 40;
    data[i + 2] = 40;
    data[i + 3] = 255;
  }
  assert.equal(detectPixelSize({ width: 8, height: 8, data }), 1);
});

check("detectPixelSize finds scale via run GCD (multiples of art pixel)", () => {
  // 3×3 logical with scale 3 → runs of 3 (and 6 for adjacent same? checker so 3)
  assert.equal(detectPixelSize(makeUpscaledChecker(3)), 3);
  assert.equal(detectPixelSize(makeUpscaledChecker(8)), 8);
});

check("detectPixelSize still works with a cropped remainder strip", () => {
  // 4× upscale then drop the last column so width is not divisible by 4.
  const full = makeUpscaledChecker(4); // 8×8
  const W = 7;
  const H = 8;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const si = (y * full.width + x) * 4;
      const di = (y * W + x) * 4;
      data[di] = full.data[si];
      data[di + 1] = full.data[si + 1];
      data[di + 2] = full.data[si + 2];
      data[di + 3] = full.data[si + 3];
    }
  }
  // Run GCD of 4 and residual 3 → 1, then block fallback should still find 4
  // on the complete columns (floor(7/4)=1 full block column… actually only one
  // block column of width 4, height has 2 blocks). blocksAreUniform with s=4
  // checks floor(7/4)=1 × floor(8/4)=2 blocks — those are uniform → 4.
  assert.equal(detectPixelSize({ width: W, height: H, data }), 4);
});

check("downsample + upsample restores block structure", () => {
  const src = makeUpscaledChecker(4);
  const low = downsampleRgba(src, 4);
  assert.equal(low.width, 2);
  assert.equal(low.height, 2);
  assert.deepEqual([...low.data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...low.data.slice(4, 8)], [0, 0, 0, 255]);

  const up = upsampleNearest(low, src.width, src.height, 4);
  assert.equal(up.width, src.width);
  assert.equal(up.height, src.height);
  assert.deepEqual([...up.data], [...src.data]);
});

check("pixelSize=1 leaves generateNormalMap size unchanged", () => {
  const src = makeUpscaledChecker(2);
  const out = generateNormalMap(src, { ...DEFAULT_NORMAL_PARAMS, pixelSize: 1, normalBlurRadius: 0 });
  assert.equal(out.width, src.width);
  assert.equal(out.height, src.height);
});

check("pixelSize>1 yields block-constant normals (art-scale blur)", () => {
  // Soft blur at screen resolution would smear inside each 4×4 block. With
  // pixelSize=4 the blur runs on the 2×2 logical image (radius scaled into art
  // units), then nearest-upscales, so every physical pixel inside a block
  // shares one normal.
  const src = makeUpscaledChecker(4);
  const out = generateNormalMap(src, {
    ...DEFAULT_NORMAL_PARAMS,
    pixelSize: 4,
    normalBlurRadius: 4,
    biselBlurRadius: 4,
    biselDistance: 8,
  });
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  assert.equal(blocksAreUniform(out, 4, 0), true);
});

check("raising pixelSize does not multiply Soft into mush", () => {
  // Same Soft with a larger pixelSize must stay closer to the pixelSize=1
  // result than an unscaled (art-unit) Soft would. Unscaled Soft=8 at
  // pixelSize=4 would flatten the 2×2 logical image; scaled Soft stays useful.
  const src = makeUpscaledChecker(4);
  const base = generateNormalMap(src, {
    ...DEFAULT_NORMAL_PARAMS,
    pixelSize: 1,
    normalBlurRadius: 0,
    biselBlurRadius: 0,
    biselDistance: 0,
    biselDepth: 0,
  });
  const scaled = generateNormalMap(src, {
    ...DEFAULT_NORMAL_PARAMS,
    pixelSize: 4,
    normalBlurRadius: 8,
    biselBlurRadius: 8,
    biselDistance: 0,
    biselDepth: 0,
  });
  // Block centers should still differ between the two checkerboard colors —
  // not collapsed to one flat normal by an over-scaled blur.
  const c0 = scaled.data.slice(0, 3);
  const c1 = scaled.data.slice((0 * 8 + 4) * 4, (0 * 8 + 4) * 4 + 3);
  assert.notDeepEqual([...c0], [...c1]);
  assert.equal(blocksAreUniform(scaled, 4, 0), true);
  assert.equal(base.width, scaled.width);
});

check("without pixelSize, soft blur breaks block uniformity", () => {
  const src = makeUpscaledChecker(4);
  const out = generateNormalMap(src, {
    ...DEFAULT_NORMAL_PARAMS,
    pixelSize: 1,
    normalBlurRadius: 6,
    biselBlurRadius: 6,
  });
  assert.equal(blocksAreUniform(out, 4, 0), false);
});

console.log(`\n${passed} checks passed`);
