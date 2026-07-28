// Per-pixel occlusion pipeline check — no framework, runnable via
//   node tests/occlusion.test.js
// Pins the extracted distanceTransform, the alphaDistance refactor, flat-mode
// contrast/brightness/invert/alpha, the distance-mode threshold→EDT→scale→
// profile path, and the blur sigma convention. Blur off keeps the flat path
// exact; the circular profile (a sqrt) is pinned via bg pixels (exactly bright)
// plus a same-formula reconstruction of the object-pixel value.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import pngjs from "pngjs";
import { generateOcclusionMap, DEFAULT_OCCLUSION_PARAMS } from "../shared/occlusion.js";
import { distanceTransform, alphaDistance, gaussianBlur } from "../shared/primitives.js";

const { PNG } = pngjs;
const HERE = dirname(fileURLToPath(import.meta.url));

const INF = 1e20;

// 2x2 RGBA fixture (same as specular.test.js). grayscaleFromRgba qGray:
//   px0 white opaque → 255, px1 black opaque → 0,
//   px2 (100,150,200) a=128 → 140, px3 white transparent → 0.
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
  return generateOcclusionMap(source, { ...DEFAULT_OCCLUSION_PARAMS, occlusionBlur: 0, ...overrides });
}
function px(map, i) {
  const o = i * 4;
  return [map.data[o], map.data[o + 1], map.data[o + 2], map.data[o + 3]];
}
// Reproduce the impl's final Float32→Uint8Clamped rounding so reconstructed
// expected values match byte-for-byte without hardcoding magic numbers.
function to8(x) {
  const a = new Uint8ClampedArray(1);
  a[0] = x;
  return a[0];
}

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}
function approx(name, actual, expected, eps = 1e-4) {
  assert.ok(Math.abs(actual - expected) < eps, `${name}: ${actual} ≈ ${expected}`);
  passed += 1;
  console.log(`  ok: ${name}`);
}

console.log("distanceTransform + alphaDistance regression");

// 1. 3x3 grid with one background pixel at the center → Euclidean distances to
//    (1,1). Pins the two-pass extraction (column pass, row pass, final sqrt).
{
  const grid = new Float32Array([
    INF, INF, INF,
    INF, 0, INF,
    INF, INF, INF,
  ]);
  const d = distanceTransform(grid, 3, 3);
  const sqrt2 = Math.sqrt(2);
  const want = [sqrt2, 1, sqrt2, 1, 0, 1, sqrt2, 1, sqrt2];
  for (let i = 0; i < 9; i += 1) approx(`edt 3x3 center-bg px${i}`, d[i], want[i]);
}
// 2. alphaDistance must equal (build its alpha/border grid) + distanceTransform
//    — exactly what the step-1 refactor reduced it to. We do NOT assert the
//    distances are "correct": edt1d has a pre-existing Float32 precision quirk
//    on [0,1e20,0] runs (the 1e20 seed cancels out of the parabola-intersection
//    math, dropping the leading seed) that predates this work and is shared with
//    the normal-map bevel path. Fixing it is a separate, golden-impacting
//    change; this guard only ensures the refactor preserved alphaDistance.
{
  const img = {
    width: 3,
    height: 3,
    data: new Uint8ClampedArray(
      Array.from({ length: 36 }, (_, k) => (k % 4 === 3 ? 255 : 200)),
    ),
  };
  const grid = new Float32Array(9);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const a = img.data[(y * 3 + x) * 4 + 3];
      grid[y * 3 + x] = a > 0 && x > 0 && y > 0 && x < 2 && y < 2 ? INF : 0;
    }
  }
  const want = distanceTransform(grid, 3, 3);
  const got = alphaDistance(img);
  check("alphaDistance == grid + distanceTransform", Array.from(got), Array.from(want));
}

console.log("\nocclusion flat mode (distance off, blur off)");

// 4. flat identity: contrast 1, bright 0 → v = gray.
{
  const m = gen({ occlusionDistanceMode: false, occlusionContrast: 1, occlusionThresh: 1, occlusionBright: 0 });
  check("flat identity px0", px(m, 0), [255, 255, 255, 255]);
  check("flat identity px1", px(m, 1), [0, 0, 0, 255]);
  check("flat identity px2", px(m, 2), [140, 140, 140, 255]);
  check("flat identity px3", px(m, 3), [0, 0, 0, 255]);
}
// 5. contrast pivot: contrast 0 → v = thresh (NOT 0-centered), bright 0.
{
  const m = gen({ occlusionDistanceMode: false, occlusionContrast: 0, occlusionThresh: 127, occlusionBright: 0 });
  for (let i = 0; i < 4; i += 1) check(`flat pivot px${i} = thresh`, px(m, i), [127, 127, 127, 255]);
}
// 6. brightness: contrast 1, bright 100 → px0 clamps, px2 = 140+100.
{
  const m = gen({ occlusionDistanceMode: false, occlusionContrast: 1, occlusionBright: 100 });
  check("flat bright px0 (255+100→255)", px(m, 0), [255, 255, 255, 255]);
  check("flat bright px1 (0+100)", px(m, 1), [100, 100, 100, 255]);
  check("flat bright px2 (140+100=240)", px(m, 2), [240, 240, 240, 255]);
}
// 7. invert happens upfront on the grayscale (before threshold): 255 - gray.
{
  const m = gen({ occlusionDistanceMode: false, occlusionContrast: 1, occlusionInvert: true, occlusionBright: 0 });
  check("flat invert px0 (255-255)", px(m, 0), [0, 0, 0, 255]);
  check("flat invert px1 (255-0)", px(m, 1), [255, 255, 255, 255]);
  check("flat invert px2 (255-140=115)", px(m, 2), [115, 115, 115, 255]);
}
// 8. useAlpha: A = source alpha.
{
  const m = gen({ occlusionDistanceMode: false, occlusionContrast: 1, useAlpha: true });
  check("flat useAlpha px0 a=255", px(m, 0)[3], 255);
  check("flat useAlpha px2 a=128", px(m, 2)[3], 128);
  check("flat useAlpha px3 a=0", px(m, 3)[3], 0);
}

