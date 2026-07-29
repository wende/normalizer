// Lit-preview occlusion multiply — pins ambient-only AO from upstream
// fshader.glsl: `tex * (diffuse+specular + ambient * occlusion)`.

import { strict as assert } from "node:assert";
import { buildLitPreview } from "../shared/preview.js";

const W = 1;
const H = 1;

function rgba(r, g, b, a = 255) {
  return new Uint8ClampedArray([r, g, b, a]);
}

const source = { width: W, height: H, data: rgba(200, 100, 50) };
// Flat-ish normal pointing mostly up so lighting is stable.
const normal = { width: W, height: H, data: rgba(128, 128, 255) };

const light = {
  x: 0,
  y: 0,
  z: 1,
  diffuseColor: [0, 0, 0],
  diffuseIntensity: 0,
  specularColor: [0, 0, 0],
  specularIntensity: 0,
  specularScatter: 32,
  ambientColor: [1, 1, 1],
  ambientIntensity: 0.5,
};

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

console.log("lit preview occlusion (ambient-only)");

{
  const full = buildLitPreview(source, normal, light, false, null, null);
  const withOne = buildLitPreview(
    source,
    normal,
    light,
    false,
    null,
    { width: W, height: H, data: rgba(255, 255, 255) },
  );
  check("null occlusion ≡ AO=1", full.data[0] === withOne.data[0]
    && full.data[1] === withOne.data[1]
    && full.data[2] === withOne.data[2]);
}

{
  // ambient-only light: shade = 0.5 * occlusion; out = source * shade
  const half = buildLitPreview(
    source,
    normal,
    light,
    false,
    null,
    { width: W, height: H, data: rgba(128, 128, 128) },
  );
  // 200 * 0.5 * (128/255) ≈ 50.196 → 50
  check("half AO darkens ambient R", half.data[0] === 50);
  check("half AO darkens ambient G", half.data[1] === 25);
  check("half AO darkens ambient B", half.data[2] === 12);
  check("alpha preserved", half.data[3] === 255);
}

{
  // With diffuse-only (no ambient), AO must not change the result.
  const lit = {
    ...light,
    diffuseColor: [1, 1, 1],
    diffuseIntensity: 1,
    ambientIntensity: 0,
  };
  const noAo = buildLitPreview(source, normal, lit, false, null, null);
  const zeroAo = buildLitPreview(
    source,
    normal,
    lit,
    false,
    null,
    { width: W, height: H, data: rgba(0, 0, 0) },
  );
  check("AO does not affect diffuse+specular", noAo.data[0] === zeroAo.data[0]
    && noAo.data[1] === zeroAo.data[1]
    && noAo.data[2] === zeroAo.data[2]);
}

console.log(`\n${passed} checks passed`);
