/*
 * Default slider/toggle values — kept separate so the App can restore from
 * localStorage without losing the initial defaults on first load.
 */

// Initial UI slider values — must match the slider input names in
// ControlsPanel.jsx (e.g. `normalBlur`), NOT the renamed `*Radius` keys in
// shared/normal.js. buildNormalParams does the rename at call time.
export const DEFAULT_NORMAL = {
  normalDepth: 250,
  normalBlur: 6,
  biselDepth: 100,
  biselDistance: 60,
  biselBlur: 10,
  softBisel: true,
  invertX: false,
  invertY: false,
  invertZ: false,
  useAlpha: false,
};

export const DEFAULT_LIGHT_CONTROLS = {
  pixelated: false,
  toon: false,
  diffuseIntensity: 60,
  specularIntensity: 60,
  specularScatter: 32,
  ambientIntensity: 80,
  ambientColor: "#ffffff",
  lightColor: "#00ffb3",
  lightHeight: 30,
};

// Controls for the in-browser DeepBump pipeline (AI tab). `overlap` is the one
// native DeepBump knob — tile stride / seam blending, not strength.
export const DEFAULT_AI_CONTROLS = {
  // Generation params (require Regenerate):
  overlap: "LARGE", // "SMALL" | "MEDIUM" | "LARGE"
  denoise: 1, // edge-preserving pre-filter radius (px); 0 = off. Tames JPEG artifacts.
  // Live post-process (applied instantly to the generated map):
  strength: 100, // % ; 100 = as generated, higher = deeper relief, 0 = flat
  smooth: 0, // post blur radius (px); 0 = off
  steps: 0, // normal-direction quantization for pixel-art facets; 0 = off
};

export function buildNormalParams(controls) {
  return {
    normalDepth: Number(controls.normalDepth),
    normalBlurRadius: Number(controls.normalBlur),
    biselDepth: Number(controls.biselDepth),
    biselDistance: Number(controls.biselDistance),
    biselBlurRadius: Number(controls.biselBlur),
    softBisel: controls.softBisel,
    invertX: false,
    invertY: false,
    invertZ: false,
    useAlpha: controls.useAlpha,
  };
}