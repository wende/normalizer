import { useEffect, useRef } from "preact/hooks";
import { canvasPointFromEvent, drawPreview, pointHitsLight } from "./previewRender.js";

const MODES = [
  { id: "split", label: "Split" },
  { id: "lit", label: "Lit" },
  { id: "normal", label: "Normal" },
  { id: "ai", label: "AI Map" },
  { id: "diffuse", label: "Diffuse" },
];

export function PreviewArea({
  mode,
  onModeChange,
  status,
  drawArgs,
  onLightMove,
  lightSprite,
}) {
  const canvasRef = useRef(null);
  const dragState = useRef({ dragging: false, pointerId: null });

  // Imperative redraw on every relevant state change. drawArgs is rebuilt by
  // App on every render so this effect always runs with the latest snapshot.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    const lastRect = drawPreview({ canvas, ctx, ...drawArgs });
    drawArgs.onRectChange(lastRect);
  }, [drawArgs]);

  // Resize-driven redraw — Preact won't see browser resize events.
  useEffect(() => {
    const handle = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      const lastRect = drawPreview({ canvas, ctx, ...drawArgs });
      drawArgs.onRectChange(lastRect);
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [drawArgs]);

  const eventPoint = (e) => canvasPointFromEvent(canvasRef.current, e);

  const handlePointerDown = (e) => {
    const point = eventPoint(e);
    const rect = drawArgs.lastRect;
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
      const rect = drawArgs.lastRect;
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
    </section>
  );
}