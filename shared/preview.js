/*
 * Lit-preview rendering — derived from laigter/shaders/fshader.glsl
 * view_mode==5 with lightNum=1, parallax off. Occlusion multiplies ambient only
 * (upstream: `ambientColor * ambientIntensity * occlusion`); omit the map to
 * keep ambient unoccluded (equivalent to occlusion=1).
 *
 * Pure function over plain { width, height, data } records — no DOM, no Node
 * APIs. Mirrors shared/normal.js: callers wrap the returned record as ImageData
 * (browser) or write it via pngjs (CLI/tests).
 *
 * The browser viewport renders this same math on the GPU via web/src/litGL.js
 * (so light dragging is resolution-independent). This function remains the
 * validated CPU parity reference and the no-WebGL fallback.
 */

import { rgbaOffset } from "./image.js";
import { smoothstep } from "./primitives.js";

/** @typedef {[number, number, number]} Rgb01 */

/**
 * Default preview-light settings matching upstream Laigter (main_window.ui +
 * open_gl_widget.cpp constructor).
 */
export const DEFAULT_LIGHT_PARAMS = {
  diffuseColor: [0, 1, 0.7],
  diffuseIntensity: 0.6,
  specularColor: [0, 1, 0.7],
  specularIntensity: 0.6,
  specularScatter: 32,
  ambientColor: [1, 1, 1],
  ambientIntensity: 0.8,
};

const VIEW_DIR = [0, 0, 1];

/**
 * @param {number} ix
 * @param {number} iy
 * @param {number} iz
 * @param {number} nx
 * @param {number} ny
 * @param {number} nz
 * @returns {Rgb01}
 */
function reflect(ix, iy, iz, nx, ny, nz) {
  const dot = ix * nx + iy * ny + iz * nz;
  return [ix - 2 * dot * nx, iy - 2 * dot * ny, iz - 2 * dot * nz];
}

/**
 * @param {Partial<typeof DEFAULT_LIGHT_PARAMS>} settings
 * @returns {typeof DEFAULT_LIGHT_PARAMS}
 */
function resolveLightSettings(settings = {}) {
  return { ...DEFAULT_LIGHT_PARAMS, ...settings };
}

/**
 * Render the lit preview for (source, normal) under one point light.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} source  RGBA diffuse
 * @param {{width:number,height:number,data:Uint8ClampedArray}} normal  RGBA tangent-space normal map
 * @param {{x:number,y:number,z:number} & Partial<typeof DEFAULT_LIGHT_PARAMS>} light
 *   Light position plus optional intensity/color settings. x and y are offsets
 *   from image center (positive y is up). z is the height fraction (0..1) and
 *   is multiplied by 1000 to match fshader.glsl.
 * @param {boolean} [toon=false]  Apply the toon-shading thresholds.
 * @param {{width:number,height:number,data:Uint8ClampedArray}|null} [specularMap=null]
 *   Optional specular reflectivity map; defaults to full reflectivity.
 * @param {{width:number,height:number,data:Uint8ClampedArray}|null} [occlusionMap=null]
 *   Optional AO map (grayscale in R); multiplies ambient only. Defaults to 1.
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function buildLitPreview(source, normal, light, toon = false, specularMap = null, occlusionMap = null) {
  const width = source.width;
  const heightPx = source.height;
  const lightZ = light.z * 1000;
  const centerX = width * 0.5;
  const centerY = heightPx * 0.5;
  const settings = resolveLightSettings(light);
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
      const ldx = lx / len;
      const ldy = ly / len;
      const ldz = lightZ / len;

      let diff = Math.max(0, nx * ldx + ny * ldy + nz * ldz);
      if (toon) {
        diff = smoothstep(0.495, 0.505, diff);
      }

      const [dr, dg, db] = settings.diffuseColor;
      const diffuseR = diff * dr * settings.diffuseIntensity;
      const diffuseG = diff * dg * settings.diffuseIntensity;
      const diffuseB = diff * db * settings.diffuseIntensity;

      const [rdx, rdy, rdz] = reflect(-ldx, -ldy, -ldz, nx, ny, nz);
      let spec = Math.pow(Math.max(0, rdx * VIEW_DIR[0] + rdy * VIEW_DIR[1] + rdz * VIEW_DIR[2]), settings.specularScatter);
      if (toon) {
        spec = smoothstep(0.005, 0.01, spec);
      }

      let specMapR = 1;
      let specMapG = 1;
      let specMapB = 1;
      if (specularMap) {
        specMapR = specularMap.data[off] / 255;
        specMapG = specularMap.data[off + 1] / 255;
        specMapB = specularMap.data[off + 2] / 255;
      }

      const [sr, sg, sb] = settings.specularColor;
      const specularR = settings.specularIntensity * spec * sr * specMapR;
      const specularG = settings.specularIntensity * spec * sg * specMapG;
      const specularB = settings.specularIntensity * spec * sb * specMapB;

      const occlusion = occlusionMap ? occlusionMap.data[off] / 255 : 1;
      const [ar, ag, ab] = settings.ambientColor;
      const ambientR = ar * settings.ambientIntensity * occlusion;
      const ambientG = ag * settings.ambientIntensity * occlusion;
      const ambientB = ab * settings.ambientIntensity * occlusion;

      const shadeR = diffuseR + specularR + ambientR;
      const shadeG = diffuseG + specularG + ambientG;
      const shadeB = diffuseB + specularB + ambientB;

      out[off] = Math.max(0, Math.min(255, source.data[off] * shadeR)) | 0;
      out[off + 1] = Math.max(0, Math.min(255, source.data[off + 1] * shadeG)) | 0;
      out[off + 2] = Math.max(0, Math.min(255, source.data[off + 2] * shadeB)) | 0;
      out[off + 3] = source.data[off + 3];
    }
  }

  return { width, height: heightPx, data: out };
}
