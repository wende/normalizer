/*
 * Export Pack — ZIP of texture maps + normalizer.json for engine importers.
 *
 * Engine-facing material pack (not a Normalizer project snapshot). No Godot
 * .tres or Unity .mat; those stay optional follow-ups that consume this
 * manifest. Pure zip/JSON helpers are Node-safe; PNG encode uses the browser
 * canvas API and is injected for tests.
 */

import { zipSync, strToU8 } from "fflate";

export const MATERIAL_FORMAT = "normalizer-material";
export const MATERIAL_VERSION = 1;

/** Canonical map keys → filename suffix (without leading underscore / .png). */
export const MAP_SUFFIXES = {
  albedo: "albedo",
  normal: "normal",
  height: "height",
  occlusion: "ao",
  specular: "specular",
};

/**
 * Sanitize a texture base name for filenames / ZIP folder.
 * Strips extension and path; falls back to "texture".
 */
export function sanitizeBaseName(name) {
  if (!name) return "texture";
  const leaf = String(name).replace(/^.*[/\\]/, "");
  const base = leaf.replace(/\.(png|jpe?g|webp|gif|normalizer|zip)$/i, "");
  const cleaned = base
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "");
  return cleaned || "texture";
}

/** `{base}_{suffix}.png` for one map key. */
export function mapFilename(baseName, mapKey) {
  const suffix = MAP_SUFFIXES[mapKey];
  if (!suffix) throw new Error(`Unknown map key: ${mapKey}`);
  return `${sanitizeBaseName(baseName)}_${suffix}.png`;
}

/**
 * Build normalizer.json for an export pack.
 *
 * @param {object} options
 * @param {string} [options.baseName]
 * @param {"sprite"|"mesh"} [options.usage]
 * @param {"y+"|"y-"} [options.normalConvention]
 * @param {"white-high"|"black-high"} [options.heightPolarity]
 * @param {"source"|"opaque"|"straight"} [options.alphaMode]
 * @param {{horizontal?: number, vertical?: number}} [options.frames]
 * @param {object} [options.mapsPresent] which maps are included (defaults: all)
 */
export function buildMaterialManifest(options = {}) {
  const base = sanitizeBaseName(options.baseName);
  const present = options.mapsPresent || {};
  const include = (key) => present[key] !== false && present[key] !== null;

  const maps = {};
  for (const key of Object.keys(MAP_SUFFIXES)) {
    if (include(key)) maps[key] = mapFilename(base, key);
  }

  const frames = options.frames || {};
  return {
    format: MATERIAL_FORMAT,
    version: MATERIAL_VERSION,
    usage: options.usage === "mesh" ? "mesh" : "sprite",
    normalConvention: options.normalConvention === "y-" ? "y-" : "y+",
    heightPolarity: options.heightPolarity === "black-high" ? "black-high" : "white-high",
    alphaMode: options.alphaMode === "opaque" || options.alphaMode === "straight"
      ? options.alphaMode
      : "source",
    frames: {
      horizontal: Number.isFinite(frames.horizontal) && frames.horizontal > 0
        ? Math.floor(frames.horizontal)
        : 1,
      vertical: Number.isFinite(frames.vertical) && frames.vertical > 0
        ? Math.floor(frames.vertical)
        : 1,
    },
    maps,
  };
}

/** Validate / normalize a normalizer.json object. Throws on bad format. */
export function parseMaterialManifest(raw) {
  const meta = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!meta || typeof meta !== "object") {
    throw new Error("Invalid normalizer.json");
  }
  if (meta.format !== MATERIAL_FORMAT) {
    throw new Error(`Not a Normalizer material pack (format: ${meta.format ?? "missing"})`);
  }
  if (meta.version !== MATERIAL_VERSION) {
    throw new Error(`Unsupported material pack version: ${meta.version}`);
  }
  if (!meta.maps || typeof meta.maps !== "object") {
    throw new Error("normalizer.json missing maps");
  }

  const maps = {};
  for (const key of Object.keys(MAP_SUFFIXES)) {
    const value = meta.maps[key];
    if (typeof value === "string" && value) maps[key] = value;
  }
  if (!maps.albedo && !maps.normal) {
    throw new Error("normalizer.json maps must include albedo or normal");
  }

  const frames = meta.frames && typeof meta.frames === "object" ? meta.frames : {};
  return {
    format: MATERIAL_FORMAT,
    version: MATERIAL_VERSION,
    usage: meta.usage === "mesh" ? "mesh" : "sprite",
    normalConvention: meta.normalConvention === "y-" ? "y-" : "y+",
    heightPolarity: meta.heightPolarity === "black-high" ? "black-high" : "white-high",
    alphaMode: meta.alphaMode === "opaque" || meta.alphaMode === "straight"
      ? meta.alphaMode
      : "source",
    frames: {
      horizontal: Number.isFinite(frames.horizontal) && frames.horizontal > 0
        ? Math.floor(frames.horizontal)
        : 1,
      vertical: Number.isFinite(frames.vertical) && frames.vertical > 0
        ? Math.floor(frames.vertical)
        : 1,
    },
    maps,
  };
}

/**
 * Build ZIP bytes for an export pack.
 *
 * Layout:
 *   {base}/
 *     {base}_albedo.png
 *     {base}_normal.png
 *     …
 *     normalizer.json
 *
 * `images` maps logical keys (albedo/normal/height/occlusion/specular) to
 * ImageData-like records. Missing keys are omitted from the ZIP and manifest.
 *
 * @param {object} options
 * @param {string} [options.baseName]
 * @param {object} options.images
 * @param {Function} options.encodePng async (image) => Uint8Array
 * @param {object} [options.manifestOptions] forwarded to buildMaterialManifest
 */
export async function buildExportArchive(options) {
  const { images, encodePng } = options;
  if (!images?.albedo) {
    throw new Error("Nothing to export — load an image first.");
  }

  const base = sanitizeBaseName(options.baseName);
  const mapsPresent = {};
  const files = {};
  const folder = `${base}/`;

  for (const key of Object.keys(MAP_SUFFIXES)) {
    const image = images[key];
    if (!image) {
      mapsPresent[key] = false;
      continue;
    }
    mapsPresent[key] = true;
    const name = mapFilename(base, key);
    files[`${folder}${name}`] = await encodePng(image);
  }

  const manifest = buildMaterialManifest({
    ...(options.manifestOptions || {}),
    baseName: base,
    mapsPresent,
  });
  files[`${folder}normalizer.json`] = strToU8(JSON.stringify(manifest, null, 2) + "\n");

  return {
    bytes: zipSync(files, { level: 6 }),
    manifest,
    filename: `${base}.zip`,
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

/** Trigger a browser download of a ZIP Blob/Uint8Array. */
export function downloadZip(data, filename = "texture.zip") {
  const blob = data instanceof Blob
    ? data
    : new Blob([data], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = filename.endsWith(".zip") ? filename : `${filename}.zip`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

/** Single-map PNG filename using the same suffix convention. */
export function singleMapFilename(baseName, mapKey) {
  return mapFilename(baseName, mapKey);
}
