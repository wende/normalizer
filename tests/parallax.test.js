// Parallax pipeline + erode/dilate primitive check — no framework, runnable via
//   node tests/parallax.test.js
// Pins the morph primitive on a hand-computed 5×5 case, the Binary polarity /
// §5.4 normalize decision, the HeightMap blend math, and the CLI wiring per type.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import pngjs from "pngjs";
import { generateParallaxMap, DEFAULT_PARALLAX_PARAMS } from "../shared/parallax.js";
import { dilate, erode } from "../shared/primitives.js";

const { PNG } = pngjs;
const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

// ---- 1. erode/dilate primitive (5×5, van Herk / Gil–Werman) ----
console.log("erode/dilate primitive");

// Spike at center (2,2)=255, rest 0. dilate n=3 (3×3 max) → 3×3 center block 255.
{
  const w = 5;
  const h = 5;
  const spike = new Float32Array(w * h);
  spike[2 * w + 2] = 255;
  const out = dilate(spike, w, h, 3);
  const expected = new Float32Array(w * h);
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) expected[y * w + x] = 255;
  check("dilate n=3 spreads spike to 3×3 block", Array.from(out), Array.from(expected));
}

// Inverse: all 255 except center 0. erode n=3 (3×3 min) → 3×3 center block 0.
{
  const w = 5;
  const h = 5;
  const inv = new Float32Array(w * h).fill(255);
  inv[2 * w + 2] = 0;
  const out = erode(inv, w, h, 3);
  const expected = new Float32Array(w * h).fill(255);
  for (let y = 1; y <= 3; y += 1) for (let x = 1; x <= 3; x += 1) expected[y * w + x] = 0;
  check("erode n=3 carves 3×3 hole", Array.from(out), Array.from(expected));
}

// n=1 is a no-op (CImg counts the size as the full element width).
{
  const x = Float32Array.of(0, 255, 64, 128, 200, 1);
  check("dilate n=1 is identity", Array.from(dilate(x, 3, 2, 1)), Array.from(x));
  check("erode n=1 is identity", Array.from(erode(x, 3, 2, 1)), Array.from(x));
  // n ≤ 0 also a no-op (erode(-0) from parallaxErodeDilate=0).
  check("erode n=0 is identity", Array.from(erode(x, 3, 2, 0)), Array.from(x));
}

// Uniform image is unchanged by either op.
{
  const u = new Float32Array(25).fill(128);
  check("dilate uniform unchanged", Array.from(dilate(u, 5, 5, 3)), Array.from(u));
  check("erode uniform unchanged", Array.from(erode(u, 5, 5, 3)), Array.from(u));
}

// ---- 2. Binary parallax (blur off → exact threshold/polarity math) ----
console.log("binary parallax pipeline");
//
// 2x2 RGBA fixture. grayscaleFromRgba (qGray, transparent→0):
//   px0 white opaque  → 255
//   px1 black opaque  → 0
//   px2 (100,150,200) → 140
//   px3 white transp  → 0
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
  return generateParallaxMap(source, {
    ...DEFAULT_PARALLAX_PARAMS,
    parallaxFocus: 0,
    parallaxSoft: 0,
    parallaxErodeDilate: 1,
    ...overrides,
  });
}

function px(map, i) {
  const o = i * 4;
  return [map.data[o], map.data[o + 1], map.data[o + 2], map.data[o + 3]];
}

// threshold > 140 → [255,0,0,0]; !invert (default) → 255-par → [0,255,255,255].
{
  const m = gen({ parallaxMax: 140 });
  check("binary default polarity px0", px(m, 0), [0, 0, 0, 255]);
  check("binary default polarity px1", px(m, 1), [255, 255, 255, 255]);
  check("binary default polarity px2 (140 not > 140)", px(m, 2), [255, 255, 255, 255]);
  check("binary default polarity px3", px(m, 3), [255, 255, 255, 255]);
}

// strict `>`: px2 gray 140 with max 140 stays below-threshold; with max 139 it
// crosses. Pins the comparison direction (§5.4).
{
  const m = gen({ parallaxMax: 139 });
  check("binary strict threshold px2 (140 > 139)", px(m, 2), [0, 0, 0, 255]);
}

// invert=true skips the 255-par flip → threshold map as-is.
{
  const m = gen({ parallaxMax: 140, parallaxInvert: true });
  check("binary invert px0", px(m, 0), [255, 255, 255, 255]);
  check("binary invert px1", px(m, 1), [0, 0, 0, 255]);
}

// parallaxMin floors the bright side: max=140,min=50 → bright=255, dark=50.
{
  const m = gen({ parallaxMax: 140, parallaxMin: 50 });
  check("binary min px0 (dark side = min)", px(m, 0), [50, 50, 50, 255]);
  check("binary min px1 (bright clamps to 255)", px(m, 1), [255, 255, 255, 255]);
}

