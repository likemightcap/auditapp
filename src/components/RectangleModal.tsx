import { useEffect, useMemo, useRef, useState } from "react";

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
  isAtticFloor?: boolean;
  initialValues: RectangleModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: RectangleModalSubmit) => void;
}

const COLORS = ["BLUE", "GREEN", "RED", "YELLOW"] as const;

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
  return (
    <div className="stepper">
      <button type="button" onClick={() => adjustValue(onChange, value, -1)}>
        ▼
      </button>
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        onChange={(event) => onChange(clampToPositiveInt(Number(event.target.value)))}
      />
      <span className="unit">'</span>
      <button type="button" onClick={() => adjustValue(onChange, value, 1)}>
        ▲
      </button>
    </div>
  );
}

export function RectangleModal({ isOpen, isAtticFloor = false, initialValues, onCancel, onSubmit }: RectangleModalProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("BLUE");
  const [widthFt, setWidthFt] = useState(12);
  const [heightFt, setHeightFt] = useState(12);
  const [unconditioned, setUnconditioned] = useState(false);
  const [ceilingType, setCeilingType] = useState<CeilingType>("standard");
  const [standardHeightFt, setStandardHeightFt] = useState(8);
  const [lowHeightFt, setLowHeightFt] = useState(8);
  const [highHeightFt, setHighHeightFt] = useState(12);
  const [colorManuallySet, setColorManuallySet] = useState(false);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLabel(initialValues.label ?? "");
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
      setUnconditioned(false);
      setCeilingType("standard");
      setStandardHeightFt(8);
      setLowHeightFt(8);
      setHighHeightFt(12);
    }
  }, [initialValues, isAtticFloor, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestAnimationFrame(() => {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    });
  }, [isOpen]);

  const canSubmit = useMemo(() => {
    if (widthFt < 1 || heightFt < 1) {
      return false;
    }
    if (isAtticFloor) {
      return true;
    }
    if (ceilingType === "none") {
      return true;
    }
    if (ceilingType === "standard") {
      return standardHeightFt >= 1;
    }
    if (ceilingType === "cathedral" || ceilingType === "cathedral-horizontal") {
      return lowHeightFt >= 1 && highHeightFt >= 1 && highHeightFt >= lowHeightFt;
    }
    return lowHeightFt >= 1 && highHeightFt >= 1;
  }, [ceilingType, heightFt, highHeightFt, isAtticFloor, lowHeightFt, standardHeightFt, widthFt]);

  const sideLabels = useMemo(() => {
    if (ceilingType === "sloped-horizontal") {
      return { first: "LEFT:", second: "RIGHT:" };
    }
    if (ceilingType === "sloped") {
      return { first: "TOP:", second: "BOTTOM:" };
    }
    return { first: "HIGH:", second: "LOW:" };
  }, [ceilingType]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="rectangle-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>RECTANGLE</h2>

        <div className="modal-row">
          <label>LABEL:</label>
          <input
            ref={labelInputRef}
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Optional"
            autoFocus
          />
        </div>

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
          <label>WIDTH:</label>
          <StepperField value={widthFt} onChange={setWidthFt} />
        </div>

        <div className="modal-row">
          <label>HEIGHT:</label>
          <StepperField value={heightFt} onChange={setHeightFt} />
        </div>

        {!isAtticFloor && (
          <>
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
                    if (!colorManuallySet) {
                      setColor(defaultRectangleColorForOptions(nextUnconditioned, ceilingType));
                    }
                  }}
                />
                <span>Exclude from area and volume</span>
              </label>
            </div>

            <div className="modal-row ceiling-row">
              <label>CEILING TYPE:</label>
              <select
                value={ceilingType}
                onChange={(event) => {
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

            {ceilingType === "none" ? null : ceilingType === "standard" ? (
              <div className="modal-row">
                <label>CEILING HEIGHT:</label>
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
                label,
                color,
                widthFt,
                heightFt,
                unconditioned: isAtticFloor ? false : unconditioned,
                ceilingType: isAtticFloor ? "standard" : ceilingType,
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
