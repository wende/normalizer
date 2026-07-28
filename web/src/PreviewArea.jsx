import { useEffect, useRef } from "preact/hooks";
import {
  canvasPointFromEvent,
  canvasToSplitRatio,
  drawAiPlaceholder,
  drawLightHandle,
  drawPreview,
  pointHitsLight,
  pointHitsSplitDivider,
  renderLit,
  splitDividerX,
} from "./previewRender.js";
import { createLitGL } from "./litGL.js";

// Pointer delta (canvas px) → tilt. A drag of ~half the fitted image width
// reaches |tilt| ≈ 1.
const VIEW_TILT_CLAMP = 1;

function clampTilt(v) {
  return Math.max(-VIEW_TILT_CLAMP, Math.min(VIEW_TILT_CLAMP, v));
}

function canTiltView(mode) {
  return mode === "lit" || mode === "split";
}

function drawSplitDivider(octx, rect, splitRatio, dragging) {
  const ratio = window.devicePixelRatio || 1;
  const x = splitDividerX(rect, splitRatio);
  octx.save();
  octx.strokeStyle = dragging ? "#ffffff" : "#fffefa";
  octx.lineWidth = dragging ? Math.max(2, Math.round(3 * ratio)) : Math.max(1, Math.round(2 * ratio));
  octx.beginPath();
  octx.moveTo(x, rect.y);
  octx.lineTo(x, rect.y + rect.height);
  octx.stroke();
  octx.restore();
}

// Canvas2D overlay painted on top of the WebGL canvas: light handle, split
// divider, and the AI "not generated yet" hint. Transparent except for these.
function drawOverlay(octx, canvas, drawArgs, rect) {
  octx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rect) {
    if (drawArgs.mode !== "base" && drawArgs.mode !== "specular" && drawArgs.mode !== "parallax" && drawArgs.pipeline === "ai") {
      drawAiPlaceholder(octx, canvas);
    }
    return;
  }
  if (drawArgs.mode === "split") {
    drawSplitDivider(octx, rect, drawArgs.splitRatio ?? 0.5, drawArgs.draggingSplit);
  }
  drawLightHandle(octx, drawArgs.light, drawArgs.source, rect, drawArgs.draggingLight, drawArgs.lightSprite);
}

function cpuFallback(overlay, octx, drawArgs) {
  const {
    source, normal, specular, parallax, mode, pipeline, light, pixelated, draggingLight, lightSprite,
    lightSettings, toon, splitRatio,
  } = drawArgs;
  // Steep parallax is WebGL-only; CPU lit path ignores heightScale / viewTilt.
  const litCache = source && normal ? renderLit(source, normal, lightSettings, toon, specular) : null;
  return drawPreview({
    canvas: overlay,
    ctx: octx,
    source,
    normal,
    specular,
    parallax,
    litCache,
    mode,
    pipeline,
    light,
    pixelated,
    draggingLight,
    lightSprite,
    splitRatio,
  });
}

function paintAll(glRef, glInitRef, glCanvas, overlay, drawArgs, stageEl) {
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
      specular: drawArgs.specular,
      parallax: drawArgs.parallax,
      mode: drawArgs.mode,
      lightSettings: drawArgs.lightSettings,
      toon: drawArgs.toon,
      pixelated: drawArgs.pixelated,
      splitRatio: drawArgs.splitRatio ?? 0.5,
      heightScale: drawArgs.heightScale ?? 0,
      viewTilt: drawArgs.viewTilt ?? { x: 0, y: 0 },
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
  if (stageEl && rect && glCanvas.width > 0) {
    stageEl.dataset.imageLeft = String(rect.x / glCanvas.width);
    stageEl.dataset.imageWidth = String(rect.width / glCanvas.width);
    stageEl.dataset.imageTop = String(rect.y / glCanvas.height);
    stageEl.dataset.imageHeight = String(rect.height / glCanvas.height);
  }
}

