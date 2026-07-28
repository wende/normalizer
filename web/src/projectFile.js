/*
 * .normalizer project save/load — a ZIP of PNGs + project.json.
 * Web-only; full snapshot of source, generated maps, and AI overlay.
 *
 * Pure zip/JSON helpers are Node-safe (no DOM). PNG encode/decode helpers
 * use the browser canvas APIs and are only called from the UI path.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export const PROJECT_FORMAT = "normalizer-project";
export const PROJECT_VERSION = 1;

export const ASSET_NAMES = {
  source: "source.png",
  normal: "normal.png",
  specular: "specular.png",
  parallax: "parallax.png",
  occlusion: "occlusion.png",
  aiNormal: "ai-normal.png",
};

/** Build the project.json object (no binary assets). */
export function buildProjectJson(state) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    pipeline: state.pipeline,
    tab: state.tab,
    mode: state.mode,
    splitRatio: state.splitRatio,
    light: { ...state.light },
    viewTilt: { ...state.viewTilt },
    normal: { ...state.normalControls },
    lightControls: { ...state.lightControls },
    ai: { ...state.aiControls },
    specular: { ...state.specularControls },
    parallax: { ...state.parallaxControls },
    occlusion: { ...state.occlusionControls },
    assets: {
      source: ASSET_NAMES.source,
      normal: state.proceduralNormal ? ASSET_NAMES.normal : null,
      specular: state.specularMap ? ASSET_NAMES.specular : null,
      parallax: state.parallaxMap ? ASSET_NAMES.parallax : null,
      occlusion: state.occlusionMap ? ASSET_NAMES.occlusion : null,
      aiNormal: state.aiOverlay ? ASSET_NAMES.aiNormal : null,
    },
  };
}

/** Validate project.json; throws on unsupported format/version. Caller merges defaults. */
export function parseProjectJson(raw) {
  const meta = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!meta || typeof meta !== "object") {
    throw new Error("Invalid project.json");
  }
  if (meta.format !== PROJECT_FORMAT) {
    throw new Error(`Not a Normalizer project (format: ${meta.format ?? "missing"})`);
  }
  if (meta.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${meta.version}`);
  }
  if (!meta.assets || typeof meta.assets !== "object" || !meta.assets.source) {
    throw new Error("project.json missing assets.source");
  }
  return {
    format: meta.format,
    version: meta.version,
    pipeline: meta.pipeline === "procedural" ? "procedural" : "ai",
    tab: typeof meta.tab === "string" ? meta.tab : "light",
    mode: typeof meta.mode === "string" ? meta.mode : "split",
    splitRatio: Number.isFinite(meta.splitRatio) ? meta.splitRatio : 0.5,
    light: mergePoint(meta.light, { x: 0, y: 0 }),
    viewTilt: mergePoint(meta.viewTilt, { x: 0, y: 0 }),
    normal: meta.normal && typeof meta.normal === "object" ? meta.normal : {},
    lightControls: meta.lightControls && typeof meta.lightControls === "object" ? meta.lightControls : {},
    ai: meta.ai && typeof meta.ai === "object" ? meta.ai : {},
    specular: meta.specular && typeof meta.specular === "object" ? meta.specular : {},
    parallax: meta.parallax && typeof meta.parallax === "object" ? meta.parallax : {},
    occlusion: meta.occlusion && typeof meta.occlusion === "object" ? meta.occlusion : {},
    assets: {
      source: meta.assets.source,
      normal: meta.assets.normal || null,
      specular: meta.assets.specular || null,
      parallax: meta.assets.parallax || null,
      occlusion: meta.assets.occlusion || null,
      aiNormal: meta.assets.aiNormal || null,
    },
  };
}

function mergePoint(value, fallback) {
  if (!value || typeof value !== "object") return { ...fallback };
  return {
    x: Number.isFinite(value.x) ? value.x : fallback.x,
    y: Number.isFinite(value.y) ? value.y : fallback.y,
  };
}

/** Pack a file map into a .normalizer ZIP (Uint8Array). */
export function packProjectFiles(files) {
  return zipSync(files, { level: 6 });
}

/** Unpack a .normalizer ZIP into a filename → Uint8Array map. */
export function unpackProjectFiles(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return unzipSync(data);
}

/**
 * Build ZIP bytes from app state. `encodePng` converts an ImageData-like
 * `{width,height,data}` record to PNG bytes (injected so Node tests can use pngjs).
 */
export async function buildProjectArchive(state, encodePng) {
  if (!state.source) throw new Error("Nothing to save — load an image first.");
  const meta = buildProjectJson(state);
  const files = {
    "project.json": strToU8(JSON.stringify(meta, null, 2)),
  };
  files[ASSET_NAMES.source] = await encodePng(state.source);
  if (state.proceduralNormal) files[ASSET_NAMES.normal] = await encodePng(state.proceduralNormal);
  if (state.specularMap) files[ASSET_NAMES.specular] = await encodePng(state.specularMap);
  if (state.parallaxMap) files[ASSET_NAMES.parallax] = await encodePng(state.parallaxMap);
  if (state.occlusionMap) files[ASSET_NAMES.occlusion] = await encodePng(state.occlusionMap);
  if (state.aiOverlay) files[ASSET_NAMES.aiNormal] = await encodePng(state.aiOverlay);
  return packProjectFiles(files);
}

/**
 * Unpack + validate a .normalizer archive. Returns `{ meta, pngBytes }` where
 * pngBytes maps logical keys (source/normal/…) to Uint8Array or null.
 */
export function unpackProjectArchive(buffer) {
  const files = unpackProjectFiles(buffer);
  const jsonFile = files["project.json"];
  if (!jsonFile) throw new Error("Missing project.json in .normalizer file");
  const meta = parseProjectJson(strFromU8(jsonFile));
  const load = (name) => {
    if (!name) return null;
    const bytes = files[name];
    if (!bytes) throw new Error(`Missing asset listed in project.json: ${name}`);
    return bytes;
  };
  return {
    meta,
    pngBytes: {
      source: load(meta.assets.source),
      normal: load(meta.assets.normal),
      specular: load(meta.assets.specular),
      parallax: load(meta.assets.parallax),
      occlusion: load(meta.assets.occlusion),
      aiNormal: load(meta.assets.aiNormal),
    },
  };
}

/** Browser: ImageData → PNG Uint8Array via canvas. */
export async function imageDataToPngBytes(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const pixels = image.data instanceof Uint8ClampedArray
    ? image.data
    : new Uint8ClampedArray(image.data);
  const imageData = typeof ImageData === "function" && image instanceof ImageData
    ? image
    : new ImageData(pixels, image.width, image.height);
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Browser: PNG bytes → ImageData. */
export async function pngBytesToImageData(bytes) {
  const blob = new Blob([bytes], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

/** Trigger a browser download of a .normalizer Blob/Uint8Array. */
export function downloadProject(data, filename = "project.normalizer") {
  const blob = data instanceof Blob
    ? data
    : new Blob([data], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = filename.endsWith(".normalizer") ? filename : `${filename}.normalizer`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

/** Suggest a .normalizer filename from an image/project file name. */
export function suggestProjectFilename(name) {
  if (!name) return "project.normalizer";
  const base = String(name).replace(/\.(normalizer|png|jpe?g|webp|gif)$/i, "");
  return `${base || "project"}.normalizer`;
}
