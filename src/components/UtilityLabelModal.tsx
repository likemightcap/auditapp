import { useEffect, useMemo, useRef, useState } from "react";
import type { EntityType } from "../types";

type UtilityEntityType = Extract<EntityType, "condenser" | "heater" | "dhw" | "gas" | "electric" | "other">;
type HeaterZone = "Zone 1" | "Zone 2" | "Zone 3";

const HEATER_ZONES: HeaterZone[] = ["Zone 1", "Zone 2", "Zone 3"];

const UTILITY_PRESET_OPTIONS: Record<UtilityEntityType, string[]> = {
  condenser: ["Zone 1", "Zone 2", "Zone 3", "Other"],
  heater: ["Furnace", "Boiler", "Heat Pump", "Air Handler", "Other"],
  dhw: ["Tank", "Tankless", "Heat Pump", "Indirect", "Other"],
  gas: ["Natural Gas", "Propane", "Gas Meter", "Regulator", "Shutoff", "Other"],
  electric: ["Main Panel", "Subpanel", "Meter", "Disconnect", "Other"],
  other: [
    "Mini Split",
    "Generator",
    "Well Pump",
    "Sump Pump",
    "Water Softener",
    "Humidifier",
    "Dehumidifier",
    "HRV / ERV",
    "Oil Tank",
    "Propane Tank",
    "Pool / Spa",
    "Other",
  ],
};

