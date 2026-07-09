// Per-pixel specular pipeline check — no framework, runnable via
//   node tests/specular.test.js
// Pins the contrast pivot, brightness clamp, invert, and alpha paths with the
// blur off (radius 0 no-ops) so the math is exact.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import pngjs from "pngjs";
import { generateSpecularMap, DEFAULT_SPECULAR_PARAMS } from "../shared/specular.js";
import { gaussianBlur } from "../shared/primitives.js";

const { PNG } = pngjs;
const HERE = dirname(fileURLToPath(import.meta.url));

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

// 6. blur path pins the sigma convention. gaussianBlur takes a radius and derives
//    sigma = radius/3; upstream passes specularBlur straight in as sigma, so
//    generateSpecularMap must call it with 3*specularBlur. Compare the blurred
//    output against a direct gaussianBlur(field, w, h, 3*blur) — if the 3x
//    multiplier ever drifts, the two diverge and this fails.
{
  const blur = 2;
  // per-pixel value at contrast 1 / thresh 127 / bright 0 is just the gray:
  // row-major [px0, px1, px2, px3] = [255, 0, 140, 0].
  const grayField = Float32Array.of(255, 0, 140, 0);
  const expectedFloat = gaussianBlur(grayField, source.width, source.height, 3 * blur);
  // Uint8ClampedArray rounds ties-to-even; assign through one to match exactly.
  const expected = new Uint8ClampedArray(4);
  for (let i = 0; i < 4; i += 1) expected[i] = expectedFloat[i];

  const m = generateSpecularMap(source, { ...DEFAULT_SPECULAR_PARAMS, specularBlur: blur });
  for (let i = 0; i < 4; i += 1) {
    check(`blur px${i} = gaussianBlur(..., 3*blur)`, px(m, i), [expected[i], expected[i], expected[i], 255]);
  }
}

// 7. CLI wiring end-to-end: `normalizer specular` reads a PNG, runs the pipeline,
//    and writes an 8-bit RGBA PNG. Blur off + contrast 1 keeps the math exact so
//    the output equals the per-pixel grayscale. Guards the arg parsing + I/O path
//    that the pure-function tests above don't touch.
{
  const dir = mkdtempSync(join(tmpdir(), "spec-cli-"));
  try {
    const inPath = join(dir, "in.png");
    const outPath = join(dir, "out.png");

    // 2x2 opaque: white / black / mid-gray / quarter-gray → qGray = 255, 0, 128, 64.
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
      [join(HERE, "..", "cli", "normalizer.js"), "specular", inPath, outPath, "--specular-blur", "0", "--specular-contrast", "1"],
      { encoding: "utf8" },
    );
    check("cli reports the specular write", stdout.includes("wrote specular map"), true);

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
