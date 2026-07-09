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

// Specular-map UI values. Contrast is a UI int 1-4000; buildSpecularParams
// divides by 1000 to get the 0.001-4.0 float the engine wants. Blur UI default
// is 10 (prettier out-of-box); the shared/CLI default is 3.
export const DEFAULT_SPECULAR = {
  specularThresh: 127,
  specularContrast: 1000,
  specularBright: 0,
  specularBlur: 10,
  specularInvert: false,
  useAlpha: false,
};

export function buildSpecularParams(controls) {
  return {
    specularThresh: Number(controls.specularThresh),
    specularContrast: Number(controls.specularContrast) / 1000,
    specularBright: Number(controls.specularBright),
    specularBlur: Number(controls.specularBlur),
    specularInvert: controls.specularInvert,
    useAlpha: controls.useAlpha,
  };
}

// Occlusion-map UI values. Contrast is a UI int 1-4000; buildOcclusionParams
// divides by 1000 to get the 0.001-4.0 float the engine wants. Bright/blur UI
// defaults (10) are prettier out-of-box; the shared/CLI defaults are 16/3.
export const DEFAULT_OCCLUSION = {
  occlusionThresh: 1,
  occlusionContrast: 1000,
  occlusionBright: 10,
  occlusionBlur: 10,
  occlusionDistanceMode: true,
  occlusionDistance: 10,
  occlusionInvert: false,
  useAlpha: false,
};

export function buildOcclusionParams(controls) {
  return {
    occlusionThresh: Number(controls.occlusionThresh),
    occlusionContrast: Number(controls.occlusionContrast) / 1000,
    occlusionBright: Number(controls.occlusionBright),
    occlusionBlur: Number(controls.occlusionBlur),
    occlusionDistanceMode: controls.occlusionDistanceMode,
    occlusionDistance: Number(controls.occlusionDistance),
    occlusionInvert: controls.occlusionInvert,
    useAlpha: controls.useAlpha,
  };
}