import { useEffect, useMemo, useRef, useState } from "react";
import type { FloorPreset } from "../types";

export type CeilingType = "standard" | "cathedral" | "cathedral-horizontal" | "sloped" | "sloped-horizontal" | "none";

export interface RectangleModalSubmit {
  label: string;
  widthFt: number;
  heightFt: number;
  color: string;
  unconditioned: boolean;
  ceilingType: CeilingType;
  standardHeightFt: number;
  lowHeightFt: number;
  highHeightFt: number;
}

export interface RectangleModalInitialValues extends RectangleModalSubmit {}

interface RectangleModalProps {
  isOpen: boolean;
  variant?: "modal" | "docked";
  onCollapse?: () => void;
  bumpOutHostEdge?: "top" | "bottom" | "left" | "right" | null;
  isAtticFloor?: boolean;
  floorPreset?: FloorPreset;
  floorUnconditioned?: boolean;
  initialValues: RectangleModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: RectangleModalSubmit) => void;
  onLiveChange?: (payload: RectangleModalSubmit) => void;
}

const COLORS = ["BLUE", "GREEN", "RED", "YELLOW"] as const;
const STANDARD_LABEL_OPTIONS = [
  "",
  "Main Structure",
  "Garage",
  "Kneewall",
  "Addition",
  "Sunroom",
  "Bump-Out",
  "Entry",
  "Garage (conditioned)",
  "Custom",
] as const;
const BASEMENT_LABEL_OPTIONS = ["Basement", "Crawlspace", "Slab"] as const;
const ATTIC_LABEL_OPTIONS = ["Flat", "Slope", "Vault", "Storage Space"] as const;

type RectangleLabelOption = string;

function resolveLabelSelection(
  initialLabel: string,
  options: readonly string[],
): { option: RectangleLabelOption; customLabel: string } {
  const trimmed = initialLabel.trim();
  if (!trimmed) {
    return { option: options[0] ?? "", customLabel: "" };
  }

  const matched = options.find(
    (option) => option !== "Custom" && option.toLowerCase() === trimmed.toLowerCase(),
  );

  if (matched) {
    return { option: matched, customLabel: "" };
  }

  if (!options.includes("Custom")) {
    return { option: options[0] ?? "", customLabel: "" };
  }

  return { option: "Custom", customLabel: initialLabel };
}

function normalizeRectangleColor(value: string): string {
  const normalized = String(value).toUpperCase();
  return COLORS.includes(normalized as (typeof COLORS)[number]) ? normalized : "BLUE";
}

function defaultRectangleColorForOptions(unconditioned: boolean, ceilingType: CeilingType): string {
  if (unconditioned) {
    return "RED";
  }
  if (
    ceilingType === "cathedral" ||
    ceilingType === "cathedral-horizontal" ||
    ceilingType === "sloped" ||
    ceilingType === "sloped-horizontal"
  ) {
    return "GREEN";
  }
  return "BLUE";
}

