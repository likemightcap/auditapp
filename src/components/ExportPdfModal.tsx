import { useEffect, useState } from "react";

export type ExportPdfThemePreset = "default" | "standard" | "light" | "dark";

export interface ExportPdfStyleOptions {
  themePreset: ExportPdfThemePreset;
  hueColor: string | null;
  hideLabels: boolean;
  hideLinearFeetMarkers: boolean;
  hideGrid: boolean;
  hideUtilities: boolean;
}

interface ExportPdfModalProps {
  isOpen: boolean;
  isExporting: boolean;
  previewImageUrl: string | null;
  previewLoading: boolean;
  onCancel: () => void;
  onOptionsChange: (options: ExportPdfStyleOptions) => void;
  onExport: (options: ExportPdfStyleOptions) => void;
}

interface ColorOption {
  id: string;
  label: string;
  value: string | null;
}

const GRAYSCALE_COLOR_TOKEN = "__grayscale__";

export { GRAYSCALE_COLOR_TOKEN };

const COLOR_OPTIONS: ColorOption[] = [
  { id: "none", label: "No Color", value: null },
  { id: "gray", label: "Gray (Grayscale)", value: GRAYSCALE_COLOR_TOKEN },
  { id: "sand", label: "Sand", value: "#c8a56c" },
  { id: "orange", label: "Orange", value: "#f07a22" },
  { id: "red", label: "Red", value: "#cc6b5d" },
  { id: "rose", label: "Rose", value: "#cc799a" },
  { id: "violet", label: "Violet", value: "#9279c8" },
  { id: "indigo", label: "Indigo", value: "#6278c6" },
  { id: "blue", label: "Blue", value: "#4f8fd2" },
  { id: "cyan", label: "Cyan", value: "#4bcad0" },
  { id: "teal", label: "Teal", value: "#4fada5" },
  { id: "green", label: "Green", value: "#66a85a" },
];

function colorOptionFromValue(value: string | null): ColorOption {
  const found = COLOR_OPTIONS.find((option) => option.value?.toLowerCase() === value?.toLowerCase());
  return found ?? COLOR_OPTIONS[0];
}

function resetThemeAndColorToDefault(
  setThemePreset: (next: ExportPdfThemePreset) => void,
  setColorValue: (next: string | null) => void,
): void {
  setThemePreset("default");
  setColorValue(null);
}

