/*
 * DeepBump normal-map worker (GPL-3.0). Runs ONNX inference off the main thread
 * so slider drags stay smooth. Classic worker (not a module) so it can pull
 * onnxruntime-web from a CDN via importScripts and stay bundler-agnostic — it
 * works whether the app is served by Vite or by web/server.js, with no extra
 * npm deps and no COOP/COEP headers (single-threaded WASM).
 *
 * Protocol (main -> worker):
 *   { type:"generate", image:{data:ArrayBuffer, width, height}, overlap, modelUrl? }
 * Protocol (worker -> main):
 *   { type:"progress", phase, done, total }
 *   { type:"result", data:ArrayBuffer, width, height }
 *   { type:"error", message }
 */

const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// DeepBump model. Fetched once and cached (Cache API). To serve it locally
// instead, drop deepbump256.onnx next to this file and set DEFAULT_MODEL_URL to
// "/deepbump256.onnx" (`web/server.js` already serves `.onnx` as
// application/octet-stream).
const DEFAULT_MODEL_URL =
  "https://raw.githubusercontent.com/HugoTini/DeepBump/" +
  "fad19ba87daed12b1d0410a57e74f3d79e82f78d/deepbump256.onnx";
const MODEL_CACHE = "deepbump-model-v1";

importScripts(`${ORT_BASE}ort.min.js`);
importScripts("/deepbump_infer.js"); // sets self.DeepBumpInfer

// Single-threaded WASM: no SharedArrayBuffer, so no cross-origin isolation needed.
ort.env.wasm.wasmPaths = ORT_BASE;
ort.env.wasm.numThreads = 1;

let sessionPromise = null;

async function fetchModel(url) {
  // Cache the 27MB model so it only downloads once across sessions.
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(url);
      if (hit) return hit.arrayBuffer();
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`model fetch ${res.status}`);
      await cache.put(url, res.clone());
      return res.arrayBuffer();
    } catch (e) {
      // fall through to a plain fetch if Cache API is unavailable/blocked
    }
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

function getSession(modelUrl) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      postMessage({ type: "progress", phase: "model", done: 0, total: 1 });
      const buf = await fetchModel(modelUrl || DEFAULT_MODEL_URL);
      const session = await ort.InferenceSession.create(buf, {
        executionProviders: ["wasm"],
      });
      postMessage({ type: "progress", phase: "model", done: 1, total: 1 });
      return session;
    })().catch((err) => {
      sessionPromise = null; // allow retry on next generate
      throw err;
    });
  }
  return sessionPromise;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "generate") return;
  try {
    const session = await getSession(msg.modelUrl);

    const image = {
      data: new Uint8ClampedArray(msg.image.data),
      width: msg.image.width,
      height: msg.image.height,
    };

    const runTile = async (tile) => {
      const t = new ort.Tensor("float32", tile, [1, 1, 256, 256]);
      const r = await session.run({ input: t });
      return r.output.data;
    };

    const onProgress = (done, total) =>
      postMessage({ type: "progress", phase: "infer", done, total });

    const out = await self.DeepBumpInfer.colorToNormals(
      image,
      msg.overlap || "LARGE",
      runTile,
      onProgress,
      { denoise: msg.denoise || 0 }
    );

    // Transfer the pixel buffer back (zero-copy).
    postMessage(
      { type: "result", data: out.data.buffer, width: out.width, height: out.height },
      [out.data.buffer]
    );
  } catch (err) {
    postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};