// useAlpha carries the source alpha through.
{
  const m = gen({ parallaxMax: 140, useAlpha: true });
  check("binary useAlpha px0 a=255", px(m, 0)[3], 255);
  check("binary useAlpha px2 a=128", px(m, 2)[3], 128);
  check("binary useAlpha px3 a=0", px(m, 3)[3], 0);
}

// ---- 3. HeightMap parallax (blend math, blur off, explicit bevel distance) ----
console.log("heightmap parallax pipeline");
// gray = [255,0,140,0]. bevelDistance supplied directly so the blend is exact.
// par[i] = (gray + dist - 1)/2 + 0.5; contrast 1, bright 0 → identity.
{
  const dist = Float32Array.of(0, 255, 128, 0);
  const m = generateParallaxMap(
    source,
    { ...DEFAULT_PARALLAX_PARAMS, parallaxType: "heightmap", parallaxFocus: 0, parallaxSoft: 0, parallaxContrast: 1, parallaxBrightness: 0 },
    source,
    dist,
  );
  // px0 (255+0-1)/2+.5 = 127.5 → 128 ; px1 (0+255-1)/2+.5 = 128
  // px2 (140+128-1)/2+.5 = 134       ; px3 (0+0-1)/2+.5 = 0
  check("heightmap blend px0", px(m, 0), [128, 128, 128, 255]);
  check("heightmap blend px1", px(m, 1), [128, 128, 128, 255]);
  check("heightmap blend px2", px(m, 2), [134, 134, 134, 255]);
  check("heightmap blend px3", px(m, 3), [0, 0, 0, 255]);
}

// contrast 0 → every pixel = parallaxMax (the contrast pivot).
{
  const dist = Float32Array.of(0, 255, 128, 0);
  const m = generateParallaxMap(
    source,
    { ...DEFAULT_PARALLAX_PARAMS, parallaxType: "heightmap", parallaxFocus: 0, parallaxSoft: 0, parallaxContrast: 0, parallaxMax: 200 },
    source,
    dist,
  );
  for (let i = 0; i < 4; i += 1) check(`heightmap contrast0 px${i} = max`, px(m, i), [200, 200, 200, 255]);
}

// invert flips after the blend.
{
  const dist = Float32Array.of(0, 0, 0, 0); // bevel 0 → blend = gray/2 ish
  const m = generateParallaxMap(
    source,
    { ...DEFAULT_PARALLAX_PARAMS, parallaxType: "heightmap", parallaxFocus: 0, parallaxSoft: 0, parallaxInvert: true },
    source,
    dist,
  );
  // blend: [127.5,0,70,0]; invert: [127.5,255,185,255] → [128,255,185,255]
  check("heightmap invert px0", px(m, 0), [128, 128, 128, 255]);
  check("heightmap invert px1", px(m, 1), [255, 255, 255, 255]);
  check("heightmap invert px2", px(m, 2), [185, 185, 185, 255]);
  check("heightmap invert px3", px(m, 3), [255, 255, 255, 255]);
}

// ---- 4. CLI wiring end-to-end (both types) ----
console.log("cli parallax wiring");
{
  const dir = mkdtempSync(join(tmpdir(), "par-cli-"));
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

    // Binary: max 140, blur off, erode 1 (no-op) → threshold [255,0,0,0] → !invert [0,255,255,255].
    const stdoutB = execFileSync(
      process.execPath,
      [join(HERE, "..", "cli", "normalizer.js"), "parallax", inPath, outPath,
        "--parallax-type", "binary", "--parallax-max", "140", "--parallax-focus", "0", "--parallax-soft", "0", "--parallax-erode-dilate", "1"],
      { encoding: "utf8" },
    );
    check("cli reports the parallax write", stdoutB.includes("wrote parallax map"), true);
    const outB = PNG.sync.read(readFileSync(outPath));
    const wantB = [0, 255, 255, 255];
    for (let i = 0; i < 4; i += 1) {
      const o = i * 4;
      check(`cli binary out px${i}`, [outB.data[o], outB.data[o + 1], outB.data[o + 2], outB.data[o + 3]], [wantB[i], wantB[i], wantB[i], 255]);
    }

    // HeightMap: blur off; tiny fully-opaque image → bevel distance all 0 → blend = gray/2.
    // gray [255,0,128,64] → [(255-1)/2+.5, 0, (128-1)/2+.5, (64-1)/2+.5] = [128,0,64,32].
    execFileSync(
      process.execPath,
      [join(HERE, "..", "cli", "normalizer.js"), "parallax", inPath, outPath,
        "--parallax-type", "heightmap", "--parallax-soft", "0", "--parallax-contrast", "1", "--parallax-brightness", "0"],
      { encoding: "utf8" },
    );
    const outH = PNG.sync.read(readFileSync(outPath));
    const wantH = [128, 0, 64, 32];
    for (let i = 0; i < 4; i += 1) {
      const o = i * 4;
      check(`cli heightmap out px${i}`, [outH.data[o], outH.data[o + 1], outH.data[o + 2], outH.data[o + 3]], [wantH[i], wantH[i], wantH[i], 255]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\nall ${passed} checks passed`);
