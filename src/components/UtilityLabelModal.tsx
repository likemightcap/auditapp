import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

export interface UtilityLabelSubmit {
  text: string;
  color: string;
}

export interface UtilityLabelInitialValues extends UtilityLabelSubmit {}

interface UtilityLabelModalProps {
  isOpen: boolean;
  initialValues: UtilityLabelInitialValues;
  onCancel: () => void;
  onSubmit: (payload: UtilityLabelSubmit) => void;
}

const COLORS = ["WHITE", "BLUE", "RED", "YELLOW"] as const;

function colorCellStyles(color: string): CSSProperties {
  switch (color.toUpperCase()) {
    case "BLUE":
      return { background: "#1117ff", color: "#ffffff" };
    case "RED":
      return { background: "#e00000", color: "#ffffff" };
    case "YELLOW":
      return { background: "#ffed00", color: "#4c5452" };
    case "WHITE":
    default:
      return { background: "#ffffff", color: "#6f8680" };
  }
}

export function UtilityLabelModal({
  isOpen,
  initialValues,
  onCancel,
  onSubmit,
}: UtilityLabelModalProps) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("WHITE");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText((initialValues.text ?? "").toUpperCase());
    setColor(initialValues.color.toUpperCase());
  }, [initialValues, isOpen]);

  const canSubmit = useMemo(() => text.trim().length > 0, [text]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>UTILITY LABEL</h2>

        <div className="modal-row">
          <label>TEXT:</label>
          <input
            className="text-content-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value.toUpperCase())}
            placeholder="Name this utility"
          />
        </div>

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

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ text: text.trim().toUpperCase(), color })}
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
