import { RangeRow } from "./RangeRow.jsx";
import { ToggleRow, ColorRow } from "./ToggleRow.jsx";
import { DEFAULT_LIGHT_CONTROLS, DEFAULT_NORMAL } from "./controls.js";

const PIPELINES = [
  { id: "procedural", label: "Procedural" },
  { id: "ai", label: "AI" },
];

// Tabs depend on the active pipeline. "Light" is shared; the second tab is the
// pipeline-specific map controls.
const TABS = {
  procedural: [
    { id: "light", label: "Light" },
    { id: "normal", label: "Normal" },
  ],
  ai: [
    { id: "light", label: "Light" },
    { id: "ai", label: "AI" },
  ],
};

const OVERLAPS = [
  { id: "SMALL", label: "Small" },
  { id: "MEDIUM", label: "Medium" },
  { id: "LARGE", label: "Large" },
];

export function ControlsPanel({
  pipeline,
  onPipelineChange,
  tab,
  onTabChange,
  normalControls,
  onNormalControlsChange,
  lightControls,
  onLightControlsChange,
  aiControls,
  onAiControlsChange,
  onGenerateAI,
  aiBusy,
  aiReady,
}) {
  const tabs = TABS[pipeline] || TABS.procedural;
  const showNormal = pipeline === "procedural" && tab === "normal";
  const showAi = pipeline === "ai" && tab === "ai";

  return (
    <aside class="controls" aria-label="Controls">
      <div class="pipeline-switch segmented" role="group" aria-label="Generator">
        {PIPELINES.map((p) => (
          <button
            key={p.id}
            type="button"
            class={pipeline === p.id ? "active" : ""}
            aria-pressed={pipeline === p.id ? "true" : "false"}
            data-pipeline={p.id}
            onClick={() => onPipelineChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div class="control-tabs segmented" role="tablist" aria-label="Control panels">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            class={tab === t.id ? "active" : ""}
            aria-selected={tab === t.id ? "true" : "false"}
            data-control-tab={t.id}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Light panel — shared by both pipelines (drives Lit / Split views). */}
      <div
        class={tab === "light" ? "control-panel active" : "control-panel"}
        id="lightPanel"
        role="tabpanel"
        data-control-tab="light"
        hidden={tab !== "light"}
      >
        <div class="toggles preview-toggles">
          <ToggleRow
            id="pixelated"
            checked={lightControls.pixelated}
            onChange={(v) => onLightControlsChange({ pixelated: v })}
          >
            Pixelated
          </ToggleRow>
          <ToggleRow
            id="toon"
            checked={lightControls.toon}
            onChange={(v) => onLightControlsChange({ toon: v })}
          >
            Toon
          </ToggleRow>
        </div>

        <div class="subsection-title">Diffuse</div>
        <RangeRow
          label="Intensity"
          id="diffuseIntensity"
          min={0}
          max={400}
          value={lightControls.diffuseIntensity}
          onChange={(v) => onLightControlsChange({ diffuseIntensity: v })}
        />

        <div class="subsection-title">Specular</div>
        <RangeRow
          label="Intensity"
          id="specularIntensity"
          min={0}
          max={400}
          value={lightControls.specularIntensity}
          onChange={(v) => onLightControlsChange({ specularIntensity: v })}
        />
        <RangeRow
          label="Scatter"
          id="specularScatter"
          min={1}
          max={255}
          value={lightControls.specularScatter}
          onChange={(v) => onLightControlsChange({ specularScatter: v })}
        />

        <div class="subsection-title">Ambient</div>
        <RangeRow
          label="Intensity"
          id="ambientIntensity"
          min={0}
          max={100}
          value={lightControls.ambientIntensity}
          onChange={(v) => onLightControlsChange({ ambientIntensity: v })}
        />
        <ColorRow
          label="Color"
          id="ambientColor"
          value={lightControls.ambientColor}
          onChange={(v) => onLightControlsChange({ ambientColor: v })}
        />
        <ColorRow
          label="Light Color"
          id="lightColor"
          value={lightControls.lightColor}
          onChange={(v) => onLightControlsChange({ lightColor: v })}
        />
        <RangeRow
          label="Height"
          id="lightHeight"
          min={-100}
          max={100}
          value={lightControls.lightHeight}
          onChange={(v) => onLightControlsChange({ lightHeight: v })}
        />
      </div>

      {/* Normal panel — procedural pipeline only. */}
      <div
        class={showNormal ? "control-panel active" : "control-panel"}
        id="normalPanel"
        role="tabpanel"
        data-control-tab="normal"
        hidden={!showNormal}
      >
        <div class="subsection-title">Enhance</div>
        <RangeRow
          label="Height"
          id="normalDepth"
          min={0}
          max={4000}
          value={normalControls.normalDepth}
          onChange={(v) => onNormalControlsChange({ normalDepth: v })}
        />
        <RangeRow
          label="Soft"
          id="normalBlur"
          min={0}
          max={40}
          value={normalControls.normalBlur}
          onChange={(v) => onNormalControlsChange({ normalBlur: v })}
        />

        <div class="subsection-title">Bump</div>
        <RangeRow
          label="Height"
          id="biselDepth"
          min={0}
          max={4000}
          value={normalControls.biselDepth}
          onChange={(v) => onNormalControlsChange({ biselDepth: v })}
        />
        <RangeRow
          label="Distance"
          id="biselDistance"
          min={0}
          max={255}
          value={normalControls.biselDistance}
          onChange={(v) => onNormalControlsChange({ biselDistance: v })}
        />
        <RangeRow
          label="Soft"
          id="biselBlur"
          min={0}
          max={40}
          value={normalControls.biselBlur}
          onChange={(v) => onNormalControlsChange({ biselBlur: v })}
        />
        <div class="radio-group" role="radiogroup" aria-label="Bump profile">
          <label>
            <input
              type="radio"
              name="biselProfile"
              value="soft"
              checked={normalControls.softBisel === true}
              onChange={() => onNormalControlsChange({ softBisel: true })}
            />
            {" "}Soft
          </label>
          <label>
            <input
              type="radio"
              name="biselProfile"
              value="abrupt"
              checked={normalControls.softBisel === false}
              onChange={() => onNormalControlsChange({ softBisel: false })}
            />
            {" "}Abrupt
          </label>
        </div>

        <div class="toggles">
          <ToggleRow
            id="useAlpha"
            checked={normalControls.useAlpha}
            onChange={(v) => onNormalControlsChange({ useAlpha: v })}
          >
            Use alpha
          </ToggleRow>
        </div>
      </div>

      {/* AI panel — AI pipeline only. */}
      <div
        class={showAi ? "control-panel active" : "control-panel"}
        id="aiPanel"
        role="tabpanel"
        data-control-tab="ai"
        hidden={!showAi}
      >
        <button
          id="aiGenerateButton"
          class="ai-generate"
          type="button"
          onClick={onGenerateAI}
          disabled={aiBusy}
        >
          {aiBusy ? "Generating…" : aiReady ? "Regenerate AI Normal" : "Generate AI Normal"}
        </button>
        <p class="hint">
          DeepBump runs in your browser. The first run downloads the model
          (~27&nbsp;MB, cached afterward).
        </p>

        <div class="subsection-title">Adjust</div>
        <p class="hint">Applied live to the generated map — no regenerate needed.</p>
        <RangeRow
          label="Strength"
          id="aiStrength"
          min={0}
          max={300}
          step={5}
          value={aiControls.strength}
          onChange={(v) => onAiControlsChange({ strength: v })}
          format={(v) => `${v}%`}
        />
        <RangeRow
          label="Smooth"
          id="aiSmooth"
          min={0}
          max={5}
          step={1}
          value={aiControls.smooth}
          onChange={(v) => onAiControlsChange({ smooth: v })}
          format={(v) => (v > 0 ? `${v}px` : "Off")}
        />
        <RangeRow
          label="Steps"
          id="aiSteps"
          min={0}
          max={5}
          step={1}
          value={aiControls.steps}
          onChange={(v) => onAiControlsChange({ steps: v })}
          format={(v) => (v > 0 ? `${2 * v + 1} lv` : "Off")}
        />
        <p class="hint">
          Steps quantizes the normal into flat facets for a pixel-art look
          (pairs well with higher Strength). Off = smooth gradient.
        </p>
        <div class="toggles">
          <ToggleRow
            id="aiInvertX"
            checked={aiControls.invertX}
            onChange={(v) => onAiControlsChange({ invertX: v })}
          >
            Invert X
          </ToggleRow>
          <ToggleRow
            id="aiInvertY"
            checked={aiControls.invertY}
            onChange={(v) => onAiControlsChange({ invertY: v })}
          >
            Invert Y (DirectX)
          </ToggleRow>
          <ToggleRow
            id="aiInvertZ"
            checked={aiControls.invertZ}
            onChange={(v) => onAiControlsChange({ invertZ: v })}
          >
            Invert Z
          </ToggleRow>
        </div>

        <div class="subsection-title">Generation</div>
        <p class="hint">These change the model input — Regenerate to apply.</p>
        <RangeRow
          label="Denoise"
          id="aiDenoise"
          min={0}
          max={3}
          step={1}
          value={aiControls.denoise}
          onChange={(v) => onAiControlsChange({ denoise: v })}
          format={(v) => (v > 0 ? `${v}px` : "Off")}
        />
        <div class="radio-group" role="radiogroup" aria-label="Tile overlap">
          {OVERLAPS.map((o) => (
            <label key={o.id}>
              <input
                type="radio"
                name="aiOverlap"
                value={o.id}
                checked={aiControls.overlap === o.id}
                onChange={() => onAiControlsChange({ overlap: o.id })}
              />
              {" "}{o.label}
            </label>
          ))}
        </div>
        <p class="hint">Overlap: higher smooths tile seams (slower).</p>
      </div>
    </aside>
  );
}

ControlsPanel.defaultLightControls = DEFAULT_LIGHT_CONTROLS;
ControlsPanel.defaultNormalControls = DEFAULT_NORMAL;
