import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { Toolbar } from "./Toolbar.jsx";
import { PreviewArea } from "./PreviewArea.jsx";
import { ControlsPanel } from "./ControlsPanel.jsx";
import {
  DEFAULT_AI_CONTROLS,
  DEFAULT_LIGHT_CONTROLS,
  DEFAULT_NORMAL,
  buildNormalParams,
} from "./controls.js";
import {
  buildLightSettings,
  drawPreview,
  exportNormalPng,
  generateNormal,
  readSourceFromImage,
  canvasToLight,
} from "./previewRender.js";
import { adjustNormalMap } from "./normalAdjust.js";

const SAMPLE_SRC = "./sample.png";
const LIGHT_SPRITE_SRC = "./laigter_texture.png";
const SAMPLE_LOAD_ERROR = "Could not load sample image.";

export function App() {
  const [source, setSource] = useState(null);
  const [proceduralNormal, setProceduralNormal] = useState(null);
  const [aiOverlay, setAiOverlay] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pipeline, setPipeline] = useState("procedural"); // "procedural" | "ai"
  const [mode, setMode] = useState("split"); // preview view
  const [tab, setTab] = useState("light"); // controls tab
  const [status, setStatus] = useState("Ready");
  const [light, setLight] = useState({ x: 0, y: 0 });
  const [normalControls, setNormalControls] = useState(DEFAULT_NORMAL);
  const [lightControls, setLightControls] = useState(DEFAULT_LIGHT_CONTROLS);
  const [aiControls, setAiControls] = useState(DEFAULT_AI_CONTROLS);
  const lastRect = useRef(null);
  const draggingLight = useRef(false);
  const lightSprite = useRef(null);
  const generateTimer = useRef(0);
  const aiWorker = useRef(null);

  // The raw DeepBump output (aiOverlay) is kept pristine; live post-process
  // tweaks (strength/smooth/invert) are applied on top to produce the AI normal.
  // No re-inference — this recomputes instantly as the Adjust sliders move.
  const aiNormal = useMemo(() => {
    if (!aiOverlay) return null;
    return adjustNormalMap(aiOverlay, {
      strength: aiControls.strength / 100,
      smooth: aiControls.smooth,
      steps: aiControls.steps,
      invertX: aiControls.invertX,
      invertY: aiControls.invertY,
      invertZ: aiControls.invertZ,
    });
  }, [aiOverlay, aiControls.strength, aiControls.smooth, aiControls.steps, aiControls.invertX, aiControls.invertY, aiControls.invertZ]);

  // The active normal depends entirely on the pipeline — the procedural and AI
  // maps are never mixed. Everything downstream (Lit/Split/Normal views, Export)
  // reads this one value.
  const activeNormal = pipeline === "ai" ? aiNormal : proceduralNormal;

  // Load the light sprite once on mount so it's ready when drawPreview runs.
  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.src = LIGHT_SPRITE_SRC;
    lightSprite.current = img;
  }, []);

  const onNormalControlsChange = useCallback((patch) => {
    setNormalControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onLightControlsChange = useCallback((patch) => {
    setLightControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onAiControlsChange = useCallback((patch) => {
    setAiControls((prev) => ({ ...prev, ...patch }));
  }, []);

  // Switch pipeline, keeping the controls tab valid for the new pipeline
  // (Normal <-> AI are pipeline-specific; Light is shared).
  const onPipelineChange = useCallback((next) => {
    setPipeline(next);
    setTab((prev) => {
      if (next === "ai" && prev === "normal") return "ai";
      if (next === "procedural" && prev === "ai") return "normal";
      return prev;
    });
  }, []);

  // DeepBump AI normal — runs in a Web Worker so ONNX inference never blocks the
  // UI thread. The result is stored separately as `aiOverlay`.
  const ensureAiWorker = useCallback(() => {
    if (aiWorker.current) return aiWorker.current;
    const worker = new Worker("/deepbump.worker.js");
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "progress") {
        setStatus(msg.phase === "model" ? "AI: loading model" : `AI: tile ${msg.done}/${msg.total}`);
      } else if (msg.type === "result") {
        setAiOverlay(new ImageData(new Uint8ClampedArray(msg.data), msg.width, msg.height));
        setAiBusy(false);
        setStatus(`AI map ready - ${msg.width}x${msg.height}`);
      } else if (msg.type === "error") {
        setAiBusy(false);
        setStatus(`AI error: ${msg.message}`);
      }
    };
    worker.onerror = (err) => {
      setAiBusy(false);
      setStatus(`AI worker error: ${err.message || "failed to load"}`);
    };
    aiWorker.current = worker;
    return worker;
  }, []);

  const onGenerateAI = useCallback(() => {
    if (!source) {
      setStatus("Load an image first.");
      return;
    }
    setPipeline("ai");
    setAiBusy(true);
    setStatus("AI: starting");
    const worker = ensureAiWorker();
    const copy = source.data.slice(); // detached copy so `source` stays intact
    worker.postMessage(
      {
        type: "generate",
        image: { data: copy.buffer, width: source.width, height: source.height },
        overlap: aiControls.overlap,
        denoise: aiControls.denoise,
      },
      [copy.buffer]
    );
  }, [source, aiControls, ensureAiWorker]);

  // Terminate the worker on unmount.
  useEffect(() => () => {
    if (aiWorker.current) {
      aiWorker.current.terminate();
      aiWorker.current = null;
    }
  }, []);

  // Procedural normal — recomputed (debounced) from the source + normal sliders.
  // Pure analytic; the AI map is kept entirely separate.
  useEffect(() => {
    if (!source) return;
    clearTimeout(generateTimer.current);
    generateTimer.current = setTimeout(() => {
      const start = performance.now();
      const params = buildNormalParams(normalControls);
      setProceduralNormal(generateNormal(source, params));
      setStatus(`${source.width}x${source.height} - ${Math.round(performance.now() - start)} ms`);
    }, 40);
    return () => clearTimeout(generateTimer.current);
  }, [source, normalControls]);

  // Lit preview is rendered on the GPU by litGL (PreviewArea) — light moves
  // only update a shader uniform, so no ImageData is rebuilt per drag here.
  const drawArgs = useMemo(() => ({
    source,
    normal: activeNormal,
    mode,
    pipeline,
    light,
    lightSettings: buildLightSettings(light, lightControls),
    toon: lightControls.toon,
    pixelated: lightControls.pixelated,
    draggingLight: draggingLight.current,
    lightSprite: lightSprite.current,
    onRectChange: (rect) => { lastRect.current = rect; },
    onDragChange: (d) => { draggingLight.current = d; },
  }), [source, activeNormal, mode, pipeline, light, lightControls]);

  const onLightMove = useCallback((canvasPoint) => {
    if (!source || !lastRect.current) return;
    const next = canvasToLight(canvasPoint, source, lastRect.current);
    setLight((prev) => (prev.x === next.x && prev.y === next.y ? prev : next));
  }, [source]);

  const loadFromImage = useCallback(async (image) => {
    const data = readSourceFromImage(image);
    setSource(data);
    setAiOverlay(null); // AI map is per-image; force a regenerate for the new one
    setLight({ x: data.width * 0.4, y: data.height * 0.4 });
  }, []);

  const loadSample = useCallback(async () => {
    setStatus("Loading sample");
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = SAMPLE_SRC;
      await image.decode();
      await loadFromImage(image);
    } catch (error) {
      setStatus(error.message || SAMPLE_LOAD_ERROR);
    }
  }, [loadFromImage]);

  const onOpenFile = useCallback(async (file) => {
    if (!file) return;
    setStatus("Loading image");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      await loadFromImage(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [loadFromImage]);

  // Initial sample load.
  useEffect(() => {
    loadSample();
  }, [loadSample]);

  return (
    <main class="app">
      <Toolbar
        onOpenFile={onOpenFile}
        onLoadSample={loadSample}
        onExport={() => exportNormalPng(activeNormal)}
      />
      <section class="workspace">
        <PreviewArea
          mode={mode}
          onModeChange={setMode}
          status={status}
          drawArgs={drawArgs}
          onLightMove={onLightMove}
          lightSprite={lightSprite.current}
          lastRectRef={lastRect}
        />
        <ControlsPanel
          pipeline={pipeline}
          onPipelineChange={onPipelineChange}
          tab={tab}
          onTabChange={setTab}
          normalControls={normalControls}
          onNormalControlsChange={onNormalControlsChange}
          lightControls={lightControls}
          onLightControlsChange={onLightControlsChange}
          aiControls={aiControls}
          onAiControlsChange={onAiControlsChange}
          onGenerateAI={onGenerateAI}
          aiBusy={aiBusy}
          aiReady={!!aiOverlay}
        />
      </section>
    </main>
  );
}
