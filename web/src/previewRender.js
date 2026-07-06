/*
 * Canvas drawing helpers — framework-agnostic. Kept out of .jsx so they're
 * trivially testable and don't depend on Preact or DOM hooks. The caller
 * supplies a ctx + source + params; nothing here is module-level state.
 */

import { generateNormalMap } from "shared/normal.js";
import { buildLitPreview, DEFAULT_LIGHT_PARAMS } from "shared/preview.js";

export function hexToRgb01(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3
    ? value.split("").map((ch) => ch + ch).join("")
    : value;
  const int = Number.parseInt(full, 16);
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ];
}

export function fitRect(srcWidth, srcHeight, dstWidth, dstHeight) {
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight);
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  return {
    x: Math.round((dstWidth - width) / 2),
    y: Math.round((dstHeight - height) / 2),
    width,
    height,
  };
}

export function lightHandleSize(ratio) {
  return 44 * (ratio || 1);
}

export function lightToCanvas(light, source, rect) {
  if (!source) return { x: 0, y: 0 };
  return {
    x: rect.x + ((light.x + source.width * 0.5) / source.width) * rect.width,
    y: rect.y + ((source.height * 0.5 - light.y) / source.height) * rect.height,
  };
}

export function canvasToLight(point, source, rect) {
  return {
    x: ((point.x - rect.x) / rect.width) * source.width - source.width * 0.5,
    y: source.height * 0.5 - ((point.y - rect.y) / rect.height) * source.height,
  };
}

export function canvasPointFromEvent(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
    y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
  };
}

export function pointHitsLight(point, light, source, rect) {
  if (!source || !rect) return false;
  const pos = lightToCanvas(light, source, rect);
  const half = lightHandleSize(window.devicePixelRatio || 1) * 0.5;
  return (
    point.x >= pos.x - half &&
    point.x <= pos.x + half &&
    point.y >= pos.y - half &&
    point.y <= pos.y + half
  );
}

// Linear blend in tangent space between the generated base normal and the AI
// overlay, weighted by the AI blend fraction. Stays UI-side because it reads
// caller state the shared generator has no knowledge of.
export function blendNormalOverlay(base, source, overlay, blend) {
  if (!overlay || overlay.width !== base.width || overlay.height !== base.height) {
    return base;
  }
  if (blend <= 0) {
    return base;
  }
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  for (let px = 0; px < out.data.length; px += 4) {
    if (source.data[px + 3] === 0) continue;
    const br = out.data[px] / 127.5 - 1;
    const bg = out.data[px + 1] / 127.5 - 1;
    const bb = out.data[px + 2] / 127.5 - 1;
    const ar = overlay.data[px] / 127.5 - 1;
    const ag = overlay.data[px + 1] / 127.5 - 1;
    const ab = overlay.data[px + 2] / 127.5 - 1;
    const nr = br * (1 - blend) + ar * blend;
    const ng = bg * (1 - blend) + ag * blend;
    const nb = bb * (1 - blend) + ab * blend;
    const len = Math.hypot(nr, ng, nb) || 1;
    out.data[px] = Math.max(0, Math.min(255, 255 * (nr / len * 0.5 + 0.5))) | 0;
    out.data[px + 1] = Math.max(0, Math.min(255, 255 * (ng / len * 0.5 + 0.5))) | 0;
    out.data[px + 2] = Math.max(0, Math.min(255, 255 * (nb / len * 0.5 + 0.5))) | 0;
  }
  return out;
}

export function generateNormal(source, params, overlay = null, blend = 0) {
  const base = generateNormalMap(source, params);
  const baseImage = new ImageData(base.data, base.width, base.height);
  return blendNormalOverlay(baseImage, source, overlay, blend);
}

export function renderLit(source, normal, lightSettings, toon) {
  const out = buildLitPreview(source, normal, lightSettings, toon);
  return new ImageData(out.data, out.width, out.height);
}

