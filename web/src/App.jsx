import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { Toolbar } from "./Toolbar.jsx";
import { PreviewTabBar } from "./PreviewTabBar.jsx";
import { PreviewArea } from "./PreviewArea.jsx";
import { ControlsPanel } from "./ControlsPanel.jsx";
import {
  DEFAULT_AI_CONTROLS,
  DEFAULT_LIGHT_CONTROLS,
  DEFAULT_NORMAL,
  DEFAULT_SPECULAR,
  DEFAULT_PARALLAX,
  DEFAULT_OCCLUSION,
  buildNormalParams,
  buildSpecularParams,
  buildParallaxParams,
  buildOcclusionParams,
} from "./controls.js";
import {
  buildLightSettings,
  drawPreview,
  exportPng,
  generateSpecular,
  generateParallax,
  generateOcclusion,
  readSourceFromImage,
  canvasToLight,
} from "./previewRender.js";
import { adjustNormalMap } from "./normalAdjust.js";
import { useNormalWorker } from "./useNormalWorker.js";

const SAMPLE_SRC = "./demo.png";
const SAMPLE_AI_NORMAL_SRC = "./demo_ai_normal.png";
const LIGHT_SPRITE_SRC = "./laigter_texture.png";
const SAMPLE_LOAD_ERROR = "Could not load sample image.";

async function decodeImage(src) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

