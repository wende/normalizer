const state = {
  source: null,
  normal: null,
  lit: null,
  litToon: null,
  mode: "split",
  renderTimer: 0,
  lastRect: null,
  draggingLight: false,
  light: {
    x: 0,
    y: 0,
  },
};

const el = {
  input: document.querySelector("#imageInput"),
  sampleButton: document.querySelector("#sampleButton"),
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
  },
};

const ctx = el.canvas.getContext("2d", { alpha: false });
const lightSprite = new Image();
lightSprite.decoding = "async";
lightSprite.src = "../laigter/images/laigter_texture.png";
lightSprite.addEventListener("load", drawPreview);

function params() {
  return {
    normalDepth: Number(el.controls.normalDepth.value),
    normalBlurRadius: Number(el.controls.normalBlur.value),
    biselDepth: Number(el.controls.biselDepth.value),
    biselDistance: Number(el.controls.biselDistance.value),
    biselBlurRadius: Number(el.controls.biselBlur.value),
    softBisel: el.controls.softBisel.checked,
    invertX: el.controls.invertX.checked,
    invertY: el.controls.invertY.checked,
    invertZ: el.controls.invertZ.checked,
    useAlpha: el.controls.useAlpha.checked,
  };
}

function previewParams() {
  return {
    pixelated: el.controls.pixelated.checked,
    toon: el.controls.toon.checked,
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
    if (input.type !== "range") {
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

function rgbaOffset(width, x, y) {
  return (y * width + x) * 4;
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

function generatedSample() {
  const width = 256;
  const height = 256;
  const image = new ImageData(width, height);
  const cx = width * 0.48;
  const cy = height * 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / 92;
      const dy = (y - cy) / 86;
      const skull = dx * dx + dy * dy < 1;
      const jaw = x > 88 && x < 178 && y > 138 && y < 202;
      const eye = ((x - 112) ** 2) / 360 + ((y - 104) ** 2) / 190 < 1 ||
        ((x - 156) ** 2) / 330 + ((y - 105) ** 2) / 190 < 1;
      const nose = Math.abs(x - 135) < 13 && y > 110 && y < 146;
      const teeth = y > 169 && y < 181 && x > 92 && x < 174 && x % 13 < 8;
      const inside = (skull || jaw) && !eye && !nose;
      const offset = rgbaOffset(width, x, y);
      const shade = Math.max(0, Math.min(255, 190 + (x - y) * 0.28));
      image.data[offset + 0] = teeth ? 238 : shade;
      image.data[offset + 1] = teeth ? 236 : shade - 20;
      image.data[offset + 2] = teeth ? 215 : shade - 42;
      image.data[offset + 3] = inside || teeth ? 255 : 0;
    }
  }

  return image;
}

async function loadSample() {
  setStatus("Loading sample");
  const image = new Image();
  image.decoding = "async";
  image.src = "../laigter/images/sample.png";
  try {
    await image.decode();
    state.source = readSourceFromImage(image);
  } catch {
    state.source = generatedSample();
  }
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
    resetLightPosition();
    generateAndDraw();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function grayscaleFromRgba(image) {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = Math.round((299 * image.data[p] + 587 * image.data[p + 1] + 114 * image.data[p + 2]) / 1000);
  }
  return out;
}

function edt1d(f, n) {
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q += 1) {
    let s = 0;
    do {
      const vk = v[k];
      s = ((f[q] + q * q) - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
      if (s <= z[k]) {
        k -= 1;
      }
    } while (s <= z[k]);
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) {
      k += 1;
    }
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }

  return d;
}

function alphaDistance(image) {
  const width = image.width;
  const height = image.height;
  const inf = 1e20;
  const grid = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const a = image.data[rgbaOffset(width, x, y) + 3];
      grid[i] = a > 0 && x > 0 && y > 0 && x < width - 1 && y < height - 1 ? inf : 0;
    }
  }

  const temp = new Float32Array(width * height);
  const column = new Float32Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      column[y] = grid[y * width + x];
    }
    const d = edt1d(column, height);
    for (let y = 0; y < height; y += 1) {
      temp[y * width + x] = d[y];
    }
  }

  const out = new Float32Array(width * height);
  const row = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      row[x] = temp[y * width + x];
    }
    const d = edt1d(row, width);
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.sqrt(d[x]);
    }
  }

  return out;
}

function gaussianBlur(input, width, height, radius) {
  const sigma = radius / 3;
  if (sigma <= 0.01) {
    return new Float32Array(input);
  }

  const kernelRadius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(kernelRadius * 2 + 1);
  let total = 0;
  for (let i = -kernelRadius; i <= kernelRadius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + kernelRadius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= total;
  }

  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        sum += input[y * width + sx] * kernel[k + kernelRadius];
      }
      temp[y * width + x] = sum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        sum += temp[sy * width + x] * kernel[k + kernelRadius];
      }
      out[y * width + x] = sum;
    }
  }

  return out;
}

