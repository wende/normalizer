import { RangeRow } from "./RangeRow.jsx";
import { ToggleRow, ColorRow } from "./ToggleRow.jsx";
import { ControlCard } from "./ControlCard.jsx";
import { PillSwitch } from "./PillSwitch.jsx";
import { DEFAULT_LIGHT_CONTROLS, DEFAULT_NORMAL, DEFAULT_SPECULAR } from "./controls.js";

const PIPELINES = [
  { id: "procedural", label: "Procedural" },
  { id: "ai", label: "AI" },
];

const TABS = {
  procedural: [
    { id: "light", label: "Light" },
    { id: "normal", label: "Normal" },
    { id: "specular", label: "Specular" },
  ],
  ai: [
    { id: "light", label: "Light" },
    { id: "ai", label: "AI" },
    { id: "specular", label: "Specular" },
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
  specularControls,
  onSpecularControlsChange,
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
  // Specular applies to both pipelines — the map modulates the lit preview
  // regardless of how the normal was produced, so its sliders live in both tabs.
  const showSpecular = tab === "specular";
  const showAi = pipeline === "ai" && tab === "ai";

  return (
    <aside class="controls" aria-label="Controls">
      <PillSwitch
        options={PIPELINES}
        value={pipeline}
        onChange={onPipelineChange}
        ariaLabel="Generator"
      />

      <PillSwitch
        options={tabs}
        value={tab}
        onChange={onTabChange}
        compact
        ariaLabel="Control panels"
      />

      {tab === "light" && (
      <div
        class="control-panel active"
        id="lightPanel"
        role="tabpanel"
        data-control-tab="light"
      >
        <ControlCard title="Display">
          <div class="toggles">
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
        </ControlCard>

        <ControlCard title="Diffuse">
          <RangeRow
            label="Intensity"
            id="diffuseIntensity"
            min={0}
            max={400}
            value={lightControls.diffuseIntensity}
            onChange={(v) => onLightControlsChange({ diffuseIntensity: v })}
          />
        </ControlCard>

        <ControlCard title="Specular">
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
        </ControlCard>

        <ControlCard title="Ambient">
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
        </ControlCard>

        <ControlCard title="Light">
          <ColorRow
            label="Color"
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
        </ControlCard>

        <ControlCard title="Shadow">
          <div class="toggles">
            <ToggleRow
              id="shadowEnabled"
              checked={lightControls.shadowEnabled}
              onChange={(v) => onLightControlsChange({ shadowEnabled: v })}
            >
              Enabled
            </ToggleRow>
          </div>
          <RangeRow
            label="Caster height"
            id="shadowCasterHeight"
            min={0}
            max={100}
            value={lightControls.shadowCasterHeight}
            onChange={(v) => onLightControlsChange({ shadowCasterHeight: v })}
            format={(v) => `${v}%`}
          />
          <RangeRow
            label="Opacity"
            id="shadowOpacity"
            min={0}
            max={100}
            value={lightControls.shadowOpacity}
            onChange={(v) => onLightControlsChange({ shadowOpacity: v })}
            format={(v) => `${v}%`}
          />
          <RangeRow
            label="Softness"
            id="shadowSoftness"
            min={0}
            max={20}
            value={lightControls.shadowSoftness}
            onChange={(v) => onLightControlsChange({ shadowSoftness: v })}
            format={(v) => `${v}px`}
          />
        </ControlCard>
      </div>
      )}

      {showNormal && (
      <div
        class="control-panel active"
        id="normalPanel"
        role="tabpanel"
        data-control-tab="normal"
      >
        <ControlCard title="Enhance">
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
        </ControlCard>

        <ControlCard title="Bump">
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
        </ControlCard>

        <ControlCard title="Options">
          <div class="toggles">
            <ToggleRow
              id="useAlpha"
              checked={normalControls.useAlpha}
              onChange={(v) => onNormalControlsChange({ useAlpha: v })}
            >
              Use alpha
            </ToggleRow>
          </div>
        </ControlCard>
      </div>
      )}

      {showSpecular && (
      <div
        class="control-panel active"
        id="specularPanel"
        role="tabpanel"
        data-control-tab="specular"
      >
        <ControlCard title="Tone">
          <RangeRow
            label="Contrast"
            id="specularContrast"
            min={1}
            max={4000}
            step={1}
            value={specularControls.specularContrast}
            onChange={(v) => onSpecularControlsChange({ specularContrast: v })}
            format={(v) => (v / 1000).toFixed(3)}
          />
          <RangeRow
            label="Threshold"
            id="specularThresh"
            min={0}
            max={255}
            value={specularControls.specularThresh}
            onChange={(v) => onSpecularControlsChange({ specularThresh: v })}
          />
          <RangeRow
            label="Brightness"
            id="specularBright"
            min={-255}
            max={255}
            value={specularControls.specularBright}
            onChange={(v) => onSpecularControlsChange({ specularBright: v })}
          />
          <RangeRow
            label="Blur"
            id="specularBlur"
            min={0}
            max={50}
            value={specularControls.specularBlur}
            onChange={(v) => onSpecularControlsChange({ specularBlur: v })}
          />
        </ControlCard>

        <ControlCard title="Options">
          <div class="toggles">
            <ToggleRow
              id="specularInvert"
              checked={specularControls.specularInvert}
              onChange={(v) => onSpecularControlsChange({ specularInvert: v })}
            >
              Invert
            </ToggleRow>
            <ToggleRow
              id="specularUseAlpha"
              checked={specularControls.useAlpha}
              onChange={(v) => onSpecularControlsChange({ useAlpha: v })}
            >
              Use alpha
            </ToggleRow>
          </div>
        </ControlCard>
      </div>
      )}

      {showAi && (
      <div
        class="control-panel active"
        id="aiPanel"
        role="tabpanel"
        data-control-tab="ai"
      >
        <ControlCard title="Adjust">
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
        </ControlCard>

        <ControlCard title="Generation">
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
        </ControlCard>
      </div>
      )}

      {pipeline === "ai" && (
        <div class="ai-generate-wrap">
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
        </div>
      )}
    </aside>
  );
}

ControlsPanel.defaultLightControls = DEFAULT_LIGHT_CONTROLS;
ControlsPanel.defaultNormalControls = DEFAULT_NORMAL;
ControlsPanel.defaultSpecularControls = DEFAULT_SPECULAR;
