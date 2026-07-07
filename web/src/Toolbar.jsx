import { useRef } from "preact/hooks";

export function Toolbar({ onOpenFile, onLoadSample, onExport, onGenerateAI, aiBusy }) {
  const fileRef = useRef(null);
  return (
    <header class="toolbar">
      <div class="brand">
        <span class="mark" aria-hidden="true"></span>
        <span>Laigter Web MVP</span>
      </div>
      <div class="actions">
        <label class="file-button" for="imageInput">
          <span aria-hidden="true">+</span>
          <span>Open</span>
        </label>
        <input
          id="imageInput"
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => onOpenFile(e.currentTarget.files?.[0])}
        />
        <button id="sampleButton" type="button" onClick={onLoadSample}>Sample</button>
        <button
          id="aiGenerateButton"
          type="button"
          onClick={onGenerateAI}
          disabled={aiBusy}
          title="Generate an AI normal map (DeepBump) in a background worker"
        >
          {aiBusy ? "Generating…" : "AI Normal"}
        </button>
        <button id="exportButton" type="button" onClick={onExport}>Export PNG</button>
      </div>
    </header>
  );
}