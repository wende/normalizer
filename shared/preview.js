/*
 * Lit-preview rendering — derived from laigter/shaders/fshader.glsl
 * view_mode==5 with lightNum=1, parallax off, specular off, ambient off:
 * only the single-light diffuse term plus a constant ambient floor.
 *
 * Pure function over plain { width, height, data } records — no DOM, no Node
 * APIs. Mirrors shared/normal.js: callers wrap the returned record as ImageData
 * (browser) or write it via pngjs (CLI/tests).
 */

import { rgbaOffset } from "./image.js";
import { smoothstep } from "./primitives.js";

/**
 * Render the lit preview for (source, normal) under one point light.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} source  RGBA diffuse
 * @param {{width:number,height:number,data:Uint8ClampedArray}} normal  RGBA tangent-space normal map
 * @param {{x:number,y:number,z:number}} light  Light position. x and y are
 *   offsets from image center (positive y is up). z is the slider fraction
 *   (0..1) and is multiplied by 1000 here so the unit stays "fraction"
 *   throughout the calling code.
 * @param {boolean} [toon=false]  Apply the toon-shading diffuse threshold.
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function buildLitPreview(source, normal, light, toon = false) {
  const width = source.width;
  const heightPx = source.height;
  const lightZ = light.z * 1000;
  const centerX = width * 0.5;
  const centerY = heightPx * 0.5;
  const out = new Uint8ClampedArray(width * heightPx * 4);

  for (let py = 0; py < heightPx; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const off = rgbaOffset(width, px, py);
      const nx = normal.data[off] / 127.5 - 1;
      const ny = normal.data[off + 1] / 127.5 - 1;
      const nz = normal.data[off + 2] / 127.5 - 1;
      const fx = px + 0.5 - centerX;
      const fy = centerY - py - 0.5;
      const lx = light.x - fx;
      const ly = light.y - fy;
      const len = Math.hypot(lx, ly, lightZ) || 1;
      let diffuse = Math.max(0, nx * (lx / len) + ny * (ly / len) + nz * (lightZ / len));
      if (toon) {
        // Mirrors laigter/shaders/fshader.glsl toon diffuse threshold.
        diffuse = smoothstep(0.495, 0.505, diffuse);
      }
      const shade = 0.28 + diffuse * 0.86;

      out[off] = Math.max(0, Math.min(255, source.data[off] * shade)) | 0;
      out[off + 1] = Math.max(0, Math.min(255, source.data[off + 1] * shade)) | 0;
      out[off + 2] = Math.max(0, Math.min(255, source.data[off + 2] * shade)) | 0;
      out[off + 3] = source.data[off + 3];
    }
  }

  return { width, height: heightPx, data: out };
}