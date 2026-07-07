/*
 * Preact hook that owns the normal-map Web Worker. Exposes a single
 * request(source, params) that resolves with { ok, width, height, data, ms }
 * (or { ok: false, error }). Only one request is in flight at a time; a
 * fresh request() supersedes the prior pending one — its resolve is dropped
 * and any late reply from the worker is ignored by id.
 */

import { useCallback, useEffect, useRef } from "preact/hooks";
import NormalWorker from "./normal.worker.js?worker";

export function useNormalWorker() {
  const workerRef = useRef(null);
  const idRef = useRef(0);
  const pendingRef = useRef(null); // { id, resolve, start }

  useEffect(() => {
    const w = new NormalWorker();
    workerRef.current = w;
    w.onmessage = (e) => {
      const pending = pendingRef.current;
      // Stale response (a newer request was issued) → drop.
      if (!pending || e.data.id !== pending.id) return;
      pendingRef.current = null;
      const ms = performance.now() - pending.start; // round-trip on main
      pending.resolve({ ...e.data, ms });
    };
    w.onerror = (e) => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      pending.resolve({
        id: pending.id,
        ok: false,
        error: e.message || "worker error",
        ms: 0,
      });
    };
    return () => {
      w.terminate();
      workerRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  const request = useCallback((source, params) => new Promise((resolve) => {
    const w = workerRef.current;
    if (!w) { resolve({ ok: false, error: "worker not ready", ms: 0 }); return; }
    idRef.current += 1;
    const id = idRef.current;
    pendingRef.current = { id, resolve, start: performance.now() };
    w.postMessage({ id, source, params });
  }), []);

  return { request };
}