function colorSwatch(color: string): { fill: string; border: string } {
  switch (color.toUpperCase()) {
    case "BLUE":
      return { fill: "#2f8eff", border: "#2a62a8" };
    case "GREEN":
      return { fill: "#2ab56a", border: "#2a8a58" };
    case "RED":
      return { fill: "#d94a43", border: "#9f4945" };
    case "YELLOW":
      return { fill: "#f2ca45", border: "#b28d2d" };
    default:
      return { fill: "#2f8eff", border: "#2a62a8" };
  }
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

function adjustValue(setter: (next: number) => void, current: number, delta: number) {
  setter(clampToPositiveInt(current + delta));
}

function StepperField({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  return (
    <div className="stepper">
      <button type="button" onClick={() => adjustValue(onChange, value, -1)}>
        ▼
      </button>
      <input
        type="number"
        min={1}
        step={1}
        value={draftValue}
        onChange={(event) => {
          const raw = event.target.value;
          setDraftValue(raw);
          if (raw.trim() === "") {
            return;
          }
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            return;
          }
          onChange(clampToPositiveInt(parsed));
        }}
        onBlur={() => {
          if (draftValue.trim() === "") {
            setDraftValue(String(value));
            return;
          }
          const parsed = Number(draftValue);
          if (!Number.isFinite(parsed)) {
            setDraftValue(String(value));
            return;
          }
          const normalized = clampToPositiveInt(parsed);
          onChange(normalized);
          setDraftValue(String(normalized));
        }}
      />
      <span className="unit">'</span>
      <button type="button" onClick={() => adjustValue(onChange, value, 1)}>
        ▲
      </button>
    </div>
  );
}

export function RectangleModal({
  isOpen,
  variant = "modal",
  onCollapse,
  bumpOutHostEdge = null,
  isAtticFloor = false,
  floorPreset,
  floorUnconditioned = false,
  initialValues,
  onCancel,
  onSubmit,
  onLiveChange,
}: RectangleModalProps) {
  const isBasementFloor = floorPreset === "BASEMENT_CRAWLSPACE";
  const labelOptions = isAtticFloor
    ? ATTIC_LABEL_OPTIONS
    : isBasementFloor
      ? BASEMENT_LABEL_OPTIONS
      : STANDARD_LABEL_OPTIONS;
  const supportsCustomLabel = labelOptions.some((option) => option === "Custom");
  const isVerticalBumpOutHost = bumpOutHostEdge === "left" || bumpOutHostEdge === "right";
  const widthLabel = bumpOutHostEdge ? (isVerticalBumpOutHost ? "DEPTH:" : "SPAN:") : "WIDTH:";
  const heightLabel = bumpOutHostEdge ? (isVerticalBumpOutHost ? "SPAN:" : "DEPTH:") : "HEIGHT:";

  const [labelOption, setLabelOption] = useState<RectangleLabelOption>("");
  const [customLabel, setCustomLabel] = useState("");
  const [color, setColor] = useState("BLUE");
  const [widthFt, setWidthFt] = useState(12);
  const [heightFt, setHeightFt] = useState(12);
  const [unconditioned, setUnconditioned] = useState(false);
  const [ceilingType, setCeilingType] = useState<CeilingType>("standard");
  const [standardHeightFt, setStandardHeightFt] = useState(8);
  const [lowHeightFt, setLowHeightFt] = useState(8);
  const [highHeightFt, setHighHeightFt] = useState(12);
  const [colorManuallySet, setColorManuallySet] = useState(false);
  const [isLiveChangeReady, setIsLiveChangeReady] = useState(false);
  const customLabelInputRef = useRef<HTMLInputElement | null>(null);
  const isBasementCrawlspace = isBasementFloor && labelOption === "Crawlspace";
  const isBasementSlab = isBasementFloor && labelOption === "Slab";
  const showBasementCrawlspaceUnconditioned = isBasementCrawlspace && !floorUnconditioned;
  const effectiveUnconditioned = isBasementSlab ? true : unconditioned;
  const effectiveCeilingType: CeilingType = isBasementSlab ? "none" : ceilingType;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setIsLiveChangeReady(false);
    const resolvedLabel = resolveLabelSelection(initialValues.label ?? "", labelOptions);
    setLabelOption(resolvedLabel.option);
    setCustomLabel(resolvedLabel.customLabel);
    setColor(normalizeRectangleColor(initialValues.color));
    setWidthFt(clampToPositiveInt(initialValues.widthFt));
    setHeightFt(clampToPositiveInt(initialValues.heightFt));
    setUnconditioned(Boolean(initialValues.unconditioned));
    setCeilingType(initialValues.ceilingType);
    setStandardHeightFt(clampToPositiveInt(initialValues.standardHeightFt));
    setLowHeightFt(clampToPositiveInt(initialValues.lowHeightFt));
    setHighHeightFt(clampToPositiveInt(initialValues.highHeightFt));
    setColorManuallySet(false);

    if (isAtticFloor) {
      setCeilingType("standard");
      setStandardHeightFt(8);
      setLowHeightFt(8);
      setHighHeightFt(12);
    }
  }, [initialValues, isAtticFloor, isOpen, labelOptions]);

  useEffect(() => {
    if (!isOpen) {
      setIsLiveChangeReady(false);
      return;
    }
    const frame = requestAnimationFrame(() => setIsLiveChangeReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialValues, isAtticFloor, isOpen, labelOptions]);

  useEffect(() => {
    if (!isOpen || !supportsCustomLabel || labelOption !== "Custom") {
      return;
    }
    requestAnimationFrame(() => {
      customLabelInputRef.current?.focus();
      customLabelInputRef.current?.select();
    });
  }, [isOpen, labelOption, supportsCustomLabel]);

  const canSubmit = useMemo(() => {
    if (widthFt < 1 || heightFt < 1) {
      return false;
    }
    if (isAtticFloor) {
      return true;
    }
    if (effectiveCeilingType === "none") {
      return true;
    }
    if (effectiveCeilingType === "standard") {
      return standardHeightFt >= 1;
    }
    if (effectiveCeilingType === "cathedral" || effectiveCeilingType === "cathedral-horizontal") {
      return lowHeightFt >= 1 && highHeightFt >= 1 && highHeightFt >= lowHeightFt;
    }
    return lowHeightFt >= 1 && highHeightFt >= 1;
  }, [effectiveCeilingType, heightFt, highHeightFt, isAtticFloor, lowHeightFt, standardHeightFt, widthFt]);

  const sideLabels = useMemo(() => {
    if (ceilingType === "sloped-horizontal") {
      return { first: "LEFT:", second: "RIGHT:" };
    }
    if (ceilingType === "sloped") {
      return { first: "TOP:", second: "BOTTOM:" };
    }
    return { first: "HIGH:", second: "LOW:" };
  }, [ceilingType]);

  useEffect(() => {
    if (!isOpen || !onLiveChange || !canSubmit || !isLiveChangeReady) {
      return;
    }

    onLiveChange({
      label: supportsCustomLabel && labelOption === "Custom" ? customLabel.trim() : labelOption,
      color,
      widthFt,
      heightFt,
      unconditioned: effectiveUnconditioned,
      ceilingType: isAtticFloor ? "standard" : effectiveCeilingType,
      standardHeightFt: isAtticFloor ? 8 : standardHeightFt,
      highHeightFt: isAtticFloor ? 12 : highHeightFt,
      lowHeightFt: isAtticFloor ? 8 : lowHeightFt,
    });
  }, [
    canSubmit,
    color,
    customLabel,
    effectiveCeilingType,
    effectiveUnconditioned,
    heightFt,
    highHeightFt,
    isLiveChangeReady,
    isAtticFloor,
    isOpen,
    labelOption,
    lowHeightFt,
    standardHeightFt,
    supportsCustomLabel,
    widthFt,
  ]);

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
        className={`rectangle-modal ${isDocked ? "modal-panel-docked" : ""}`}
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
        <h2>RECTANGLE</h2>

        <div className="modal-row">
          <label>PRESET:</label>
          <select
            value={labelOption}
            onChange={(event) => {
              const nextOption = event.target.value as RectangleLabelOption;
              setLabelOption(nextOption);
              if (!supportsCustomLabel || nextOption !== "Custom") {
                setCustomLabel("");
              }

              if (nextOption === "Garage" || nextOption === "Sunroom" || nextOption === "Kneewall") {
                setUnconditioned(true);
                setColor("RED");
                setColorManuallySet(false);
              }

              if (isAtticFloor) {
                if (nextOption === "Slope" || nextOption === "Vault") {
                  setColor("YELLOW");
                  setColorManuallySet(false);
                } else if (nextOption === "Storage Space") {
                  setColor("BLUE");
                  setColorManuallySet(false);
                } else if (nextOption === "Flat") {
                  setColor("RED");
                  setColorManuallySet(false);
                }
              }

              if (isBasementFloor && nextOption === "Crawlspace") {
                setColor("YELLOW");
                setColorManuallySet(false);
                setCeilingType("standard");
                setStandardHeightFt(4);
              }

              if (isBasementFloor && nextOption === "Slab") {
                setColor("RED");
                setColorManuallySet(false);
                setCeilingType("none");
                setUnconditioned(true);
              }

              if (isBasementFloor && nextOption === "Basement") {
                setUnconditioned(false);
              }
            }}
          >
            {labelOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {supportsCustomLabel && labelOption === "Custom" && (
          <div className="modal-row">
            <label>CUSTOM LABEL:</label>
            <input
              ref={customLabelInputRef}
              type="text"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="Type custom label"
              autoFocus
            />
          </div>
        )}

        <div className="modal-row">
          <label>COLOR:</label>
          <div className="modal-chip-row" role="radiogroup" aria-label="Rectangle color">
            {COLORS.map((item) => {
              const swatch = colorSwatch(item);
              const active = color === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={`modal-color-chip ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: swatch.fill, borderColor: swatch.border }}
                  onClick={() => {
                    setColor(item);
                    setColorManuallySet(true);
                  }}
                  aria-label={item}
                  aria-pressed={active}
                />
              );
            })}
          </div>
        </div>

        <div className="modal-row">
          <label>{widthLabel}</label>
          <StepperField value={widthFt} onChange={setWidthFt} />
        </div>

        <div className="modal-row">
          <label>{heightLabel}</label>
          <StepperField value={heightFt} onChange={setHeightFt} />
        </div>

        {!isAtticFloor && (!isBasementFloor || showBasementCrawlspaceUnconditioned) && (
          <div className="modal-row">
            <label>UNCONDITIONED:</label>
            <label className="modal-checkbox rect-unconditioned-checkbox" htmlFor="rectUnconditioned">
              <input
                id="rectUnconditioned"
                type="checkbox"
                checked={unconditioned}
                onChange={(event) => {
                  const nextUnconditioned = event.target.checked;
                  setUnconditioned(nextUnconditioned);
                  if (!colorManuallySet && !isBasementFloor) {
                    setColor(defaultRectangleColorForOptions(nextUnconditioned, ceilingType));
                  }
                }}
              />
              <span>Exclude from area and volume</span>
            </label>
          </div>
        )}

        {isAtticFloor && (
          <div className="modal-row">
            <label>EXCLUDE:</label>
            <label className="modal-checkbox rect-unconditioned-checkbox" htmlFor="rectAtticUnconditioned">
              <input
                id="rectAtticUnconditioned"
                type="checkbox"
                checked={unconditioned}
                onChange={(event) => setUnconditioned(event.target.checked)}
              />
              <span>Exclude from total attic area</span>
            </label>
          </div>
        )}

        {!isAtticFloor && (
          <>
            <div className="modal-row ceiling-row">
              <label>CEILING TYPE:</label>
              <select
                value={isBasementSlab ? "none" : ceilingType}
                disabled={isBasementSlab}
                onChange={(event) => {
                  if (isBasementSlab) {
                    return;
                  }
                  const nextCeilingType = event.target.value as CeilingType;
                  setCeilingType(nextCeilingType);
                  if (!colorManuallySet) {
                    setColor(defaultRectangleColorForOptions(unconditioned, nextCeilingType));
                  }
                }}
              >
                <option value="none">NO CEILING</option>
                <option value="standard">STANDARD</option>
                <option value="cathedral">CATHEDRAL (VERTICAL)</option>
                <option value="cathedral-horizontal">CATHEDRAL (HORIZONTAL)</option>
                <option value="sloped">SLOPED (VERTICAL)</option>
                <option value="sloped-horizontal">SLOPED (HORIZONTAL)</option>
              </select>
            </div>

            {effectiveCeilingType === "none" ? null : effectiveCeilingType === "standard" ? (
              <div className="modal-row">
                <label>{isBasementFloor && labelOption === "Crawlspace" ? "HEIGHT:" : "CEILING HEIGHT:"}</label>
                <StepperField value={standardHeightFt} onChange={setStandardHeightFt} />
              </div>
            ) : (
              <div className="dual-heights">
                <div className="compact-input-row">
                  <label>{sideLabels.first}</label>
                  <StepperField value={highHeightFt} onChange={setHighHeightFt} />
                </div>
                <div className="compact-input-row">
                  <label>{sideLabels.second}</label>
                  <StepperField value={lowHeightFt} onChange={setLowHeightFt} />
                </div>
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                label: supportsCustomLabel && labelOption === "Custom" ? customLabel.trim() : labelOption,
                color,
                widthFt,
                heightFt,
                unconditioned: effectiveUnconditioned,
                ceilingType: isAtticFloor ? "standard" : effectiveCeilingType,
                standardHeightFt: isAtticFloor ? 8 : standardHeightFt,
                highHeightFt: isAtticFloor ? 12 : highHeightFt,
                lowHeightFt: isAtticFloor ? 8 : lowHeightFt,
              })
            }
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