export function buildLightSettings(light, lightControls) {
  const color = hexToRgb01(lightControls.lightColor);
  return {
    x: light.x,
    y: light.y,
    z: lightControls.lightHeight / 100,
    diffuseColor: color,
    diffuseIntensity: lightControls.diffuseIntensity / 100,
    specularColor: color,
    specularIntensity: lightControls.specularIntensity / 100,
    specularScatter: lightControls.specularScatter,
    ambientColor: hexToRgb01(lightControls.ambientColor),
    ambientIntensity: lightControls.ambientIntensity / 100,
  };
}

export { DEFAULT_LIGHT_PARAMS };

function drawImageData(ctx, imageData, rect, pixelated) {
  const offscreen = document.createElement("canvas");
  offscreen.width = imageData.width;
  offscreen.height = imageData.height;
  offscreen.getContext("2d").putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = !pixelated;
  ctx.drawImage(offscreen, rect.x, rect.y, rect.width, rect.height);
}

function drawLightHandle(ctx, light, source, rect, dragging, lightSprite) {
  const ratio = window.devicePixelRatio || 1;
  const pos = lightToCanvas(light, source, rect);
  const size = lightHandleSize(ratio);
  ctx.save();
  ctx.globalAlpha = dragging ? 1 : 0.94;
  if (lightSprite && lightSprite.complete && lightSprite.naturalWidth > 0) {
    ctx.drawImage(lightSprite, pos.x - size * 0.5, pos.y - size * 0.5, size, size);
  } else {
    ctx.fillStyle = "#dff8ee";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = dragging ? "#fffefa" : "rgba(255, 254, 250, 0.76)";
  ctx.lineWidth = Math.max(2, 2 * ratio);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, size * 0.48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the preview into the supplied canvas given the full UI state. Returns
 * the fitted rect used for layout (caller stores it for hit-testing).
 */
export function drawPreview({
  canvas,
  ctx,
  source,
  normal,
  litCache,
  litToonCache,
  mode,
  aiOverlay,
  light,
  pixelated,
  draggingLight,
  lightSprite,
}) {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.round(bounds.width * ratio));
  const nextHeight = Math.max(240, Math.round(bounds.height * ratio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  ctx.fillStyle = "#2a2f2c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!source || !normal) {
    return null;
  }

  const rect = fitRect(source.width, source.height, canvas.width - 48, canvas.height - 48);
  if (mode === "diffuse") {
    drawImageData(ctx, source, rect, pixelated);
  } else if (mode === "lit") {
    drawImageData(ctx, litCache || normal, rect, pixelated);
  } else if (mode === "normal") {
    drawImageData(ctx, normal, rect, pixelated);
  } else if (mode === "ai") {
    drawImageData(ctx, aiOverlay || normal, rect, pixelated);
  } else {
    drawImageData(ctx, source, rect, pixelated);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + Math.round(rect.width / 2), rect.y, Math.ceil(rect.width / 2), rect.height);
    ctx.clip();
    drawImageData(ctx, litCache || normal, rect, pixelated);
    ctx.restore();
    ctx.strokeStyle = "#fffefa";
    ctx.lineWidth = Math.max(1, Math.round(2 * ratio));
    ctx.beginPath();
    ctx.moveTo(rect.x + Math.round(rect.width / 2), rect.y);
    ctx.lineTo(rect.x + Math.round(rect.width / 2), rect.y + rect.height);
    ctx.stroke();
  }
  drawLightHandle(ctx, light, source, rect, draggingLight, lightSprite);
  return rect;
}

/* istanbul ignore next - exercised through the App integration */
export function readSourceFromImage(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const sourceCtx = canvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(image, 0, 0);
  return sourceCtx.getImageData(0, 0, width, height);
}

export function exportNormalPng(normal) {
  if (!normal) return;
  const canvas = document.createElement("canvas");
  canvas.width = normal.width;
  canvas.height = normal.height;
  canvas.getContext("2d").putImageData(normal, 0, 0);
  const a = document.createElement("a");
  a.download = "laigter-normal.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}