export function App() {
  const [source, setSource] = useState(null);
  const [proceduralNormal, setProceduralNormal] = useState(null);
  const [specularMap, setSpecularMap] = useState(null);
  const [parallaxMap, setParallaxMap] = useState(null);
  const [occlusionMap, setOcclusionMap] = useState(null);
  const [aiOverlay, setAiOverlay] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pipeline, setPipeline] = useState("ai"); // "procedural" | "ai"
  const [mode, setMode] = useState("split"); // preview view
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [tab, setTab] = useState("light"); // controls tab
  const [status, setStatus] = useState("Ready");
  const [light, setLight] = useState({ x: 0, y: 0 });
  const [viewTilt, setViewTilt] = useState({ x: 0, y: 0 });
  const [shadowContact, setShadowContact] = useState({ x: 0.5, y: 1 });
  const [normalControls, setNormalControls] = useState(DEFAULT_NORMAL);
  const [specularControls, setSpecularControls] = useState(DEFAULT_SPECULAR);
  const [parallaxControls, setParallaxControls] = useState(DEFAULT_PARALLAX);
  const [occlusionControls, setOcclusionControls] = useState(DEFAULT_OCCLUSION);
  const [lightControls, setLightControls] = useState(DEFAULT_LIGHT_CONTROLS);
  const [aiControls, setAiControls] = useState(DEFAULT_AI_CONTROLS);
  const lastRect = useRef(null);
  const draggingLight = useRef(false);
  const lightSprite = useRef(null);
  const generateTimer = useRef(0);
  const specularTimer = useRef(0);
  const parallaxTimer = useRef(0);
  const occlusionTimer = useRef(0);
  const aiWorker = useRef(null);

  // The raw DeepBump output (aiOverlay) is kept pristine; live post-process
  // tweaks (strength/smooth/steps) are applied on top to produce the AI normal.
  // No re-inference — this recomputes instantly as the Adjust sliders move.
  const aiNormal = useMemo(() => {
    if (!aiOverlay) return null;
    return adjustNormalMap(aiOverlay, {
      strength: aiControls.strength / 100,
      smooth: aiControls.smooth,
      steps: aiControls.steps,
    });
  }, [aiOverlay, aiControls.strength, aiControls.smooth, aiControls.steps]);

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
  const onSpecularControlsChange = useCallback((patch) => {
    setSpecularControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onParallaxControlsChange = useCallback((patch) => {
    setParallaxControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onOcclusionControlsChange = useCallback((patch) => {
    setOcclusionControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onLightControlsChange = useCallback((patch) => {
    setLightControls((prev) => ({ ...prev, ...patch }));
  }, []);
  const onAiControlsChange = useCallback((patch) => {
    setAiControls((prev) => ({ ...prev, ...patch }));
  }, []);

  // Switch pipeline, keeping the controls tab valid for the new pipeline
  // (Normal <-> AI are pipeline-specific; Light and Specular are shared).
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
  // The expensive EDT + blurs run in a Web Worker (normal.worker.js) so slider
  // drags never block the UI thread; the AI map is kept entirely separate.
  const { request: requestNormal } = useNormalWorker();
  useEffect(() => {
    if (!source) return;
    clearTimeout(generateTimer.current);
    generateTimer.current = setTimeout(() => {
      const params = buildNormalParams(normalControls);
      requestNormal(
        { width: source.width, height: source.height, data: source.data },
        params,
      ).then((res) => {
        if (!res.ok) {
          setStatus(`normal error: ${res.error}`);
          return;
        }
        setProceduralNormal(new ImageData(new Uint8ClampedArray(res.data), res.width, res.height));
        setStatus(`${source.width}x${source.height} - ${Math.round(res.ms)} ms`);
      });
    }, 40);
    return () => clearTimeout(generateTimer.current);
  }, [source, normalControls]);

  // Specular map — recomputed (debounced) from the source + specular sliders.
  useEffect(() => {
    if (!source) return;
    clearTimeout(specularTimer.current);
    specularTimer.current = setTimeout(() => {
      const params = buildSpecularParams(specularControls);
      setSpecularMap(generateSpecular(source, params));
    }, 40);
    return () => clearTimeout(specularTimer.current);
  }, [source, specularControls]);

  // Parallax map — recomputed (debounced) from the source + parallax sliders.
  useEffect(() => {
    if (!source) return;
    clearTimeout(parallaxTimer.current);
    parallaxTimer.current = setTimeout(() => {
      const params = buildParallaxParams(parallaxControls);
      setParallaxMap(generateParallax(source, params));
    }, 40);
    return () => clearTimeout(parallaxTimer.current);
  }, [source, parallaxControls]);
  // Occlusion map — recomputed (debounced) from the source + occlusion sliders.
  useEffect(() => {
    if (!source) return;
    clearTimeout(occlusionTimer.current);
    occlusionTimer.current = setTimeout(() => {
      const params = buildOcclusionParams(occlusionControls);
      setOcclusionMap(generateOcclusion(source, params));
    }, 40);
    return () => clearTimeout(occlusionTimer.current);
  }, [source, occlusionControls]);

  // Lit preview is rendered on the GPU by litGL (PreviewArea) — light moves
  // only update a shader uniform, so no ImageData is rebuilt per drag here.
  const drawArgs = useMemo(() => ({
    source,
    normal: activeNormal,
    specular: specularMap,
    parallax: parallaxMap,
    occlusion: occlusionMap,
    mode,
    pipeline,
    light,
    viewTilt,
    heightScale: parallaxControls.previewParallaxDepth / 1000,
    splitRatio,
    lightSettings: buildLightSettings(light, lightControls),
    toon: lightControls.toon,
    pixelated: lightControls.pixelated,
    shadow: {
      enabled: lightControls.shadowEnabled,
      casterHeight: lightControls.shadowCasterHeight,
      opacity: lightControls.shadowOpacity,
      softness: lightControls.shadowSoftness,
      contact: shadowContact,
    },
    draggingLight: draggingLight.current,
    draggingSplit,
    lightSprite: lightSprite.current,
    onRectChange: (rect) => { lastRect.current = rect; },
    onDragChange: (d) => { draggingLight.current = d; },
    onSplitDragChange: setDraggingSplit,
  }), [
    source, activeNormal, specularMap, parallaxMap, occlusionMap,
    mode, pipeline, light, viewTilt, shadowContact, parallaxControls.previewParallaxDepth,
    splitRatio, draggingSplit, lightControls,
  ]);

  const onSplitRatioChange = useCallback((next) => {
    setSplitRatio((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
  }, []);

  const onLightMove = useCallback((canvasPoint) => {
    if (!source || !lastRect.current) return;
    const next = canvasToLight(canvasPoint, source, lastRect.current);
    setLight((prev) => (prev.x === next.x && prev.y === next.y ? prev : next));
  }, [source]);

  const onViewTilt = useCallback((patch) => {
    setViewTilt((prev) => {
      const next = { ...prev, ...patch };
      if (prev.x === next.x && prev.y === next.y) return prev;
      return next;
    });
  }, []);

  const onShadowContactMove = useCallback((next) => {
    setShadowContact(next);
  }, []);

  const loadFromImage = useCallback(async (image, { aiNormalImage = null } = {}) => {
    const data = readSourceFromImage(image);
    setSource(data);
    // Sample ships a precomputed DeepBump map; uploads clear AI until regenerate.
    setAiOverlay(aiNormalImage ? readSourceFromImage(aiNormalImage) : null);
    if (aiNormalImage) setPipeline("ai");
    setLight({ x: data.width * 0.4, y: data.height * 0.4 });
    setViewTilt({ x: 0, y: 0 });
    setShadowContact({ x: 0.5, y: 1 });
  }, []);

  const loadSample = useCallback(async () => {
    setStatus("Loading sample");
    try {
      const [image, aiNormalImage] = await Promise.all([
        decodeImage(SAMPLE_SRC),
        decodeImage(SAMPLE_AI_NORMAL_SRC),
      ]);
      await loadFromImage(image, { aiNormalImage });
      setStatus(`${image.naturalWidth}x${image.naturalHeight} - sample ready`);
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
        onExport={() => {
          if (mode === "specular") return exportPng(specularMap, "laigter-specular.png");
          if (mode === "parallax") return exportPng(parallaxMap, "laigter-parallax.png");
          if (mode === "occlusion") return exportPng(occlusionMap, "laigter-occlusion.png");
          return exportPng(activeNormal, "laigter-normal.png");
        }}
      />
      <PreviewTabBar
        mode={mode}
        onModeChange={setMode}
        status={status}
      />
      <section class="workspace">
          <PreviewArea
            drawArgs={drawArgs}
            onLightMove={onLightMove}
            onViewTilt={onViewTilt}
            onShadowContactMove={onShadowContactMove}
            onSplitRatioChange={onSplitRatioChange}
            splitRatio={splitRatio}
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
          specularControls={specularControls}
          onSpecularControlsChange={onSpecularControlsChange}
          parallaxControls={parallaxControls}
          onParallaxControlsChange={onParallaxControlsChange}
          occlusionControls={occlusionControls}
          onOcclusionControlsChange={onOcclusionControlsChange}
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
