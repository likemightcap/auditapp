import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

export type CeilingType = "standard" | "cathedral" | "cathedral-horizontal" | "sloped" | "sloped-horizontal" | "none";

export interface RectangleModalSubmit {
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
  initialValues: RectangleModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: RectangleModalSubmit) => void;
}

const COLORS = ["WHITE", "BLUE", "RED", "YELLOW"] as const;

function colorCellStyles(color: string): CSSProperties {
  switch (color.toUpperCase()) {
    case "BLUE":
      return { background: "#2f8eff", color: "#ffffff" };
    case "RED":
      return { background: "#d94a43", color: "#ffffff" };
    case "YELLOW":
      return { background: "#f2ca45", color: "#4c5452" };
    case "WHITE":
    default:
      return { background: "#ffffff", color: "#6f8680" };
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

export function RectangleModal({ isOpen, initialValues, onCancel, onSubmit }: RectangleModalProps) {
  const [color, setColor] = useState("WHITE");
  const [widthFt, setWidthFt] = useState(12);
  const [heightFt, setHeightFt] = useState(12);
  const [unconditioned, setUnconditioned] = useState(false);
  const [ceilingType, setCeilingType] = useState<CeilingType>("standard");
  const [standardHeightFt, setStandardHeightFt] = useState(8);
  const [lowHeightFt, setLowHeightFt] = useState(8);
  const [highHeightFt, setHighHeightFt] = useState(12);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setColor(initialValues.color.toUpperCase());
    setWidthFt(clampToPositiveInt(initialValues.widthFt));
    setHeightFt(clampToPositiveInt(initialValues.heightFt));
    setUnconditioned(Boolean(initialValues.unconditioned));
    setCeilingType(initialValues.ceilingType);
    setStandardHeightFt(clampToPositiveInt(initialValues.standardHeightFt));
    setLowHeightFt(clampToPositiveInt(initialValues.lowHeightFt));
    setHighHeightFt(clampToPositiveInt(initialValues.highHeightFt));
  }, [initialValues, isOpen]);

  const canSubmit = useMemo(() => {
    if (widthFt < 1 || heightFt < 1) {
      return false;
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
  }, [ceilingType, heightFt, highHeightFt, lowHeightFt, standardHeightFt, widthFt]);

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
          <label>COLOR:</label>
          <select value={color} style={colorCellStyles(color)} onChange={(event) => setColor(event.target.value)}>
            {COLORS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-row">
          <label>WIDTH:</label>
          <StepperField value={widthFt} onChange={setWidthFt} />
        </div>

        <div className="modal-row">
          <label>HEIGHT:</label>
          <StepperField value={heightFt} onChange={setHeightFt} />
        </div>

        <div className="modal-row">
          <label>UNCONDITIONED:</label>
          <label className="modal-checkbox" htmlFor="rectUnconditioned">
            <input
              id="rectUnconditioned"
              type="checkbox"
              checked={unconditioned}
              onChange={(event) => setUnconditioned(event.target.checked)}
            />
            <span>Exclude from area and volume</span>
          </label>
        </div>

        <div className="modal-row ceiling-row">
          <label>CEILING TYPE:</label>
          <select value={ceilingType} onChange={(event) => setCeilingType(event.target.value as CeilingType)}>
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

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                color,
                widthFt,
                heightFt,
                unconditioned,
                ceilingType,
                standardHeightFt,
                highHeightFt,
                lowHeightFt,
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