function calculateNormal(height, alpha, width, heightPx, depth, blurRadius, p) {
  const img = gaussianBlur(height, width, heightPx, blurRadius);
  const out = new Float32Array(width * heightPx * 3);
  const scale = depth / 100;
  const invertX = p.invertX ? -1 : 1;
  const invertY = p.invertY ? -1 : 1;
  const sample = (x, y) => img[Math.max(0, Math.min(heightPx - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const oi = i * 3;
      if (alpha[i] === 0) {
        out[oi] = 0;
        out[oi + 1] = 0;
        out[oi + 2] = 1;
        continue;
      }

      let dx = 0;
      if (x === 0) {
        dx = -3 * sample(x, y) + 4 * sample(x + 1, y) - sample(x + 2, y);
      } else if (x === width - 1) {
        dx = 3 * sample(x, y) - 4 * sample(x - 1, y) + sample(x - 2, y);
      } else {
        dx = -sample(x - 1, y) + sample(x + 1, y);
      }

      let dy = 0;
      if (y === 0) {
        dy = -3 * sample(x, y) + 4 * sample(x, y + 1) - sample(x, y + 2);
      } else if (y === heightPx - 1) {
        dy = 3 * sample(x, y) - 4 * sample(x, y - 1) + sample(x, y - 2);
      } else {
        dy = -sample(x, y - 1) + sample(x, y + 1);
      }

      out[oi] = -(dx / 255) * scale * invertX;
      out[oi + 1] = (dy / 255) * scale * invertY;
      out[oi + 2] = 1;
    }
  }

  return out;
}

function generateNormalMap(source, p) {
  const width = source.width;
  const height = source.height;
  const gray = grayscaleFromRgba(source);
  const alpha = new Uint8Array(width * height);
  const embossHeight = new Float32Array(width * height);

  for (let i = 0, px = 0; i < alpha.length; i += 1, px += 4) {
    alpha[i] = source.data[px + 3] > 0 ? 1 : 0;
    embossHeight[i] = gray[i] * 10;
  }

  const distance = alphaDistance(source);
  const bevel = new Float32Array(width * height);
  for (let i = 0; i < bevel.length; i += 1) {
    let d = p.biselDistance !== 0 ? distance[i] * 255 / p.biselDistance : (distance[i] > 0.1 ? 255 : 0);
    d = Math.max(0, Math.min(255, d));
    if (p.softBisel) {
      d = Math.sqrt(1 - (d / 255 - 1) ** 2) * 255;
    }
    bevel[i] = d;
  }

  const zeroHeight = new Float32Array(width * height);
  const emboss = calculateNormal(embossHeight, alpha, width, height, p.normalDepth, p.normalBlurRadius, p);
  const bump = calculateNormal(bevel, alpha, width, height, p.biselDepth * p.biselDistance, p.biselBlurRadius, p);
  const heightOverlay = calculateNormal(zeroHeight, alpha, width, height, 5000, 0, p);
  const normal = new ImageData(width, height);
  const invertZ = p.invertZ ? -1 : 1;

  for (let i = 0, px = 0, ni = 0; i < alpha.length; i += 1, px += 4, ni += 3) {
    const nr = emboss[ni] * 1.5 + bump[ni] * 1.5 + heightOverlay[ni];
    const ng = emboss[ni + 1] * 1.5 + bump[ni + 1] * 1.5 + heightOverlay[ni + 1];
    const nb = (emboss[ni + 2] * 1.5 + bump[ni + 2] * 1.5 + heightOverlay[ni + 2]) * invertZ;
    const len = Math.hypot(nr, ng, nb) || 1;
    normal.data[px] = Math.max(0, Math.min(255, 255 * (nr / len * 0.5 + 0.5))) | 0;
    normal.data[px + 1] = Math.max(0, Math.min(255, 255 * (ng / len * 0.5 + 0.5))) | 0;
    normal.data[px + 2] = Math.max(0, Math.min(255, 255 * (nb / len * 0.5 + 0.5))) | 0;
    normal.data[px + 3] = p.useAlpha ? source.data[px + 3] : 255;
  }

  return normal;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildLitPreview(source, normal, toon) {
  const width = source.width;
  const height = source.height;
  const lit = new ImageData(width, height);
  const light = currentLight();
  const lightZ = light.z * 1000;
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = rgbaOffset(width, x, y);
      const nx = normal.data[px] / 127.5 - 1;
      const ny = normal.data[px + 1] / 127.5 - 1;
      const nz = normal.data[px + 2] / 127.5 - 1;
      const fx = x + 0.5 - centerX;
      const fy = centerY - y - 0.5;
      const lx = light.x - fx;
      const ly = light.y - fy;
      const len = Math.hypot(lx, ly, lightZ) || 1;
      let diffuse = Math.max(0, nx * (lx / len) + ny * (ly / len) + nz * (lightZ / len));
      // Mirrors laigter/shaders/fshader.glsl toon diffuse threshold.
      if (toon) {
        diffuse = smoothstep(0.495, 0.505, diffuse);
      }
      const shade = 0.28 + diffuse * 0.86;

      lit.data[px] = Math.max(0, Math.min(255, source.data[px] * shade)) | 0;
      lit.data[px + 1] = Math.max(0, Math.min(255, source.data[px + 1] * shade)) | 0;
      lit.data[px + 2] = Math.max(0, Math.min(255, source.data[px + 2] * shade)) | 0;
      lit.data[px + 3] = source.data[px + 3];
    }
  }

  return lit;
}

function litPreview() {
  const { toon } = previewParams();
  if (toon) {
    if (!state.litToon) {
      state.litToon = buildLitPreview(state.source, state.normal, true);
    }
    return state.litToon;
  }

  if (!state.lit) {
    state.lit = buildLitPreview(state.source, state.normal, false);
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
  state.normal = generateNormalMap(state.source, params());
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
  if (key === "pixelated" || key === "toon" || key === "lightHeight") {
    continue;
  }
  input.addEventListener("input", debounceGenerate);
  input.addEventListener("change", debounceGenerate);
}

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
el.exportButton.addEventListener("click", exportPng);

for (const button of el.modeButtons) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const item of el.modeButtons) {
      item.classList.toggle("active", item === button);
    }
    drawPreview();
  });
}

window.addEventListener("resize", drawPreview);

syncOutputs();
loadSample();