export function ExportPdfModal({
  isOpen,
  isExporting,
  previewImageUrl,
  previewLoading,
  onCancel,
  onOptionsChange,
  onExport,
}: ExportPdfModalProps) {
  const [themePreset, setThemePreset] = useState<ExportPdfThemePreset>("default");
  const [colorValue, setColorValue] = useState<string | null>(null);
  const [hideLabels, setHideLabels] = useState(false);
  const [hideLinearFeetMarkers, setHideLinearFeetMarkers] = useState(false);
  const [hideGrid, setHideGrid] = useState(false);
  const [hideUtilities, setHideUtilities] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setThemePreset("default");
    setColorValue(null);
    setHideLabels(false);
    setHideLinearFeetMarkers(false);
    setHideGrid(false);
    setHideUtilities(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    onOptionsChange({
      themePreset,
      hueColor: colorValue,
      hideLabels,
      hideLinearFeetMarkers,
      hideGrid,
      hideUtilities,
    });
  }, [
    colorValue,
    hideGrid,
    hideLabels,
    hideLinearFeetMarkers,
    hideUtilities,
    isOpen,
    onOptionsChange,
    themePreset,
  ]);

  if (!isOpen) {
    return null;
  }

  const selectedColor = colorOptionFromValue(colorValue);
  const colorSelectionEnabled = themePreset !== "default";

  return (
    <div className="modal-backdrop" onPointerDown={isExporting ? undefined : onCancel}>
      <section className="text-modal export-pdf-modal" onPointerDown={(event) => event.stopPropagation()}>
        <div className="export-pdf-modal-settings">
          <h2>EXPORT PDF STYLE</h2>

          <div className="export-style-stack">
            <button
              type="button"
              className={`modal-size-chip export-style-default ${themePreset === "default" ? "is-active" : ""}`}
              onClick={() => {
                resetThemeAndColorToDefault(setThemePreset, setColorValue);
              }}
              disabled={isExporting}
            >
              DEFAULT
            </button>

            <div className="export-style-grid">
              <button
                type="button"
                className={`modal-size-chip ${themePreset === "standard" ? "is-active" : ""}`}
                onClick={() => setThemePreset("standard")}
                disabled={isExporting}
              >
                STANDARD
              </button>
              <button
                type="button"
                className={`modal-size-chip ${themePreset === "light" ? "is-active" : ""}`}
                onClick={() => setThemePreset("light")}
                disabled={isExporting}
              >
                LIGHT THEME
              </button>
              <button
                type="button"
                className={`modal-size-chip ${themePreset === "dark" ? "is-active" : ""}`}
                onClick={() => setThemePreset("dark")}
                disabled={isExporting}
              >
                DARK THEME
              </button>
            </div>
          </div>

          <div className="modal-row export-color-row">
            <label>COLOR:</label>
            <div
              className={`modal-chip-row export-color-grid ${colorSelectionEnabled ? "" : "is-disabled"}`}
              role="radiogroup"
              aria-label="Export hue color"
              aria-disabled={!colorSelectionEnabled}
            >
              {COLOR_OPTIONS.map((option) => {
                const isActive = selectedColor.id === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={option.label}
                    title={option.label}
                    className={`modal-color-chip export-color-chip ${isActive ? "is-active" : ""} ${option.value ? "" : "is-none"}`}
                    style={option.value && option.value !== GRAYSCALE_COLOR_TOKEN ? { background: option.value } : undefined}
                    onClick={() => {
                      if (!colorSelectionEnabled) {
                        return;
                      }
                      setColorValue(option.value);
                    }}
                    disabled={isExporting || !colorSelectionEnabled}
                  >
                    {!option.value && <span className="export-color-none-mark" aria-hidden="true">/</span>}
                    {option.value === GRAYSCALE_COLOR_TOKEN && <span className="export-color-gray-mark" aria-hidden="true">G</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="export-pdf-checkboxes">
            <label className="modal-checkbox rect-unconditioned-checkbox">
              <input
                type="checkbox"
                checked={hideLabels}
                onChange={(event) => setHideLabels(event.target.checked)}
                disabled={isExporting}
              />
              HIDE LABELS
            </label>

            <label className="modal-checkbox rect-unconditioned-checkbox">
              <input
                type="checkbox"
                checked={hideLinearFeetMarkers}
                onChange={(event) => setHideLinearFeetMarkers(event.target.checked)}
                disabled={isExporting}
              />
              HIDE LINEAR FEET MARKERS
            </label>

            <label className="modal-checkbox rect-unconditioned-checkbox">
              <input
                type="checkbox"
                checked={hideGrid}
                onChange={(event) => setHideGrid(event.target.checked)}
                disabled={isExporting}
              />
              HIDE GRID
            </label>

            <label className="modal-checkbox rect-unconditioned-checkbox">
              <input
                type="checkbox"
                checked={hideUtilities}
                onChange={(event) => setHideUtilities(event.target.checked)}
                disabled={isExporting}
              />
              HIDE UTILITIES
            </label>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="okay"
              disabled={isExporting}
              onClick={() =>
                onExport({
                  themePreset,
                  hueColor: colorValue,
                  hideLabels,
                  hideLinearFeetMarkers,
                  hideGrid,
                  hideUtilities,
                })
              }
            >
              {isExporting ? "EXPORTING PDF..." : "EXPORT PDF"}
            </button>
            <button type="button" className="cancel" onClick={onCancel} disabled={isExporting}>
              CANCEL
            </button>
          </div>
        </div>

        <aside className="export-pdf-preview-panel" aria-label="Live export preview">
          <h3>LIVE PREVIEW</h3>
          <div className="export-pdf-preview-frame">
            {previewImageUrl && (
              <img src={previewImageUrl} alt="Live export preview" className="export-pdf-preview-image" />
            )}
            {!previewImageUrl && previewLoading && <div className="export-pdf-preview-placeholder">Preparing preview...</div>}
            {!previewLoading && !previewImageUrl && <div className="export-pdf-preview-placeholder">Preview unavailable</div>}
            {previewImageUrl && previewLoading && (
              <div className="export-pdf-preview-updating" aria-hidden="true">
                Updating...
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
