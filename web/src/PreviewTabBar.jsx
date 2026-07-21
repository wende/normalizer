const MODES = [
  { id: "base", label: "Base" },
  { id: "split", label: "Split" },
  { id: "lit", label: "Lit" },
  { id: "normal", label: "Normal" },
  { id: "specular", label: "Specular" },
  { id: "parallax", label: "Parallax" },
];

export function PreviewTabBar({ mode, onModeChange, status }) {
  return (
    <div class="preview-tab-bar">
      <div class="preview-tabs" role="group" aria-label="Preview mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            class={`preview-tab${mode === m.id ? " active" : ""}`}
            data-mode={m.id}
            aria-pressed={mode === m.id ? "true" : "false"}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <output id="status">{status}</output>
    </div>
  );
}