console.log("\nocclusion distance mode (blur off)");

// 9. distance mode default: threshold(>1) makes px0/px2 object, px1/px3 bg.
//    Each object pixel is EDT-distance 1 from a bg pixel; bg pixels have
//    distance 0 → profile(0)=0 → output is exactly `bright`. The object value
//    is reconstructed from the documented curve (scale × profile + bright),
//    pinning the 255/distance scaling and the profile shape.
{
  const distance = 10;
  const m = gen({ occlusionContrast: 1, occlusionThresh: 1, occlusionBright: 16, occlusionDistance: distance });
  check("dist bg px1 = bright", px(m, 1), [16, 16, 16, 255]);
  check("dist bg px3 = bright", px(m, 3), [16, 16, 16, 255]);
  const scaled = (1 * 255) / distance;
  const profile = Math.sqrt(1 - (scaled / 255 - 1) ** 2) * 255;
  const want = to8(profile + 16);
  check("dist obj px0 = profile(dist)+bright", px(m, 0), [want, want, want, 255]);
  check("dist obj px2 = profile(dist)+bright", px(m, 2), [want, want, want, 255]);
}
// 10. scaling sensitivity: object pixel changes with occlusionDistance; bg stays
//     exactly bright in both.
{
  const m10 = gen({ occlusionContrast: 1, occlusionBright: 16, occlusionDistance: 10 });
  const m100 = gen({ occlusionContrast: 1, occlusionBright: 16, occlusionDistance: 100 });
  check("object pixel changes with occlusionDistance", px(m10, 0)[0] !== px(m100, 0)[0], true);
  check("dist100 bg px1 = bright", px(m100, 1), [16, 16, 16, 255]);
}
// 11. distance 0 skips the EDT: the thresholded 0/1 mask is shaped directly.
{
  const m = gen({ occlusionContrast: 1, occlusionBright: 16, occlusionDistance: 0 });
  check("dist0 bg px1 = bright", px(m, 1), [16, 16, 16, 255]);
  const profile1 = Math.sqrt(1 - (1 / 255 - 1) ** 2) * 255;
  const want = to8(profile1 + 16);
  check("dist0 obj px0 = profile(1)+bright", px(m, 0), [want, want, want, 255]);
}

console.log("\nocclusion blur sigma convention");

// 12. flat mode, blur 2: generateOcclusionMap must call gaussianBlur with
//     3*occlusionBlur (gaussianBlur derives sigma=radius/3; upstream passes
//     occlusionBlur straight as sigma). At contrast 1 / bright 0 the pre-blur
//     field is just the gray, so compare against gaussianBlur(gray, w, h, 3*blur).
{
  const blur = 2;
  const grayField = Float32Array.of(255, 0, 140, 0);
  const expectedFloat = gaussianBlur(grayField, source.width, source.height, 3 * blur);
  const expected = new Uint8ClampedArray(4);
  for (let i = 0; i < 4; i += 1) expected[i] = expectedFloat[i];
  const m = generateOcclusionMap(source, {
    ...DEFAULT_OCCLUSION_PARAMS,
    occlusionDistanceMode: false,
    occlusionBlur: blur,
    occlusionContrast: 1,
    occlusionThresh: 1,
    occlusionBright: 0,
  });
  for (let i = 0; i < 4; i += 1) {
    check(`blur px${i} = gaussianBlur(...,3*blur)`, px(m, i), [expected[i], expected[i], expected[i], 255]);
  }
}

console.log("\nocclusion CLI end-to-end");

// 13. `normalizer occlusion` flat mode, blur 0, contrast 1, bright 0 → R=G=B=qGray.
//     Guards arg parsing + PNG I/O the pure-function tests don't touch.
{
  const dir = mkdtempSync(join(tmpdir(), "occ-cli-"));
  try {
    const inPath = join(dir, "in.png");
    const outPath = join(dir, "out.png");
    const inPng = new PNG({ width: 2, height: 2 });
    inPng.data.set(Uint8Array.of(
      255, 255, 255, 255,
      0, 0, 0, 255,
      128, 128, 128, 255,
      64, 64, 64, 255,
    ));
    writeFileSync(inPath, PNG.sync.write(inPng));

    const stdout = execFileSync(
      process.execPath,
      [join(HERE, "..", "cli", "normalizer.js"), "occlusion", inPath, outPath,
        "--occlusion-distance-mode", "0", "--occlusion-blur", "0",
        "--occlusion-contrast", "1", "--occlusion-bright", "0"],
      { encoding: "utf8" },
    );
    check("cli reports the occlusion write", stdout.includes("wrote occlusion map"), true);

    const outPng = PNG.sync.read(readFileSync(outPath));
    const want = [255, 0, 128, 64];
    for (let i = 0; i < 4; i += 1) {
      const o = i * 4;
      check(`cli out px${i}`, [outPng.data[o], outPng.data[o + 1], outPng.data[o + 2], outPng.data[o + 3]], [want[i], want[i], want[i], 255]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\nall ${passed} checks passed`);
