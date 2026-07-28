// Preview-shadow math checks — runnable with `node tests/shadow.test.js`.

import { strict as assert } from "node:assert";
import { computeShadowProjection, shadowBand, shadowSoftnessTaps } from "../web/src/shadow.js";

const source = { width: 200, height: 100 };
const rect = { x: 20, y: 30, width: 400, height: 200 };
const shadow = { casterHeight: 35, contact: { x: 0.5, y: 1 } };

function project(light, overrides = {}) {
  return computeShadowProjection(source, rect, light, { ...shadow, ...overrides });
}

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

console.log("preview shadow projection");

// Positive normal-map Z means a light on the viewer-facing side. Its shadow
// must recede upward, while a right-side light sends it to the left.
{
  const p = project({ x: 80, y: 80, z: 0.3 });
  check("light right casts shadow left", p.shiftX < 0);
  check("front-facing light casts shadow away from viewer", p.shiftY < 0);
}

// The contact point changes the light vector; its x coordinate is meaningful.
{
  const centered = project({ x: 80, y: 0, z: 0.3 });
  const shiftedContact = project({ x: 80, y: 0, z: 0.3 }, { contact: { x: 0.9, y: 1 } });
  check("contact-relative light vector changes projection", shiftedContact.shiftX > centered.shiftX);
}

// The source row at the contact has no displacement, while the top row gets
// the maximum projection.
{
  const p = project({ x: 80, y: 80, z: 0.3 });
  const top = shadowBand(p, 0);
  const base = shadowBand(p, 15);
  check("canopy band has projected offset", Math.hypot(top.x, top.y) > 1);
  check("contact band tends to zero offset", Math.hypot(base.x, base.y) < Math.hypot(top.x, top.y) * 0.1);
}

// A light at or below the plane is safe and bounded instead of producing an
// infinite projection.
{
  const p = project({ x: 10000, y: -10000, z: -1 });
  check("unstable low light is capped", Math.hypot(p.shiftX, p.shiftY) <= Math.max(rect.width, rect.height) * 1.5001);
}

// Softening is symmetric and retains its total alpha contribution.
{
  const taps = shadowSoftnessTaps(project({ x: 80, y: 80, z: 0.3 }), 4);
  check("softness weights sum to one", Math.abs(taps.reduce((sum, tap) => sum + tap.weight, 0) - 1) < 1e-9);
  check("zero softness keeps taps co-located", shadowSoftnessTaps(project({ x: 80, y: 80, z: 0.3 }), 0).every((tap) => tap.x === 0 && tap.y === 0));
}

console.log(`\nall ${passed} checks passed`);
