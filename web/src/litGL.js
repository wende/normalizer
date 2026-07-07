/*
 * Lit-preview WebGL2 renderer — derived from laigter/shaders/fshader.glsl
 * (view_mode==5, single light, parallax off, occlusion=1). The fragment
 * shader mirrors the per-pixel math of buildLitPreview in shared/preview.js,
 * which stays the CPU parity reference and the no-WebGL fallback.
 *
 * Why this exists: the JS loop in buildLitPreview is O(W·H) on every light
 * move. On the GPU the light is a uniform, so dragging is resolution-
 * independent. Source/normal textures are re-uploaded only when their
 * ImageData reference changes (source load, normal regen) — never on a drag.
 *
 * GPL-3.0 (derived from Laigter).
 */

import { buildLitPreview } from "shared/preview.js";
import { fitRect } from "./previewRender.js";

const VERT = `#version 300 es
in vec2 aPos;   // destination pixel coords, y-down (canvas space)
in vec2 aUV;    // 0..1 into the image texture (v=0 → image top)
uniform vec2 uCanvasSize;
out vec2 vUV;
void main() {
  vec2 clip = vec2(aPos.x / uCanvasSize.x * 2.0 - 1.0,
                   1.0 - aPos.y / uCanvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 frag;
uniform int uMode;          // 0 = passthrough, 1 = lit
uniform sampler2D uTex;     // diffuse/albedo (always the source image)
uniform sampler2D uNormal;  // tangent-space normal map
uniform vec2 uResolution;   // source pixel dims
uniform vec3 uLightPos;     // (x, y, lightZ) — x/y in pixels rel. center, lightZ already *1000
uniform vec3 uDiffuseColor;  uniform float uDiffuseIntensity;
uniform vec3 uSpecularColor; uniform float uSpecularIntensity; uniform float uSpecularScatter;
uniform vec3 uAmbientColor;  uniform float uAmbientIntensity;
uniform int uToon;
void main() {
  vec4 tex = texture(uTex, vUV);
  if (uMode == 0) { frag = tex; return; }
  vec3 n01 = texture(uNormal, vUV).rgb;
  vec3 N = vec3(n01.r * 2.0 - 1.0, n01.g * 2.0 - 1.0, n01.b * 2.0 - 1.0);
  // Match buildLitPreview's pixel grid: vUV lands on pixel centers, so
  // vUV*resolution == (px+0.5). fx = (px+0.5)-centerX, fy = centerY-(py+0.5).
  float fx = vUV.x * uResolution.x - uResolution.x * 0.5;
  float fy = uResolution.y * 0.5 - vUV.y * uResolution.y;
  vec3 L = normalize(vec3(uLightPos.x - fx, uLightPos.y - fy, uLightPos.z));
  float diff = max(0.0, dot(N, L));
  if (uToon == 1) diff = smoothstep(0.495, 0.505, diff);
  vec3 diffuse = diff * uDiffuseColor * uDiffuseIntensity;
  vec3 R = reflect(-L, N);
  float spec = pow(max(0.0, R.z), uSpecularScatter);
  if (uToon == 1) spec = smoothstep(0.005, 0.01, spec);
  vec3 specular = uSpecularIntensity * spec * uSpecularColor;
  vec3 ambient = uAmbientColor * uAmbientIntensity;
  frag = vec4(tex.rgb * (diffuse + specular + ambient), tex.a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[litGL] shader compile:", gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

/**
 * Create a WebGL2 lit-preview renderer bound to `canvas`.
 * Returns null if WebGL2 is unavailable (caller falls back to Canvas2D).
 */
export function createLitGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, antialias: false });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[litGL] program link:", gl.getProgramInfoLog(prog));
    return null;
  }

  const loc = {};
  for (const name of [
    "uCanvasSize", "uMode", "uTex", "uNormal", "uResolution", "uLightPos",
    "uDiffuseColor", "uDiffuseIntensity", "uSpecularColor", "uSpecularIntensity",
    "uSpecularScatter", "uAmbientColor", "uAmbientIntensity", "uToon",
  ]) {
    loc[name] = gl.getUniformLocation(prog, name);
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const stride = 4 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const tex = { source: gl.createTexture(), normal: gl.createTexture() };
  const ref = { source: null, normal: null };

  // Upload (or re-upload) an ImageData into its slot only when the reference
  // changes; always (re)apply the min/mag filter — cheap, and `pixelated` can
  // toggle independently of the data.
  function upload(key, image, pixelated) {
    if (!image) return;
    const t = tex[key];
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = pixelated ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (ref[key] !== image) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
      ref[key] = image;
    }
  }

  function bindUnit(unit, t) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }

  function setQuad(r) {
    const verts = new Float32Array([
      r.x, r.y, 0, 0,
      r.x + r.width, r.y, 1, 0,
      r.x, r.y + r.height, 0, 1,
      r.x + r.width, r.y + r.height, 1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  }

  function drawPassthrough(key, image, pixelated) {
    upload(key, image, pixelated);
    bindUnit(0, tex[key]);
    gl.uniform1i(loc.uTex, 0);
    gl.uniform1i(loc.uMode, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function drawLit(source, normal, settings, toon, pixelated) {
    upload("source", source, pixelated);
    upload("normal", normal, pixelated);
    bindUnit(0, tex.source);
    gl.uniform1i(loc.uTex, 0);
    bindUnit(1, tex.normal);
    gl.uniform1i(loc.uNormal, 1);
    gl.uniform1i(loc.uMode, 1);
    gl.uniform2f(loc.uResolution, source.width, source.height);
    gl.uniform3f(loc.uLightPos, settings.x, settings.y, settings.z * 1000);
    gl.uniform3fv(loc.uDiffuseColor, settings.diffuseColor);
    gl.uniform1f(loc.uDiffuseIntensity, settings.diffuseIntensity);
    gl.uniform3fv(loc.uSpecularColor, settings.specularColor);
    gl.uniform1f(loc.uSpecularIntensity, settings.specularIntensity);
    gl.uniform1f(loc.uSpecularScatter, settings.specularScatter);
    gl.uniform3fv(loc.uAmbientColor, settings.ambientColor);
    gl.uniform1f(loc.uAmbientIntensity, settings.ambientIntensity);
    gl.uniform1i(loc.uToon, toon ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Render the current mode into the canvas. Returns the fitted rect (for
   * overlay hit-testing) or null when there is nothing to draw.
   * `normal` is the active normal for the current pipeline (procedural or AI).
   */
  function draw(state) {
    const { source, normal, mode, lightSettings, toon, pixelated } = state;
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    const cw = Math.max(320, Math.round(bounds.width * ratio));
    const ch = Math.max(240, Math.round(bounds.height * ratio));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(42 / 255, 47 / 255, 44 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!source) return null;
    const needsNormal = mode !== "diffuse";
    if (needsNormal && !normal) return null; // overlay draws the AI placeholder

    const rect = fitRect(source.width, source.height, cw - 48, ch - 48);
    gl.useProgram(prog);
    gl.uniform2f(loc.uCanvasSize, cw, ch);
    gl.bindVertexArray(vao);
    setQuad(rect);

    if (mode === "diffuse") {
      drawPassthrough("source", source, pixelated);
    } else if (mode === "normal") {
      drawPassthrough("normal", normal, pixelated);
    } else if (mode === "lit") {
      drawLit(source, normal, lightSettings, toon, pixelated);
    } else {
      // split: diffuse underneath, lit over the right half.
      drawPassthrough("source", source, pixelated);
      const half = Math.round(rect.width / 2);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x + half, ch - rect.y - rect.height, rect.width - half, rect.height);
      drawLit(source, normal, lightSettings, toon, pixelated);
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.bindVertexArray(null);
    return rect;
  }

  if (import.meta.env && import.meta.env.DEV) {
    queueMicrotask(selfTest);
  }

  // Dev-only parity check: render a small fixed fixture through both the CPU
  // reference (buildLitPreview) and this shader, warn if they diverge beyond a
  // few LSB. Catches uniform/math drift between the two implementations.
  function selfTest() {
    try {
      const W = 16;
      const H = 16;
      const sd = new Uint8ClampedArray(W * H * 4);
      const nd = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i += 1) {
        const o = i * 4;
        sd[o] = (i * 53) % 256; sd[o + 1] = (i * 97) % 256; sd[o + 2] = (i * 151) % 256; sd[o + 3] = 255;
        nd[o] = 128; nd[o + 1] = 200; nd[o + 2] = 160; nd[o + 3] = 255;
      }
      const fixture = { width: W, height: H };
      const source = { ...fixture, data: sd };
      const normal = { ...fixture, data: nd };
      const settings = {
        x: 3.2, y: -1.5, z: 0.66,
        diffuseColor: [0.2, 0.9, 0.6], diffuseIntensity: 0.7,
        specularColor: [0.3, 0.8, 0.5], specularIntensity: 0.5, specularScatter: 24,
        ambientColor: [0.9, 0.9, 0.95], ambientIntensity: 0.6,
      };
      const cpu = buildLitPreview(source, normal, settings, false);

      const off = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, off);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, off, 0);

      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);
      gl.uniform2f(loc.uCanvasSize, W, H);
      gl.bindVertexArray(vao);
      setQuad({ x: 0, y: 0, width: W, height: H });
      drawLit(source, normal, settings, false, false);

      const gpu = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, gpu);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(off);
      gl.bindVertexArray(null);

      // readPixels is bottom-up; CPU data is top-down — flip while comparing.
      let max = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          for (let c = 0; c < 4; c += 1) {
            const d = Math.abs(cpu.data[(y * W + x) * 4 + c] - gpu[((H - 1 - y) * W + x) * 4 + c]);
            if (d > max) max = d;
          }
        }
      }
      // Force a re-upload of the real textures on the next draw (the self-test
      // polluted the slot caches with the fixture).
      ref.source = null;
      ref.normal = null;
      if (max > 3) {
        console.warn(`[litGL] shader/CPU parity delta = ${max} (expected ≤3 LSB)`);
      } else {
        console.info(`[litGL] parity ok (max channel delta ${max})`);
      }
    } catch (err) {
      console.warn("[litGL] selfTest failed:", err);
    }
  }

  return { draw };
}
