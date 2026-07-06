import { rgbaOffset } from "../shared/image.js";
import { generateNormalMap } from "../shared/normal.js";
import { buildLitPreview } from "../shared/preview.js";

const state = {
  source: null,
  normal: null,
  aiOverlay: null,
  lit: null,
  litToon: null,
  mode: "split",
  renderTimer: 0,
  aiRunning: false,
  lastRect: null,
  draggingLight: false,
  light: {
    x: 0,
    y: 0,
  },
  aiDeviceUsed: "",
};

const el = {
  input: document.querySelector("#imageInput"),
  sampleButton: document.querySelector("#sampleButton"),
  aiCheckButton: document.querySelector("#aiCheckButton"),
  aiGenerateButton: document.querySelector("#aiGenerateButton"),
  clearAiButton: document.querySelector("#clearAiButton"),
  exportButton: document.querySelector("#exportButton"),
  canvas: document.querySelector("#previewCanvas"),
  status: document.querySelector("#status"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  controls: {
    normalDepth: document.querySelector("#normalDepth"),
    normalBlur: document.querySelector("#normalBlur"),
    biselDepth: document.querySelector("#biselDepth"),
    biselDistance: document.querySelector("#biselDistance"),
    biselBlur: document.querySelector("#biselBlur"),
    softBisel: document.querySelector("#softBisel"),
    invertX: document.querySelector("#invertX"),
    invertY: document.querySelector("#invertY"),
    invertZ: document.querySelector("#invertZ"),
    useAlpha: document.querySelector("#useAlpha"),
    pixelated: document.querySelector("#pixelated"),
    toon: document.querySelector("#toon"),
    lightHeight: document.querySelector("#lightHeight"),
    uvPath: document.querySelector("#uvPath"),
    aiDevice: document.querySelector("#aiDevice"),
    aiModelSize: document.querySelector("#aiModelSize"),
    aiVolume: document.querySelector("#aiVolume"),
    aiExtrude: document.querySelector("#aiExtrude"),
    aiBlend: document.querySelector("#aiBlend"),
  },
};

const ctx = el.canvas.getContext("2d", { alpha: false });
const lightSprite = new Image();
lightSprite.decoding = "async";
lightSprite.src = "./laigter_texture.png";
lightSprite.addEventListener("load", drawPreview);

function params() {
  return {
    normalDepth: Number(el.controls.normalDepth.value),
    normalBlurRadius: Number(el.controls.normalBlur.value),
    biselDepth: Number(el.controls.biselDepth.value),
    biselDistance: Number(el.controls.biselDistance.value),
    biselBlurRadius: Number(el.controls.biselBlur.value),
    softBisel: el.controls.softBisel.checked,
    // Invert controls are commented out in the UI
    invertX: false,
    invertY: false,
    invertZ: false,
    useAlpha: el.controls.useAlpha.checked,
  };
}

function previewParams() {
  return {
    pixelated: el.controls.pixelated.checked,
    toon: el.controls.toon.checked,
  };
}

function aiParams() {
  // AI controls are commented out in the UI; return safe defaults.
  return {
    uvPath: "uv",
    device: "auto",
    modelSize: "vits",
    volume: 1,
    extrude: 4,
    blend: 0.65,
  };
}

function currentLight() {
  return {
    x: state.light.x,
    y: state.light.y,
    z: Number(el.controls.lightHeight.value) / 100,
  };
}

function resetLightPosition() {
  if (!state.source) {
    return;
  }
  state.light.x = state.source.width * 0.4;
  state.light.y = state.source.height * 0.4;
  invalidateLit();
}

function invalidateLit() {
  state.lit = null;
  state.litToon = null;
}

function syncOutputs() {
  for (const input of Object.values(el.controls)) {
    if (!input || input.type !== "range") {
      continue;
    }
    const output = input.parentElement.querySelector("output");
    output.value = input.value;
    output.textContent = input.value;
  }
}

function debounceGenerate() {
  syncOutputs();
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(generateAndDraw, 40);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setMode(mode) {
  state.mode = mode;
  for (const item of el.modeButtons) {
    item.classList.toggle("active", item.dataset.mode === mode);
  }
  drawPreview();
}

function storeAiSettings() {
  localStorage.setItem("normalizer.ai", JSON.stringify(aiParams()));
}

function restoreAiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("normalizer.ai") || "{}");
    if (saved.uvPath) el.controls.uvPath.value = saved.uvPath;
    if (saved.device) el.controls.aiDevice.value = saved.device;
    if (saved.modelSize) el.controls.aiModelSize.value = saved.modelSize;
    if (Number.isFinite(saved.volume)) el.controls.aiVolume.value = saved.volume;
    if (Number.isFinite(saved.extrude)) el.controls.aiExtrude.value = saved.extrude;
    if (Number.isFinite(saved.blend)) el.controls.aiBlend.value = Math.round(saved.blend * 100);
  } catch {
    localStorage.removeItem("normalizer.ai");
  }
}