export function PreviewArea({
  drawArgs,
  onLightMove,
  onViewTilt,
  onSplitRatioChange,
  splitRatio,
  lightSprite,
  lastRectRef,
}) {
  const glCanvasRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const glRef = useRef(null);
  const glInitRef = useRef(false);
  const dragState = useRef({ kind: null, pointerId: null, startPoint: null, startTilt: null });

  useEffect(() => {
    paintAll(glRef, glInitRef, glCanvasRef.current, canvasRef.current, drawArgs, stageRef.current);
  }, [drawArgs]);

  useEffect(() => {
    const handle = () => paintAll(glRef, glInitRef, glCanvasRef.current, canvasRef.current, drawArgs, stageRef.current);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [drawArgs]);

  const eventPoint = (e) => canvasPointFromEvent(canvasRef.current, e);

  const updateCursor = (point) => {
    const canvas = canvasRef.current;
    const rect = lastRectRef.current;
    const source = drawArgs.source;
    if (!canvas || !source || !rect) {
      if (canvas) canvas.style.cursor = "";
      return;
    }
    if (drawArgs.mode === "split" && pointHitsSplitDivider(point, rect, splitRatio)) {
      canvas.style.cursor = "col-resize";
      return;
    }
    if (pointHitsLight(point, drawArgs.light, source, rect)) {
      canvas.style.cursor = "grab";
      return;
    }
    canvas.style.cursor = canTiltView(drawArgs.mode) ? "grab" : "";
  };

  const handlePointerDown = (e) => {
    const point = eventPoint(e);
    const rect = lastRectRef.current;
    const source = drawArgs.source;
    if (!source || !rect) return;

    if (drawArgs.mode === "split" && pointHitsSplitDivider(point, rect, splitRatio)) {
      e.preventDefault();
      dragState.current = { kind: "split", pointerId: e.pointerId, startPoint: null, startTilt: null };
      canvasRef.current.setPointerCapture(e.pointerId);
      canvasRef.current.style.cursor = "col-resize";
      drawArgs.onSplitDragChange(true);
      onSplitRatioChange(canvasToSplitRatio(point, rect));
      return;
    }

    if (pointHitsLight(point, drawArgs.light, source, rect)) {
      e.preventDefault();
      dragState.current = { kind: "light", pointerId: e.pointerId, startPoint: null, startTilt: null };
      canvasRef.current.setPointerCapture(e.pointerId);
      canvasRef.current.style.cursor = "grabbing";
      drawArgs.onDragChange(true);
      return;
    }

    if (canTiltView(drawArgs.mode) && onViewTilt) {
      e.preventDefault();
      const tilt = drawArgs.viewTilt ?? { x: 0, y: 0 };
      dragState.current = {
        kind: "view",
        pointerId: e.pointerId,
        startPoint: point,
        startTilt: { x: tilt.x, y: tilt.y },
      };
      canvasRef.current.setPointerCapture(e.pointerId);
      canvasRef.current.style.cursor = "grabbing";
    }
  };

  const handlePointerMove = (e) => {
    const point = eventPoint(e);
    if (dragState.current.kind === "split") {
      e.preventDefault();
      const rect = lastRectRef.current;
      if (rect) onSplitRatioChange(canvasToSplitRatio(point, rect));
      return;
    }
    if (dragState.current.kind === "light") {
      e.preventDefault();
      onLightMove(point);
      return;
    }
    if (dragState.current.kind === "view") {
      e.preventDefault();
      const rect = lastRectRef.current;
      const { startPoint, startTilt } = dragState.current;
      if (!rect || !startPoint || !startTilt || !onViewTilt) return;
      const scale = 2 / Math.max(1, rect.width);
      // Screen y grows downward; shader viewDir.y is up — flip dy.
      onViewTilt({
        x: clampTilt(startTilt.x + (point.x - startPoint.x) * scale),
        y: clampTilt(startTilt.y - (point.y - startPoint.y) * scale),
      });
      return;
    }
    updateCursor(point);
  };

  const stopDrag = (e) => {
    if (!dragState.current.kind) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (dragState.current.kind === "light") {
      drawArgs.onDragChange(false);
    } else if (dragState.current.kind === "split") {
      drawArgs.onSplitDragChange(false);
    }
    dragState.current = { kind: null, pointerId: null, startPoint: null, startTilt: null };
    updateCursor(eventPoint(e));
  };

  return (
    <section class="preview-area" aria-label="Preview">
      <div class="preview-stage" ref={stageRef} data-split-ratio={splitRatio}>
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
