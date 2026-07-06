import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { Toolbar } from "./Toolbar.jsx";
import { PreviewArea } from "./PreviewArea.jsx";
import { ControlsPanel } from "./ControlsPanel.jsx";
import {
  DEFAULT_LIGHT_CONTROLS,
  DEFAULT_NORMAL,
  buildNormalParams,
  loadAiSettings,
} from "./controls.js";
import {
  buildLightSettings,
  drawPreview,
  exportNormalPng,
  generateNormal,
  readSourceFromImage,
  renderLit,
  canvasToLight,
} from "./previewRender.js";

const SAMPLE_SRC = "./sample.png";
const LIGHT_SPRITE_SRC = "./laigter_texture.png";

const SAMPLE_LOAD_ERROR = "Could not load sample image.";

export function App() {
  const [source, setSource] = useState(null);
  const [normal, setNormal] = useState(null);
  const [aiOverlay, setAiOverlay] = useState(null);
  const [lit, setLit] = useState(null);
  const [litToon, setLitToon] = useState(null);
  const [mode, setMode] = useState("split");
  const [tab, setTab] = useState("light");
  const [status, setStatus] = useState("Ready");
  const [light, setLight] = useState({ x: 0, y: 0 });
  const [normalControls, setNormalControls] = useState(DEFAULT_NORMAL);
  const [lightControls, setLightControls] = useState(DEFAULT_LIGHT_CONTROLS);
  const lastRect = useRef(null);
  const draggingLight = useRef(false);
  const lightSprite = useRef(null);
  const generateTimer = useRef(0);
  const litTimer = useRef(0);

  // Load the light sprite once on mount so it's ready when drawPreview runs.
  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.src = LIGHT_SPRITE_SRC;
    lightSprite.current = img;
  }, []);

  // Load AI settings from localStorage on mount. The values are referenced by
  // future AI features, not the lit preview, so this just warms the storage.
  useEffect(() => {
    loadAiSettings();
  }, []);

  // Stable per-change handlers — debounce the heavier generate path, redraw
  // the lit preview immediately on light-control changes.
  const onNormalControlsChange = useCallback((patch) => {
    setNormalControls((prev) => ({ ...prev, ...patch }));
  }, []);

  const onLightControlsChange = useCallback((patch) => {
    setLightControls((prev) => ({ ...prev, ...patch }));
  }, []);

  // Re-run normal generation when the source or normal-map controls change.
  // Debounced at 40ms to coalesce slider drags.
  useEffect(() => {
    if (!source) return;
    clearTimeout(generateTimer.current);
    generateTimer.current = setTimeout(() => {
      const start = performance.now();
      const params = buildNormalParams(normalControls);
      const next = generateNormal(source, params, aiOverlay, 0.65);
      setNormal(next);
      setLit(null);
      setLitToon(null);
      setStatus(`${source.width}x${source.height} - ${Math.round(performance.now() - start)} ms`);
    }, 40);
    return () => clearTimeout(generateTimer.current);
  }, [source, normalControls, aiOverlay]);

  // Light-control changes invalidate the cached lit preview; debounce slightly
  // to coalesce slider drags but redraw promptly on color picker changes.
  useEffect(() => {
    setLit(null);
    setLitToon(null);
  }, [lightControls]);

  // Compute lit preview lazily — built fresh when source/normal/light change.
  const litCache = useMemo(() => {
    if (!source || !normal) return null;
    const settings = buildLightSettings(light, lightControls);
    return lightControls.toon ? renderLit(source, normal, settings, true) : renderLit(source, normal, settings, false);
  }, [source, normal, light, lightControls]);

  const drawArgs = useMemo(() => ({
    source,
    normal,
    litCache: lightControls.toon ? litToon || litCache : litCache,
    litToonCache: lightControls.toon ? litCache : null,
    aiOverlay,
    mode,
    light,
    pixelated: lightControls.pixelated,
    draggingLight: draggingLight.current,
    lightSprite: lightSprite.current,
    lastRect: lastRect.current,
    onRectChange: (rect) => { lastRect.current = rect; },
    onDragChange: (d) => { draggingLight.current = d; },
  }), [source, normal, litCache, litToon, aiOverlay, mode, light, lightControls]);

  const onLightMove = useCallback((canvasPoint) => {
    if (!source || !lastRect.current) return;
    const next = canvasToLight(canvasPoint, source, lastRect.current);
    setLight((prev) => {
      if (prev.x === next.x && prev.y === next.y) return prev;
      return next;
    });
  }, [source]);

  const loadFromImage = useCallback(async (image) => {
    const data = readSourceFromImage(image);
    setSource(data);
    setAiOverlay(null);
    setLit(null);
    setLitToon(null);
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
        onExport={() => exportNormalPng(normal)}
      />
      <section class="workspace">
        <PreviewArea
          mode={mode}
          onModeChange={setMode}
          status={status}
          drawArgs={drawArgs}
          onLightMove={onLightMove}
          lightSprite={lightSprite.current}
        />
        <ControlsPanel
          tab={tab}
          onTabChange={setTab}
          normalControls={normalControls}
          onNormalControlsChange={onNormalControlsChange}
          lightControls={lightControls}
          onLightControlsChange={onLightControlsChange}
        />
      </section>
    </main>
  );
}