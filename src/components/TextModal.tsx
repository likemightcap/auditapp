import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

export interface TextModalSubmit {
  text: string;
  color: string;
}

export interface TextModalInitialValues extends TextModalSubmit {}

interface TextModalProps {
  isOpen: boolean;
  initialValues: TextModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: TextModalSubmit) => void;
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

export function TextModal({ isOpen, initialValues, onCancel, onSubmit }: TextModalProps) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("WHITE");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText(initialValues.text);
    setColor(initialValues.color.toUpperCase());
  }, [initialValues, isOpen]);

  const canSubmit = useMemo(() => text.trim().length > 0, [text]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>TEXT</h2>

        <div className="modal-row">
          <label>TEXT:</label>
          <input
            className="text-content-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type label"
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
            onClick={() => onSubmit({ text: text.trim(), color })}
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
