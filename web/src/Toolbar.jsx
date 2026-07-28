import { useRef } from "preact/hooks";

const FOLDER_ICON = (
  <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true">
    <path
      d="M0 2C0 0.9 0.9 0 2 0H5.5L7 1.5H13C14.1 1.5 15 2.4 15 3.5V10C15 11.1 14.1 12 13 12H2C0.9 12 0 11.1 0 10V2Z"
      fill="oklch(0.55 0.01 90)"
    />
  </svg>
);

export function Toolbar({
  onOpenFile,
  onOpenProject,
  onLoadSample,
  onSaveProject,
  onExport,
  onExportPack,
  exportPackBusy,
  canSaveProject = false,
}) {
  const fileRef = useRef(null);
  const projectRef = useRef(null);
  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <span>Normalizer</span>
        </div>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="toolbar-actions">
          <label class="file-button" for="imageInput">
            {FOLDER_ICON}
            <span>Open</span>
          </label>
          <input
            id="imageInput"
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              onOpenFile(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <label class="file-button" for="projectInput">
            <span>Open Project</span>
          </label>
          <input
            id="projectInput"
            ref={projectRef}
            type="file"
            accept=".normalizer,application/zip"
            onChange={(e) => {
              onOpenProject(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <button id="sampleButton" type="button" onClick={onLoadSample}>Sample</button>
        </div>
      </div>
      <div class="actions">
        <button
          id="saveProjectButton"
          type="button"
          onClick={onSaveProject}
          disabled={!canSaveProject}
        >
          Save Project
        </button>
        <button id="exportButton" type="button" onClick={onExport}>Export PNG</button>
        <button
          id="exportPackButton"
          type="button"
          onClick={onExportPack}
          disabled={exportPackBusy}
          title="Download all maps as a ZIP with normalizer.json"
        >
          {exportPackBusy ? "Exporting…" : "Export Pack"}
        </button>
      </div>
    </header>
  );
}
