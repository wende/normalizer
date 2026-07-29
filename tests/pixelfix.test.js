// Pixel-fixer grid reconstruction — no framework, runnable via
//   node tests/pixelfix.test.js
// Pins auto pitch/offset detection on synthetic fat-pixel sprites, median
// reconstruction (not centre sampling), harmonic suppression, and the CLI
// pixelfix subcommand.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import pngjs from "pngjs";
import {
  detectPixelGrid,
  reconstructPixelGrid,
  fixPixels,
  upscaleNearest,
  DEFAULT_PIXEL_FIXER_PARAMS,
} from "../shared/pixelFixer.js";

const { PNG } = pngjs;
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli", "normalizer.js");

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

function makeFatPixelSprite(cols, rows, pitch, palette, { padX = 0, padY = 0 } = {}) {
  const w = cols * pitch + padX;
  const h = rows * pitch + padY;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const [R, G, B, A] = palette[r * cols + c];
      for (let dy = 0; dy < pitch; dy += 1) {
        for (let dx = 0; dx < pitch; dx += 1) {
          const x = padX + c * pitch + dx;
          const y = padY + r * pitch + dy;
          const i = (y * w + x) * 4;
          data[i] = R;
          data[i + 1] = G;
          data[i + 2] = B;
          data[i + 3] = A;
        }
      }
    }
  }
  return { width: w, height: h, data };
}

const palette = [
  [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255],
  [0, 255, 255, 255], [255, 0, 255, 255], [128, 128, 128, 255], [255, 255, 255, 255],
  [0, 0, 0, 255], [64, 64, 255, 255], [255, 128, 0, 255], [128, 255, 128, 255],
];

console.log("pixelFixer reconstruct + detect");

{
  const source = makeFatPixelSprite(4, 3, 8, palette);
  const sprite = reconstructPixelGrid(source, { pitch: 8, offsetX: 0, offsetY: 0 });
  check("manual reconstruct size", [sprite.width, sprite.height], [4, 3]);
  for (let i = 0; i < palette.length; i += 1) {
    const o = i * 4;
    check(
      `manual reconstruct px${i}`,
      [sprite.data[o], sprite.data[o + 1], sprite.data[o + 2], sprite.data[o + 3]],
      palette[i],
    );
  }
}

{
  const source = makeFatPixelSprite(4, 3, 8, palette);
  const { candidates } = detectPixelGrid(source, {
    ...DEFAULT_PIXEL_FIXER_PARAMS,
    minPitch: 4,
    maxPitch: 16,
    candidateCount: 3,
  });
  ok("auto-detect finds candidates", candidates.length >= 1);
  const best = candidates[0];
  check("auto-detect pitch", best.pitch, 8);
  check("auto-detect size", [best.cols, best.rows], [4, 3]);
  for (let i = 0; i < palette.length; i += 1) {
    const o = i * 4;
    check(
      `auto-detect colour px${i}`,
      [best.sprite.data[o], best.sprite.data[o + 1], best.sprite.data[o + 2], best.sprite.data[o + 3]],
      palette[i],
    );
  }
  ok("no exact harmonic of pitch 8 in top candidates", !candidates.some((c) => c.pitch === 4));
}

{
  const source = makeFatPixelSprite(4, 3, 8, palette, { padX: 3, padY: 3 });
  const { candidates } = detectPixelGrid(source, {
    minPitch: 4,
    maxPitch: 16,
    candidateCount: 3,
  });
  const best = candidates[0];
  check("offset detect pitch", best.pitch, 8);
  check("offset detect origin", [best.offsetX, best.offsetY], [3, 3]);
  check("offset detect size", [best.cols, best.rows], [4, 3]);
}

{
  // Median must ignore a minority of noisy pixels — centre sampling would fail.
  const pitch = 5;
  const w = pitch;
  const h = pitch;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    data[o] = 10;
    data[o + 1] = 20;
    data[o + 2] = 30;
    data[o + 3] = 255;
  }
  // One outlier at the cell centre.
  const mid = Math.floor(pitch / 2);
  const ci = (mid * w + mid) * 4;
  data[ci] = 255;
  data[ci + 1] = 0;
  data[ci + 2] = 0;
  const sprite = reconstructPixelGrid({ width: w, height: h, data }, { pitch, offsetX: 0, offsetY: 0 });
  check("median not centre", [sprite.data[0], sprite.data[1], sprite.data[2], sprite.data[3]], [10, 20, 30, 255]);
}

{
  const src = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) };
  const up = upscaleNearest(src, 2);
  check("upscale size", [up.width, up.height], [4, 2]);
  check("upscale tl", [up.data[0], up.data[1], up.data[2], up.data[3]], [1, 2, 3, 255]);
  check("upscale tr block", [up.data[8], up.data[9], up.data[10], up.data[11]], [4, 5, 6, 255]);
}

{
  const source = makeFatPixelSprite(4, 3, 8, palette);
  const out = fixPixels(source, { minPitch: 4, maxPitch: 16 });
  check("fixPixels size", [out.width, out.height], [4, 3]);
}

console.log("pixelFixer CLI");

{
  const dir = mkdtempSync(join(tmpdir(), "pixelfix-"));
  try {
    const source = makeFatPixelSprite(4, 3, 8, palette);
    const input = new PNG({ width: source.width, height: source.height });
    input.data = Buffer.from(source.data);
    const inPath = join(dir, "in.png");
    const outPath = join(dir, "out.png");
    writeFileSync(inPath, PNG.sync.write(input));
    execFileSync(process.execPath, [CLI, "pixelfix", inPath, outPath], { stdio: "pipe" });
    const out = PNG.sync.read(readFileSync(outPath));
    check("cli auto size", [out.width, out.height], [4, 3]);
    for (let i = 0; i < palette.length; i += 1) {
      const o = i * 4;
      check(
        `cli auto px${i}`,
        [out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]],
        palette[i],
      );
    }

    execFileSync(
      process.execPath,
      [CLI, "pixelfix", inPath, outPath, "--pitch", "8", "--offset-x", "0", "--offset-y", "0"],
      { stdio: "pipe" },
    );
    const out2 = PNG.sync.read(readFileSync(outPath));
    check("cli manual size", [out2.width, out2.height], [4, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} assertions passed`);
