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

const VIEW_TILT_SENSITIVITY = 2.0;

function clampTilt(v) {
  return Math.max(-1, Math.min(1, v));
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

function isLitCanvasMode(mode) {
  return mode === "lit" || mode === "split";
}

// Canvas2D overlay painted on top of the WebGL canvas: light handle, split
// divider, and the AI "not generated yet" hint. Transparent except for these.
function drawOverlay(octx, canvas, drawArgs, rect) {
  octx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rect) {
    const skipPlaceholder = drawArgs.mode === "base"
      || drawArgs.mode === "specular"
      || drawArgs.mode === "parallax"
      || drawArgs.mode === "occlusion";
    if (!skipPlaceholder && drawArgs.pipeline === "ai") {
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
    source, normal, specular, parallax, occlusion, mode, pipeline, light, pixelated, draggingLight, lightSprite,
    lightSettings, toon, splitRatio,
  } = drawArgs;
  const litCache = source && normal ? renderLit(source, normal, lightSettings, toon, specular) : null;
  return drawPreview({
    canvas: overlay,
    ctx: octx,
    source,
    normal,
    specular,
    parallax,
    occlusion,
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
      occlusion: drawArgs.occlusion,
      mode: drawArgs.mode,
      lightSettings: drawArgs.lightSettings,
      toon: drawArgs.toon,
      pixelated: drawArgs.pixelated,
      splitRatio: drawArgs.splitRatio ?? 0.5,
      viewTilt: drawArgs.viewTilt,
      heightScale: drawArgs.heightScale,
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
  const dragState = useRef({ kind: null, pointerId: null, lastPoint: null });

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
      canvas.style.cursor = "";
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
    canvas.style.cursor = isLitCanvasMode(drawArgs.mode) ? "grab" : "";
  };

  const handlePointerDown = (e) => {
    const point = eventPoint(e);
    const rect = lastRectRef.current;
    const source = drawArgs.source;
    if (!source || !rect) return;

    if (drawArgs.mode === "split" && pointHitsSplitDivider(point, rect, splitRatio)) {
      e.preventDefault();
      dragState.current = { kind: "split", pointerId: e.pointerId, lastPoint: point };
      canvasRef.current.setPointerCapture(e.pointerId);
      canvasRef.current.style.cursor = "col-resize";
      drawArgs.onSplitDragChange(true);
      onSplitRatioChange(canvasToSplitRatio(point, rect));
      return;
    }

    if (pointHitsLight(point, drawArgs.light, source, rect)) {
      e.preventDefault();
      dragState.current = { kind: "light", pointerId: e.pointerId, lastPoint: point };
      canvasRef.current.setPointerCapture(e.pointerId);
      canvasRef.current.style.cursor = "grabbing";
      drawArgs.onDragChange(true);
      return;
    }

    if (isLitCanvasMode(drawArgs.mode)) {
      e.preventDefault();
      dragState.current = { kind: "view", pointerId: e.pointerId, lastPoint: point };
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
      const last = dragState.current.lastPoint;
      if (rect && last) {
        const dx = (point.x - last.x) / rect.width;
        const dy = (point.y - last.y) / rect.height;
        const tilt = drawArgs.viewTilt ?? { x: 0, y: 0 };
        onViewTilt({
          x: clampTilt(tilt.x + dx * VIEW_TILT_SENSITIVITY),
          y: clampTilt(tilt.y - dy * VIEW_TILT_SENSITIVITY),
        });
      }
      dragState.current.lastPoint = point;
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
    dragState.current = { kind: null, pointerId: null, lastPoint: null };
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
