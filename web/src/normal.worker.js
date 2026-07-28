/*
 * Web Worker for normal-map generation. Runs generateNormalMap (the EDT +
 * blurs + normal blend) off the main thread. Receives { id, source, params }
 * and posts back { id, ok, ... } with the result data buffer transferred.
 * The AI overlay blend stays on main because it constructs ImageData.
 */

import { generateNormalMap } from "shared/normal.js";

self.onmessage = (e) => {
  const { id, source, params } = e.data;
  try {
    const start = performance.now();
    const { width, height, data } = generateNormalMap(source, params);
    const ms = performance.now() - start;
    self.postMessage({ id, ok: true, width, height, data, ms }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};