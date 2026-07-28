// Flat-plane UV offset used by split preview — runnable via
//   node tests/flat-plane-offset.test.js
// Pins the sign convention shared with litGL steep parallax (x -= P.x, y += P.y).

import { strict as assert } from "node:assert";
import { flatPlaneUvOffset } from "../web/src/flatPlaneOffset.js";

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

function almostEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function checkClose(name, actual, expected) {
  assert.ok(almostEqual(actual.x, expected.x) && almostEqual(actual.y, expected.y),
    `${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  passed += 1;
  console.log(`  ok: ${name}`);
}

console.log("flatPlaneUvOffset");

check("zero height → zero offset", flatPlaneUvOffset({ x: 0.5, y: -0.25 }, 0), { x: 0, y: 0 });
check("null tilt → zero when height 0", flatPlaneUvOffset(null, 0), { x: 0, y: 0 });

{
  // viewDir = normalize(0, 0, 1) = (0,0,1); P = (0,0)*h → offset (0,0)
  checkClose("zero tilt stays put", flatPlaneUvOffset({ x: 0, y: 0 }, 0.03), { x: 0, y: 0 });
}

{
  // tilt (1,0), len = sqrt(2), viewDir.xy = (1/√2, 0), h=√2
  // offset = (-1/√2 * √2, 0) = (-1, 0)
  const h = Math.SQRT2;
  checkClose("positive X tilt pans left in UV", flatPlaneUvOffset({ x: 1, y: 0 }, h), { x: -1, y: 0 });
}

{
  // tilt (0,1), len = √2, viewDir.xy = (0, 1/√2), h=√2
  // offset = (0, 1/√2 * √2) = (0, 1)  — matches parallax y +=
  const h = Math.SQRT2;
  checkClose("positive Y tilt pans down in UV", flatPlaneUvOffset({ x: 0, y: 1 }, h), { x: 0, y: 1 });
}

console.log(`\n${passed} checks passed`);
