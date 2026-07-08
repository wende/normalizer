// Per-pixel specular pipeline check — no framework, runnable via
//   node tests/specular.test.js
// Pins the contrast pivot, brightness clamp, invert, and alpha paths with the
// blur off (radius 0 no-ops) so the math is exact.

import { strict as assert } from "node:assert";
import { generateSpecularMap, DEFAULT_SPECULAR_PARAMS } from "../shared/specular.js";

// 2x2 RGBA fixture. grayscaleFromRgba uses qGray (11r+16g+5b)/32, transparent→0:
//   px0 white opaque         → gray 255
//   px1 black opaque         → gray 0
//   px2 (100,150,200) a=128  → gray 140
//   px3 white transparent    → gray 0
const source = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
    100, 150, 200, 128,
    255, 255, 255, 0,
  ]),
};

function gen(overrides) {
  return generateSpecularMap(source, { ...DEFAULT_SPECULAR_PARAMS, specularBlur: 0, ...overrides });
}

function px(map, i) {
  const o = i * 4;
  return [map.data[o], map.data[o + 1], map.data[o + 2], map.data[o + 3]];
}

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

console.log("specular per-pixel pipeline (blur off)");

// 1. identity: contrast 1 → R=G=B=gray, A=255.
{
  const m = gen({ specularContrast: 1, specularThresh: 127, specularBright: 0, specularInvert: false, useAlpha: false });
  check("identity px0", px(m, 0), [255, 255, 255, 255]);
  check("identity px1", px(m, 1), [0, 0, 0, 255]);
  check("identity px2", px(m, 2), [140, 140, 140, 255]);
  check("identity px3 (transparent→0)", px(m, 3), [0, 0, 0, 255]);
}

// 2. contrast pivot: contrast 0 → every pixel = thresh (NOT 0-centered).
{
  const m = gen({ specularContrast: 0, specularThresh: 127 });
  for (let i = 0; i < 4; i += 1) {
    check(`pivot px${i} = thresh`, px(m, i), [127, 127, 127, 255]);
  }
}

// 3. brightness clamp: contrast 1, bright 100 → px0 (255+100) clamps to 255.
{
  const m = gen({ specularContrast: 1, specularBright: 100 });
  check("bright clamp px0 (255+100→255)", px(m, 0), [255, 255, 255, 255]);
  check("bright px1 (0+100)", px(m, 1), [100, 100, 100, 255]);
  check("bright px2 (140+100=240)", px(m, 2), [240, 240, 240, 255]);
}

// 4. invert: 255 - gray.
{
  const m = gen({ specularContrast: 1, specularInvert: true });
  check("invert px0 (255-255)", px(m, 0), [0, 0, 0, 255]);
  check("invert px1 (255-0)", px(m, 1), [255, 255, 255, 255]);
  check("invert px2 (255-140=115)", px(m, 2), [115, 115, 115, 255]);
}

// 5. useAlpha: A = source alpha.
{
  const m = gen({ specularContrast: 1, useAlpha: true });
  check("useAlpha px0 a=255", px(m, 0)[3], 255);
  check("useAlpha px2 a=128", px(m, 2)[3], 128);
  check("useAlpha px3 a=0", px(m, 3)[3], 0);
}

console.log(`\nall ${passed} checks passed`);
