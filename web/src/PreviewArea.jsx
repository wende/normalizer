import { useEffect, useRef } from "preact/hooks";
import {
  canvasPointFromEvent,
  drawAiPlaceholder,
  drawLightHandle,
  drawPreview,
  pointHitsLight,
  renderLit,
} from "./previewRender.js";
import { createLitGL } from "./litGL.js";

const MODES = [
  { id: "split", label: "Split" },
  { id: "lit", label: "Lit" },
  { id: "normal", label: "Normal" },
  { id: "diffuse", label: "Diffuse" },
];

// Canvas2D overlay painted on top of the WebGL canvas: just the light handle,
// the split divider, and the AI "not generated yet" hint. Transparent except
// for these, so the GPU image shows through.
function drawOverlay(octx, canvas, drawArgs, rect) {
  octx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rect) {
    if (drawArgs.mode !== "diffuse" && drawArgs.pipeline === "ai") {
      drawAiPlaceholder(octx, canvas);
    }
    return;
  }
  if (drawArgs.mode === "split") {
    const ratio = window.devicePixelRatio || 1;
    const x = rect.x + Math.round(rect.width / 2);
    octx.strokeStyle = "#fffefa";
    octx.lineWidth = Math.max(1, Math.round(2 * ratio));
    octx.beginPath();
    octx.moveTo(x, rect.y);
    octx.lineTo(x, rect.y + rect.height);
    octx.stroke();
  }
  drawLightHandle(octx, drawArgs.light, drawArgs.source, rect, drawArgs.draggingLight, drawArgs.lightSprite);
}

// No-WebGL2 fallback: render lit pixels on the CPU and draw everything onto
// the single overlay canvas. Same speed as before — only hits machines that
// can't acquire a WebGL2 context.
function cpuFallback(overlay, octx, drawArgs) {
  const { source, normal, mode, pipeline, light, pixelated, draggingLight, lightSprite, lightSettings, toon } = drawArgs;
  const litCache = source && normal ? renderLit(source, normal, lightSettings, toon) : null;
  return drawPreview({
    canvas: overlay,
    ctx: octx,
    source,
    normal,
    litCache,
    mode,
    pipeline,
    light,
    pixelated,
    draggingLight,
    lightSprite,
  });
}

function paintAll(glRef, glInitRef, glCanvas, overlay, drawArgs) {
  if (!glCanvas || !overlay) return;
  if (!glInitRef.current) {
    glRef.current = createLitGL(glCanvas);
    glInitRef.current = true;
  }
  const gl = glRef.current;
  const octx = overlay.getContext("2d");
  let rect;
  if (gl) {
    rect = gl.draw({
      source: drawArgs.source,
      normal: drawArgs.normal,
      mode: drawArgs.mode,
      lightSettings: drawArgs.lightSettings,
      toon: drawArgs.toon,
      pixelated: drawArgs.pixelated,
    });
    if (overlay.width !== glCanvas.width || overlay.height !== glCanvas.height) {
      overlay.width = glCanvas.width;
      overlay.height = glCanvas.height;
    }
    drawOverlay(octx, overlay, drawArgs, rect);
  } else {
    rect = cpuFallback(overlay, octx, drawArgs);
  }
  drawArgs.onRectChange(rect);
}

export function PreviewArea({
  mode,
  onModeChange,
  status,
  drawArgs,
  onLightMove,
  lightSprite,
  lastRectRef,
}) {
  const glCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const glInitRef = useRef(false);
  const dragState = useRef({ dragging: false, pointerId: null });

  // Imperative redraw on every relevant state change. drawArgs is rebuilt by
  // App on every render so this effect always runs with the latest snapshot.
  useEffect(() => {
    paintAll(glRef, glInitRef, glCanvasRef.current, canvasRef.current, drawArgs);
  }, [drawArgs]);

  // Resize-driven redraw — Preact won't see browser resize events.
  useEffect(() => {
    const handle = () => paintAll(glRef, glInitRef, glCanvasRef.current, canvasRef.current, drawArgs);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [drawArgs]);

  const eventPoint = (e) => canvasPointFromEvent(canvasRef.current, e);

  const handlePointerDown = (e) => {
    const point = eventPoint(e);
    const rect = lastRectRef.current;
    const source = drawArgs.source;
    if (!source || !rect) return;
    if (!pointHitsLight(point, drawArgs.light, source, rect)) return;
    e.preventDefault();
    dragState.current = { dragging: true, pointerId: e.pointerId };
    canvasRef.current.setPointerCapture(e.pointerId);
    canvasRef.current.style.cursor = "grabbing";
    drawArgs.onDragChange(true);
  };

  const handlePointerMove = (e) => {
    if (!dragState.current.dragging) {
      const point = eventPoint(e);
      const source = drawArgs.source;
      const rect = lastRectRef.current;
      const hits = source && rect
        ? pointHitsLight(point, drawArgs.light, source, rect)
        : false;
      canvasRef.current.style.cursor = hits ? "grab" : "";
      return;
    }
    e.preventDefault();
    onLightMove(eventPoint(e));
  };

  const stopDrag = (e) => {
    if (!dragState.current.dragging) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    dragState.current = { dragging: false, pointerId: null };
    canvas.style.cursor = "";
    drawArgs.onDragChange(false);
  };

  return (
    <section class="preview-area" aria-label="Preview">
      <div class="preview-head">
        <div class="segmented" role="group" aria-label="Preview mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              class={mode === m.id ? "active" : ""}
              data-mode={m.id}
              onClick={() => onModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <output id="status">{status}</output>
      </div>
      <div class="preview-stage">
        <canvas id="previewGL" ref={glCanvasRef} width="960" height="640" />
        <canvas
          id="previewCanvas"
          ref={canvasRef}
          width="960"
          height="640"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onPointerLeave={stopDrag}
        />
      </div>
    </section>
  );
}
