import { RangeRow } from "./RangeRow.jsx";
import { ToggleRow, ColorRow } from "./ToggleRow.jsx";
import { DEFAULT_LIGHT_CONTROLS, DEFAULT_NORMAL } from "./controls.js";

const TABS = [
  { id: "light", label: "Light" },
  { id: "normal", label: "Normal" },
];

export function ControlsPanel({
  tab,
  onTabChange,
  normalControls,
  onNormalControlsChange,
  lightControls,
  onLightControlsChange,
}) {
  return (
    <aside class="controls" aria-label="Controls">
      <div class="control-tabs segmented" role="tablist" aria-label="Control panels">
        {TABS.map((t) => (
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

      <div
        class={tab === "normal" ? "control-panel active" : "control-panel"}
        id="normalPanel"
        role="tabpanel"
        data-control-tab="normal"
        hidden={tab !== "normal"}
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
        <div
          class="radio-group"
          role="radiogroup"
          aria-label="Bump profile"
        >
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
    </aside>
  );
}

ControlsPanel.defaultLightControls = DEFAULT_LIGHT_CONTROLS;
ControlsPanel.defaultNormalControls = DEFAULT_NORMAL;