function normalizeUpper(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function parseHeaterZone(value: string): HeaterZone | "" {
  const normalized = normalizeUpper(value);
  if (normalized === "ZONE 1") {
    return "Zone 1";
  }
  if (normalized === "ZONE 2") {
    return "Zone 2";
  }
  if (normalized === "ZONE 3") {
    return "Zone 3";
  }
  return "";
}

function inferInitialSelection(
  utilityType: UtilityEntityType,
  text: string,
): { preset: string; customText: string; heaterZone: HeaterZone | "" } {
  const presets = UTILITY_PRESET_OPTIONS[utilityType];
  const source = normalizeUpper(text);

  if (!source) {
    return { preset: "", customText: "", heaterZone: "" };
  }

  if (utilityType === "heater") {
    const match = source.match(/^(.*?)(?:\s*-\s*(ZONE\s*[123]))?$/);
    const baseLabel = normalizeUpper(match?.[1] ?? source);
    const heaterZone = parseHeaterZone(match?.[2] ?? "");
    const matchedPreset = presets.find((preset) => normalizeUpper(preset) === baseLabel);

    if (matchedPreset && matchedPreset !== "Other") {
      return { preset: matchedPreset, customText: "", heaterZone };
    }
    if (matchedPreset === "Other") {
      return { preset: "Other", customText: "", heaterZone };
    }
    return { preset: "Other", customText: baseLabel, heaterZone };
  }

  const matchedPreset = presets.find((preset) => normalizeUpper(preset) === source);
  if (matchedPreset && matchedPreset !== "Other") {
    return { preset: matchedPreset, customText: "", heaterZone: "" };
  }
  if (matchedPreset === "Other") {
    return { preset: "Other", customText: "", heaterZone: "" };
  }
  return { preset: "Other", customText: source, heaterZone: "" };
}

function resolveLabel(
  utilityType: UtilityEntityType,
  preset: string,
  customText: string,
  heaterZone: HeaterZone | "",
): string {
  const base = preset === "Other" ? normalizeUpper(customText) : normalizeUpper(preset);
  if (!base) {
    return "";
  }
  if (utilityType === "heater" && heaterZone) {
    return `${base} - ${heaterZone.toUpperCase()}`;
  }
  return base;
}

export interface UtilityLabelSubmit {
  text: string;
  color: string;
}

export interface UtilityLabelInitialValues extends UtilityLabelSubmit {
  utilityType: UtilityEntityType;
}

interface UtilityLabelModalProps {
  isOpen: boolean;
  variant?: "modal" | "docked";
  onCollapse?: () => void;
  initialValues: UtilityLabelInitialValues;
  onCancel: () => void;
  onSubmit: (payload: UtilityLabelSubmit) => void;
  onLiveChange?: (payload: UtilityLabelSubmit) => void;
}

const COLORS = ["WHITE", "BLUE", "RED", "YELLOW"] as const;

function colorSwatch(color: string): { fill: string; border: string } {
  switch (color.toUpperCase()) {
    case "BLUE":
      return { fill: "#1117ff", border: "#2c3e9d" };
    case "RED":
      return { fill: "#e00000", border: "#8c3030" };
    case "YELLOW":
      return { fill: "#ffed00", border: "#b99f1d" };
    case "WHITE":
    default:
      return { fill: "#ffffff", border: "#a9bfdc" };
  }
}

export function UtilityLabelModal({
  isOpen,
  variant = "modal",
  onCollapse,
  initialValues,
  onCancel,
  onSubmit,
  onLiveChange,
}: UtilityLabelModalProps) {
  const [preset, setPreset] = useState("");
  const [customText, setCustomText] = useState("");
  const [heaterZone, setHeaterZone] = useState<HeaterZone | "">("");
  const [color, setColor] = useState("WHITE");
  const [isLiveChangeReady, setIsLiveChangeReady] = useState(false);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const initial = inferInitialSelection(initialValues.utilityType, initialValues.text ?? "");
    setIsLiveChangeReady(false);
    setPreset(initial.preset);
    setCustomText(initial.customText);
    setHeaterZone(initial.heaterZone);
    setColor(initialValues.color.toUpperCase());
  }, [initialValues.color, initialValues.text, initialValues.utilityType, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsLiveChangeReady(false);
      return;
    }
    const frame = requestAnimationFrame(() => setIsLiveChangeReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialValues.color, initialValues.text, initialValues.utilityType, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (preset !== "Other") {
      return;
    }
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
  }, [isOpen, preset]);

  const resolvedText = useMemo(
    () => resolveLabel(initialValues.utilityType, preset, customText, heaterZone),
    [customText, heaterZone, initialValues.utilityType, preset],
  );
  const canSubmit = useMemo(() => {
    if (preset === "Other") {
      return customText.trim().length > 0;
    }
    return true;
  }, [customText, preset]);

  useEffect(() => {
    if (!isOpen || !onLiveChange || !canSubmit || !isLiveChangeReady) {
      return;
    }
    onLiveChange({ text: resolvedText, color });
  }, [canSubmit, color, isLiveChangeReady, isOpen, onLiveChange, resolvedText]);

  if (!isOpen) {
    return null;
  }

  const isDocked = variant === "docked";

  return (
    <div
      className={`modal-backdrop ${isDocked ? "modal-backdrop-docked" : ""}`}
      onPointerDown={isDocked ? undefined : onCancel}
    >
      <section
        className={`text-modal ${isDocked ? "modal-panel-docked" : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isDocked && onCollapse && (
          <button
            type="button"
            className="modal-panel-collapse-btn"
            aria-label="Collapse edit panel"
            title="Collapse"
            onClick={onCollapse}
          >
            ▼
          </button>
        )}
        <h2>UTILITY LABEL</h2>

        <div className="modal-row">
          <label>PRESET:</label>
          <select
            className="text-content-input"
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value);
              if (event.target.value !== "Other") {
                setCustomText("");
              }
            }}
          >
            <option value="">(none)</option>
            {UTILITY_PRESET_OPTIONS[initialValues.utilityType].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {preset === "Other" && (
          <div className="modal-row">
            <label>OTHER:</label>
            <input
              ref={textInputRef}
              className="text-content-input"
              type="text"
              value={customText}
              onChange={(event) => setCustomText(event.target.value.toUpperCase())}
              placeholder="Enter custom utility label"
              autoFocus
            />
          </div>
        )}

        {initialValues.utilityType === "heater" && (
          <div className="modal-row">
            <label>ZONES:</label>
            <div className="modal-chip-row" role="group" aria-label="Heater zones">
              {HEATER_ZONES.map((zone) => {
                const checked = heaterZone === zone;
                return (
                  <label
                    key={zone}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      padding: "0.25rem 0.45rem",
                      border: "1px solid rgba(164, 189, 217, 0.55)",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setHeaterZone((current) => (current === zone ? "" : zone))}
                    />
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        fontSize: "0.66rem",
                        lineHeight: 1,
                      }}
                    >
                      {zone}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="modal-row">
          <label>COLOR:</label>
          <div className="modal-chip-row" role="radiogroup" aria-label="Utility label color">
            {COLORS.map((item) => {
              const swatch = colorSwatch(item);
              const active = color === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={`modal-color-chip ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: swatch.fill, borderColor: swatch.border }}
                  onClick={() => setColor(item)}
                  aria-label={item}
                  aria-pressed={active}
                />
              );
            })}
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ text: resolvedText, color })}
          >
            OKAY
          </button>
          <button type="button" className="cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </section>
    </div>
  );
}
