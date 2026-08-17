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
import {
  buildExportArchive,
  downloadZip,
  imageDataToPngBytes,
  singleMapFilename,
} from "./exportPack.js";
import {
  buildProjectArchive,
  downloadProject,
  pngBytesToImageData,
  suggestProjectFilename,
  unpackProjectArchive,
} from "./projectFile.js";
import { detectPixelSize, pixelateNormalMap } from "shared/pixelScale.js";

const SAMPLE_SRC = "./demo.png";
const SAMPLE_AI_NORMAL_SRC = "./demo_ai_normal.png";
const SAMPLE_LOAD_ERROR = "Could not load sample image.";
const SAMPLE_BASE_NAME = "demo";
const HYDRATE_SKIP_MS = 100;

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
  const [normalControls, setNormalControls] = useState(DEFAULT_NORMAL);
  const [specularControls, setSpecularControls] = useState(DEFAULT_SPECULAR);
  const [parallaxControls, setParallaxControls] = useState(DEFAULT_PARALLAX);
  const [occlusionControls, setOcclusionControls] = useState(DEFAULT_OCCLUSION);
  const [lightControls, setLightControls] = useState(DEFAULT_LIGHT_CONTROLS);
  const [aiControls, setAiControls] = useState(DEFAULT_AI_CONTROLS);
  const [sourceName, setSourceName] = useState(SAMPLE_BASE_NAME);
  const [exportPackBusy, setExportPackBusy] = useState(false);
  const [projectFilename, setProjectFilename] = useState("project.normalizer");
  const lastRect = useRef(null);
  const draggingLight = useRef(false);
  const generateTimer = useRef(0);
  const specularTimer = useRef(0);
  const parallaxTimer = useRef(0);
  const occlusionTimer = useRef(0);
  const aiWorker = useRef(null);
  // When hydrating a .normalizer, skip the next recompute ticks so embedded
  // maps are not overwritten by a regenerate from the restored sliders.
  const ignoreRecompute = useRef(false);
  const ignoreRecomputeTimer = useRef(0);

  const beginHydrate = useCallback(() => {
    ignoreRecompute.current = true;
    clearTimeout(generateTimer.current);
    clearTimeout(specularTimer.current);
    clearTimeout(parallaxTimer.current);
    clearTimeout(occlusionTimer.current);
    clearTimeout(ignoreRecomputeTimer.current);
    ignoreRecomputeTimer.current = setTimeout(() => {
      ignoreRecompute.current = false;
    }, HYDRATE_SKIP_MS);
  }, []);

  // The raw DeepBump output (aiOverlay) is kept pristine; live post-process
  // tweaks (strength/smooth/steps/pixelSize) are applied on top to produce the
  // AI normal. No re-inference — this recomputes instantly as sliders move.
  const aiNormal = useMemo(() => {
    if (!aiOverlay) return null;
    return adjustNormalMap(aiOverlay, {
      strength: aiControls.strength / 100,
      smooth: aiControls.smooth,
      steps: aiControls.steps,
      pixelSize: lightControls.pixelSize,
    });
  }, [aiOverlay, aiControls.strength, aiControls.smooth, aiControls.steps, lightControls.pixelSize]);

  // Procedural normals already honour pixelSize inside generateNormalMap; snap
  // again so AI and procedural share the same block-facet look (idempotent when
  // already block-constant). Also covers any worker path that omitted the flag.
  const proceduralDisplay = useMemo(() => {
    if (!proceduralNormal) return null;
    if (!(lightControls.pixelSize > 1)) return proceduralNormal;
    const snapped = pixelateNormalMap(proceduralNormal, lightControls.pixelSize);
    return new ImageData(snapped.data, snapped.width, snapped.height);
  }, [proceduralNormal, lightControls.pixelSize]);

  // The active normal depends entirely on the pipeline — the procedural and AI
  // maps are never mixed. Everything downstream (Lit/Split/Normal views, Export)
  // reads this one value.
  const activeNormal = pipeline === "ai" ? aiNormal : proceduralDisplay;

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
    if (!source || ignoreRecompute.current) return;
    clearTimeout(generateTimer.current);
    generateTimer.current = setTimeout(() => {
      if (ignoreRecompute.current) return;
      const params = buildNormalParams(normalControls, lightControls.pixelSize);
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
  }, [source, normalControls, lightControls.pixelSize]);

  // Specular map — recomputed (debounced) from the source + specular sliders.
  useEffect(() => {
    if (!source || ignoreRecompute.current) return;
    clearTimeout(specularTimer.current);
    specularTimer.current = setTimeout(() => {
      if (ignoreRecompute.current) return;
      const params = buildSpecularParams(specularControls, lightControls.pixelSize);
      setSpecularMap(generateSpecular(source, params));
    }, 40);
    return () => clearTimeout(specularTimer.current);
  }, [source, specularControls, lightControls.pixelSize]);

  // Parallax map — recomputed (debounced) from the source + parallax sliders.
  useEffect(() => {
    if (!source || ignoreRecompute.current) return;
    clearTimeout(parallaxTimer.current);
    parallaxTimer.current = setTimeout(() => {
      if (ignoreRecompute.current) return;
      const params = buildParallaxParams(parallaxControls, lightControls.pixelSize);
      setParallaxMap(generateParallax(source, params));
    }, 40);
    return () => clearTimeout(parallaxTimer.current);
  }, [source, parallaxControls, lightControls.pixelSize]);
  // Occlusion map — recomputed (debounced) from the source + occlusion sliders.
  useEffect(() => {
    if (!source || ignoreRecompute.current) return;
    clearTimeout(occlusionTimer.current);
    occlusionTimer.current = setTimeout(() => {
      if (ignoreRecompute.current) return;
      const params = buildOcclusionParams(occlusionControls, lightControls.pixelSize);
      setOcclusionMap(generateOcclusion(source, params));
    }, 40);
    return () => clearTimeout(occlusionTimer.current);
  }, [source, occlusionControls, lightControls.pixelSize]);

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
    pixelated: lightControls.pixelated || lightControls.pixelSize > 1,
    draggingLight: draggingLight.current,
    draggingSplit,
    onRectChange: (rect) => { lastRect.current = rect; },
    onDragChange: (d) => { draggingLight.current = d; },
    onSplitDragChange: setDraggingSplit,
  }), [
    source, activeNormal, specularMap, parallaxMap, occlusionMap,
    mode, pipeline, light, viewTilt, parallaxControls.previewParallaxDepth,
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

  const loadFromImage = useCallback(async (image, { aiNormalImage = null, baseName = SAMPLE_BASE_NAME } = {}) => {
    const data = readSourceFromImage(image);
    // Auto-detect nearest-neighbour art scale from solid-color run GCDs so Soft
    // / Blur respect fake resolution without a manual Pixel size tweak.
    const detected = detectPixelSize(data, { tolerance: 2 });
    setSource(data);
    setSourceName(baseName);
    setProjectFilename(suggestProjectFilename(baseName));
    setLightControls((prev) => {
      const next = {
        ...prev,
        pixelSize: detected,
        // Crisp preview filtering whenever art-scale maps are in play.
        ...(detected > 1 ? { pixelated: true } : {}),
      };
      return prev.pixelSize === next.pixelSize && prev.pixelated === next.pixelated
        ? prev
        : next;
    });
    // Sample ships a precomputed DeepBump map; uploads clear AI until regenerate.
    setAiOverlay(aiNormalImage ? readSourceFromImage(aiNormalImage) : null);
    if (aiNormalImage) setPipeline("ai");
    setLight({ x: data.width * 0.4, y: data.height * 0.4 });
    setViewTilt({ x: 0, y: 0 });
    return { width: data.width, height: data.height, pixelSize: detected };
  }, []);

  const loadSample = useCallback(async () => {
    setStatus("Loading sample");
    try {
      const [image, aiNormalImage] = await Promise.all([
        decodeImage(SAMPLE_SRC),
        decodeImage(SAMPLE_AI_NORMAL_SRC),
      ]);
      const { width, height, pixelSize } = await loadFromImage(image, {
        aiNormalImage,
        baseName: SAMPLE_BASE_NAME,
      });
      const scaleNote = pixelSize > 1 ? `, pixel size ${pixelSize}×` : "";
      setStatus(`${width}x${height} - sample ready${scaleNote}`);
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
      const { width, height, pixelSize } = await loadFromImage(image, {
        baseName: file.name || SAMPLE_BASE_NAME,
      });
      const scaleNote = pixelSize > 1 ? `, pixel size ${pixelSize}×` : "";
      setStatus(`${width}x${height}${scaleNote}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [loadFromImage]);

  const onExportPng = useCallback(() => {
    const base = sourceName || SAMPLE_BASE_NAME;
    if (mode === "specular") return exportPng(specularMap, singleMapFilename(base, "specular"));
    if (mode === "parallax") return exportPng(parallaxMap, singleMapFilename(base, "height"));
    if (mode === "occlusion") return exportPng(occlusionMap, singleMapFilename(base, "occlusion"));
    if (mode === "base") return exportPng(source, singleMapFilename(base, "albedo"));
    return exportPng(activeNormal, singleMapFilename(base, "normal"));
  }, [mode, sourceName, source, specularMap, parallaxMap, occlusionMap, activeNormal]);

  const onExportPack = useCallback(async () => {
    if (!source) {
      setStatus("Load an image first.");
      return;
    }
    if (exportPackBusy) return;
    setExportPackBusy(true);
    setStatus("Building export pack…");
    try {
      const { bytes, filename } = await buildExportArchive({
        baseName: sourceName || SAMPLE_BASE_NAME,
        images: {
          albedo: source,
          normal: activeNormal || null,
          height: parallaxMap || null,
          occlusion: occlusionMap || null,
          specular: specularMap || null,
        },
        encodePng: imageDataToPngBytes,
      });
      downloadZip(bytes, filename);
      setStatus(`Exported ${filename}`);
    } catch (error) {
      setStatus(error.message || "Export pack failed");
    } finally {
      setExportPackBusy(false);
    }
  }, [
    source, sourceName, activeNormal, parallaxMap, occlusionMap, specularMap, exportPackBusy,
  ]);

  const onSaveProject = useCallback(async () => {
    if (!source) {
      setStatus("Load an image first.");
      return;
    }
    setStatus("Saving project…");
    try {
      const bytes = await buildProjectArchive({
        source,
        proceduralNormal,
        specularMap,
        parallaxMap,
        occlusionMap,
        aiOverlay,
        pipeline,
        tab,
        mode,
        splitRatio,
        light,
        viewTilt,
        normalControls,
        lightControls,
        aiControls,
        specularControls,
        parallaxControls,
        occlusionControls,
      }, imageDataToPngBytes);
      downloadProject(bytes, projectFilename);
      setStatus(`Saved ${projectFilename}`);
    } catch (error) {
      setStatus(error.message || "Save project failed");
    }
  }, [
    source, proceduralNormal, specularMap, parallaxMap, occlusionMap, aiOverlay,
    pipeline, tab, mode, splitRatio, light, viewTilt,
    normalControls, lightControls, aiControls, specularControls, parallaxControls, occlusionControls,
    projectFilename,
  ]);

  const onOpenProject = useCallback(async (file) => {
    if (!file) return;
    setStatus("Loading project…");
    try {
      const buffer = await file.arrayBuffer();
      const { meta, pngBytes } = unpackProjectArchive(buffer);
      const decode = async (bytes) => (bytes ? pngBytesToImageData(bytes) : null);
      const [
        sourceImage,
        normalImage,
        specularImage,
        parallaxImage,
        occlusionImage,
        aiImage,
      ] = await Promise.all([
        decode(pngBytes.source),
        decode(pngBytes.normal),
        decode(pngBytes.specular),
        decode(pngBytes.parallax),
        decode(pngBytes.occlusion),
        decode(pngBytes.aiNormal),
      ]);
      if (!sourceImage) throw new Error("Project is missing source.png");

      beginHydrate();
      setSource(sourceImage);
      setSourceName(file.name || SAMPLE_BASE_NAME);
      setProceduralNormal(normalImage);
      setSpecularMap(specularImage);
      setParallaxMap(parallaxImage);
      setOcclusionMap(occlusionImage);
      setAiOverlay(aiImage);
      setPipeline(meta.pipeline);
      setTab(meta.tab);
      setMode(meta.mode);
      setSplitRatio(meta.splitRatio);
      setLight(meta.light);
      setViewTilt(meta.viewTilt);
      setNormalControls({ ...DEFAULT_NORMAL, ...meta.normal });
      setLightControls({ ...DEFAULT_LIGHT_CONTROLS, ...meta.lightControls });
      setAiControls({ ...DEFAULT_AI_CONTROLS, ...meta.ai });
      setSpecularControls({ ...DEFAULT_SPECULAR, ...meta.specular });
      setParallaxControls({ ...DEFAULT_PARALLAX, ...meta.parallax });
      setOcclusionControls({ ...DEFAULT_OCCLUSION, ...meta.occlusion });
      setProjectFilename(suggestProjectFilename(file.name));
      setStatus(`${sourceImage.width}x${sourceImage.height} - project loaded`);
    } catch (error) {
      setStatus(error.message || "Open project failed");
    }
  }, [beginHydrate]);

  // Initial sample load.
  useEffect(() => {
    loadSample();
  }, [loadSample]);

  return (
    <main class="app">
      <Toolbar
        onOpenFile={onOpenFile}
        onOpenProject={onOpenProject}
        onLoadSample={loadSample}
        onSaveProject={onSaveProject}
        canSaveProject={!!source}
        onExport={onExportPng}
        onExportPack={onExportPack}
        exportPackBusy={exportPackBusy}
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
            onSplitRatioChange={onSplitRatioChange}
            splitRatio={splitRatio}
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