function readSourceFromImage(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const sourceCtx = canvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(image, 0, 0);
  return sourceCtx.getImageData(0, 0, width, height);
}

async function loadSample() {
  setStatus("Loading sample");
  const image = new Image();
  image.decoding = "async";
  image.src = "./sample.png";
  await image.decode();
  state.source = readSourceFromImage(image);
  state.aiOverlay = null;
  resetLightPosition();
  generateAndDraw();
}

async function loadFile(file) {
  if (!file) {
    return;
  }

  setStatus("Loading image");
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    state.source = readSourceFromImage(image);
    state.aiOverlay = null;
    resetLightPosition();
    generateAndDraw();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Linear blend in tangent space between the generated base normal and the AI
// overlay (state.aiOverlay), weighted by the AI blend control. Stays UI-side
// because it reads DOM/state the shared generator has no knowledge of.
function blendNormalOverlay(base, source) {
  if (!state.aiOverlay || state.aiOverlay.width !== base.width || state.aiOverlay.height !== base.height) {
    return base;
  }

  const blend = aiParams().blend;
  if (blend <= 0) {
    return base;
  }

  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  for (let px = 0; px < out.data.length; px += 4) {
    if (source.data[px + 3] === 0) {
      continue;
    }

    const br = out.data[px] / 127.5 - 1;
    const bg = out.data[px + 1] / 127.5 - 1;
    const bb = out.data[px + 2] / 127.5 - 1;
    const ar = state.aiOverlay.data[px] / 127.5 - 1;
    const ag = state.aiOverlay.data[px + 1] / 127.5 - 1;
    const ab = state.aiOverlay.data[px + 2] / 127.5 - 1;
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

// Local DOM wrapper — shared/preview.js returns a plain {width,height,data}
// record; cache it as an ImageData for the canvas code below.
function renderLit(source, normal, toon) {
  const out = buildLitPreview(source, normal, currentLight(), toon);
  return new ImageData(out.data, out.width, out.height);
}

function litPreview() {
  const { toon } = previewParams();
  if (toon) {
    if (!state.litToon) {
      state.litToon = renderLit(state.source, state.normal, true);
    }
    return state.litToon;
  }

  if (!state.lit) {
    state.lit = renderLit(state.source, state.normal, false);
  }
  return state.lit;
}

function fitRect(srcWidth, srcHeight, dstWidth, dstHeight) {
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

function drawImageData(imageData, rect) {
  const offscreen = document.createElement("canvas");
  offscreen.width = imageData.width;
  offscreen.height = imageData.height;
  offscreen.getContext("2d").putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = !previewParams().pixelated;
  ctx.drawImage(offscreen, rect.x, rect.y, rect.width, rect.height);
}

function lightHandleSize() {
  const ratio = window.devicePixelRatio || 1;
  return 44 * ratio;
}

function lightToCanvas(rect) {
  const source = state.source;
  if (!source) {
    return { x: 0, y: 0 };
  }

  return {
    x: rect.x + ((state.light.x + source.width * 0.5) / source.width) * rect.width,
    y: rect.y + ((source.height * 0.5 - state.light.y) / source.height) * rect.height,
  };
}

function canvasToLight(point, rect) {
  const source = state.source;
  return {
    x: ((point.x - rect.x) / rect.width) * source.width - source.width * 0.5,
    y: source.height * 0.5 - ((point.y - rect.y) / rect.height) * source.height,
  };
}

function canvasPoint(event) {
  const bounds = el.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (el.canvas.width / bounds.width),
    y: (event.clientY - bounds.top) * (el.canvas.height / bounds.height),
  };
}

function pointHitsLight(point) {
  if (!state.source || !state.lastRect) {
    return false;
  }

  const light = lightToCanvas(state.lastRect);
  return Math.hypot(point.x - light.x, point.y - light.y) <= lightHandleSize() * 0.58;
}

function drawLightHandle(rect) {
  const ratio = window.devicePixelRatio || 1;
  const pos = lightToCanvas(rect);
  const size = lightHandleSize();
  ctx.save();
  ctx.globalAlpha = state.draggingLight ? 1 : 0.94;
  if (lightSprite.complete && lightSprite.naturalWidth > 0) {
    ctx.drawImage(lightSprite, pos.x - size * 0.5, pos.y - size * 0.5, size, size);
  } else {
    ctx.fillStyle = "#dff8ee";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = state.draggingLight ? "#fffefa" : "rgba(255, 254, 250, 0.76)";
  ctx.lineWidth = Math.max(2, 2 * ratio);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, size * 0.48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPreview() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = el.canvas.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.round(bounds.width * ratio));
  const nextHeight = Math.max(240, Math.round(bounds.height * ratio));
  if (el.canvas.width !== nextWidth || el.canvas.height !== nextHeight) {
    el.canvas.width = nextWidth;
    el.canvas.height = nextHeight;
  }

  ctx.fillStyle = "#2a2f2c";
  ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);

  if (!state.source || !state.normal) {
    state.lastRect = null;
    return;
  }

  const rect = fitRect(state.source.width, state.source.height, el.canvas.width - 48, el.canvas.height - 48);
  state.lastRect = rect;
  if (state.mode === "diffuse") {
    drawImageData(state.source, rect);
  } else if (state.mode === "lit") {
    drawImageData(litPreview(), rect);
  } else if (state.mode === "normal") {
    drawImageData(state.normal, rect);
  } else if (state.mode === "ai") {
    drawImageData(state.aiOverlay || state.normal, rect);
  } else {
    drawImageData(state.source, rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + Math.round(rect.width / 2), rect.y, Math.ceil(rect.width / 2), rect.height);
    ctx.clip();
    drawImageData(litPreview(), rect);
    ctx.restore();
    ctx.strokeStyle = "#fffefa";
    ctx.lineWidth = Math.max(1, Math.round(2 * ratio));
    ctx.beginPath();
    ctx.moveTo(rect.x + Math.round(rect.width / 2), rect.y);
    ctx.lineTo(rect.x + Math.round(rect.width / 2), rect.y + rect.height);
    ctx.stroke();
  }
  drawLightHandle(rect);
}

function generateAndDraw() {
  if (!state.source) {
    return;
  }
  const start = performance.now();
  // shared/ returns a plain { width, height, data } record; wrap it as ImageData
  // at the boundary, then apply the UI-side AI overlay blend.
  const base = generateNormalMap(state.source, params());
  state.normal = blendNormalOverlay(new ImageData(base.data, base.width, base.height), state.source);
  state.lit = null;
  state.litToon = null;
  drawPreview();
  setStatus(`${state.source.width}x${state.source.height} - ${Math.round(performance.now() - start)} ms`);
}

function exportPng() {
  if (!state.normal) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = state.normal.width;
  canvas.height = state.normal.height;
  canvas.getContext("2d").putImageData(state.normal, 0, 0);
  const a = document.createElement("a");
  a.download = "laigter-normal.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function assertAiServer() {
  if (window.location.protocol === "file:") {
    throw new Error("AI requires the local Node server. Run `node web/server.js` or `make web`.");
  }
}

function aiSearchParams() {
  const p = aiParams();
  return new URLSearchParams({
    uvPath: p.uvPath,
    device: p.device,
    modelSize: p.modelSize,
    volume: String(p.volume),
    extrude: String(p.extrude),
  });
}

function sourcePngBlob() {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = state.source.width;
    canvas.height = state.source.height;
    canvas.getContext("2d").putImageData(state.source, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode source image."));
      }
    }, "image/png");
  });
}

