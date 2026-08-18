import { useEffect, useMemo, useRef, useState } from "react";

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
  initialValues,
  onCancel,
  onSubmit,
}: UtilityLabelModalProps) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("WHITE");
  const textInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText((initialValues.text ?? "").toUpperCase());
    setColor(initialValues.color.toUpperCase());
  }, [initialValues, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    });
  }, [isOpen]);

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
            ref={textInputRef}
            className="text-content-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value.toUpperCase())}
            placeholder="Name this utility"
            autoFocus
          />
        </div>

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
