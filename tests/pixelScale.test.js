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
  // pixelSize=4 the blur runs on the 2×2 logical image, then nearest-upscales,
  // so every physical pixel inside a block shares one normal.
  const src = makeUpscaledChecker(4);
  const out = generateNormalMap(src, {
    ...DEFAULT_NORMAL_PARAMS,
    pixelSize: 4,
    normalBlurRadius: 1,
    biselBlurRadius: 1,
    biselDistance: 2,
  });
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  assert.equal(blocksAreUniform(out, 4, 0), true);
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