async function imageDataFromBlob(blob) {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    image.src = url;
    await image.decode();
    return readSourceFromImage(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setAiRunning(running) {
  state.aiRunning = running;
  el.aiGenerateButton.disabled = running;
  el.aiCheckButton.disabled = running;
  el.clearAiButton.disabled = running;
  el.aiGenerateButton.textContent = running ? "Generating..." : "AI Augment";
}

function clearAiOverlay() {
  state.aiOverlay = null;
  state.aiDeviceUsed = "";
  generateAndDraw();
  setStatus("Original normal map restored");
}

async function checkAiBackend() {
  try {
    assertAiServer();
    storeAiSettings();
    setStatus("Checking AI backend");
    const response = await fetch(`/api/normalcy/doctor?${aiSearchParams()}`);
    const result = await readApiResult(response);
    if (!response.ok || !result.ok) {
      throw new Error(result.output || "AI backend check failed.");
    }
    setStatus(result.output.trim().split("\n").pop() || "AI backend available");
  } catch (error) {
    setStatus(error.message);
  }
}

async function generateAiOverlay() {
  if (!state.source || state.aiRunning) {
    return;
  }

  try {
    assertAiServer();
    storeAiSettings();
    setAiRunning(true);
    setStatus("Running AI normal generation");
    const sourceBlob = await sourcePngBlob();
    const response = await fetch(`/api/normalcy/generate?${aiSearchParams()}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: sourceBlob,
    });

    if (!response.ok) {
      const result = await readApiResult(response);
      throw new Error(result.output || "AI generation failed.");
    }

    const overlay = await imageDataFromBlob(await response.blob());
    if (overlay.width !== state.source.width || overlay.height !== state.source.height) {
      throw new Error("AI normal map dimensions do not match the source image.");
    }

    state.aiOverlay = overlay;
    state.aiDeviceUsed = response.headers.get("x-normalcy-device") || aiParams().device;
    generateAndDraw();
    setStatus(`AI normal map applied (${state.aiDeviceUsed}); diffuse unchanged`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setAiRunning(false);
  }
}

async function readApiResult(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return { ok: false, output: text || `HTTP ${response.status} ${response.statusText}` };
}

function redrawLitPreview() {
  invalidateLit();
  drawPreview();
}

function setLightFromEvent(event) {
  if (!state.lastRect || !state.source) {
    return;
  }

  const next = canvasToLight(canvasPoint(event), state.lastRect);
  state.light.x = next.x;
  state.light.y = next.y;
  redrawLitPreview();
}

function syncLightCursor(event) {
  if (state.draggingLight) {
    el.canvas.style.cursor = "grabbing";
    return;
  }
  el.canvas.style.cursor = pointHitsLight(canvasPoint(event)) ? "grab" : "";
}

el.canvas.addEventListener("pointerdown", (event) => {
  if (!pointHitsLight(canvasPoint(event))) {
    return;
  }

  event.preventDefault();
  state.draggingLight = true;
  el.canvas.setPointerCapture(event.pointerId);
  el.canvas.style.cursor = "grabbing";
});

el.canvas.addEventListener("pointermove", (event) => {
  if (!state.draggingLight) {
    syncLightCursor(event);
    return;
  }

  event.preventDefault();
  setLightFromEvent(event);
});

function stopLightDrag(event) {
  if (!state.draggingLight) {
    return;
  }

  state.draggingLight = false;
  if (el.canvas.hasPointerCapture(event.pointerId)) {
    el.canvas.releasePointerCapture(event.pointerId);
  }
  syncLightCursor(event);
  drawPreview();
}

el.canvas.addEventListener("pointerup", stopLightDrag);
el.canvas.addEventListener("pointercancel", stopLightDrag);
el.canvas.addEventListener("pointerleave", (event) => {
  if (!state.draggingLight) {
    syncLightCursor(event);
  }
});

for (const [key, input] of Object.entries(el.controls)) {
  if (
    key === "pixelated" ||
    key === "toon" ||
    key === "lightHeight" ||
    // AI controls (UI commented out)
    key === "uvPath" ||
    key === "aiDevice" ||
    key === "aiModelSize" ||
    key === "aiVolume" ||
    key === "aiExtrude" ||
    key === "aiBlend"
  ) {
    continue;
  }
  if (!input) continue;
  input.addEventListener("input", debounceGenerate);
  input.addEventListener("change", debounceGenerate);
}

// for (const key of ["uvPath", "aiDevice", "aiModelSize", "aiVolume", "aiExtrude"]) {
//   el.controls[key].addEventListener("change", () => {
//     syncOutputs();
//     storeAiSettings();
//   });
// }

// el.controls.aiBlend.addEventListener("change", storeAiSettings);

el.controls.pixelated.addEventListener("change", drawPreview);
el.controls.toon.addEventListener("change", () => {
  redrawLitPreview();
});
el.controls.lightHeight.addEventListener("input", () => {
  syncOutputs();
  redrawLitPreview();
});
el.controls.lightHeight.addEventListener("change", () => {
  syncOutputs();
  redrawLitPreview();
});

el.input.addEventListener("change", () => loadFile(el.input.files[0]));
el.sampleButton.addEventListener("click", loadSample);
// AI buttons commented out in the UI
// el.aiCheckButton.addEventListener("click", checkAiBackend);
// el.aiGenerateButton.addEventListener("click", generateAiOverlay);
// el.clearAiButton.addEventListener("click", clearAiOverlay);
el.exportButton.addEventListener("click", exportPng);

for (const button of el.modeButtons) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
}

window.addEventListener("resize", drawPreview);

restoreAiSettings();
syncOutputs();
loadSample();
