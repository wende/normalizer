/*
 * Parity check: run the browser inference core (web/deepbump_infer.js) through
 * onnxruntime-node and diff the result against the Python reference output.
 * Proves the JS worker path matches upstream DeepBump.
 *
 *   npm i onnxruntime-node pngjs
 *   node verify_web_parity.mjs
 *
 * Expected: "max channel delta vs Python: 1" (a 1-LSB truncation/rounding
 * difference; everything else is identical).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import ort from "onnxruntime-node";

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, "..", "..", "web", "deepbump_infer.js")); // sets globalThis.DeepBumpInfer
const { colorToNormals } = globalThis.DeepBumpInfer;

const readPng = (p) => {
  const png = PNG.sync.read(fs.readFileSync(p));
  return { data: png.data, width: png.width, height: png.height };
};

const inp = readPng(path.join(here, "sample_input.png"));
const ref = readPng(path.join(here, "sample_normal.png"));

const session = await ort.InferenceSession.create(path.join(here, "deepbump256.onnx"));
const runTile = async (tile) => {
  const t = new ort.Tensor("float32", tile, [1, 1, 256, 256]);
  const r = await session.run({ input: t });
  return r.output.data;
};

const t0 = Date.now();
const out = await colorToNormals(inp, "LARGE", runTile);
console.log(`JS inference: ${out.width}x${out.height} in ${Date.now() - t0} ms`);

const png = new PNG({ width: out.width, height: out.height });
png.data = Buffer.from(out.data.buffer);
fs.writeFileSync(path.join(here, "sample_normal_js.png"), PNG.sync.write(png));

let maxD = 0;
let over1 = 0;
const n = out.width * out.height;
for (let i = 0; i < n; i++) {
  const p = i * 4;
  for (let c = 0; c < 3; c++) {
    const d = Math.abs(out.data[p + c] - ref.data[p + c]);
    if (d > maxD) maxD = d;
    if (d > 1) over1++;
  }
}
console.log(`max channel delta vs Python: ${maxD}`);
console.log(`channels >1 LSB: ${over1} / ${n * 3}`);
console.log(maxD <= 2 ? "PARITY OK (within 2 LSB)" : "PARITY FAIL");
