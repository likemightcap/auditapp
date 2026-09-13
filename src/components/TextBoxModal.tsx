import { useEffect, useMemo, useRef, useState } from "react";

export interface TextBoxModalSubmit {
  text: string;
  color: string;
  size: "small" | "medium" | "large";
  widthFt: number;
  heightFt: number;
}

export interface TextBoxModalInitialValues extends TextBoxModalSubmit {}

interface TextBoxModalProps {
  isOpen: boolean;
  mode?: "create" | "edit";
  initialValues: TextBoxModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: TextBoxModalSubmit) => void;
}

const COLORS = ["WHITE", "GREEN", "RED", "YELLOW"] as const;
const SIZES = ["small", "medium", "large"] as const;

function colorSwatch(color: string): { fill: string; border: string } {
  switch (color.toUpperCase()) {
    case "GREEN":
      return { fill: "#00ff6a", border: "#0f9b4f" };
    case "RED":
      return { fill: "#e00000", border: "#8c3030" };
    case "YELLOW":
      return { fill: "#ffed00", border: "#b99f1d" };
    case "WHITE":
    default:
      return { fill: "#ffffff", border: "#a9bfdc" };
  }
}

function clampPositiveInt(value: number, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(1, Math.round(normalized));
}

export function TextBoxModal({ isOpen, mode = "create", initialValues, onCancel, onSubmit }: TextBoxModalProps) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("WHITE");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [widthFt, setWidthFt] = useState("12");
  const [heightFt, setHeightFt] = useState("8");
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setText(initialValues.text ?? "");
    const nextColor = String(initialValues.color ?? "WHITE").toUpperCase();
    setColor(nextColor === "BLUE" ? "GREEN" : nextColor);
    const nextSize = String(initialValues.size ?? "medium").toLowerCase();
    setSize(nextSize === "small" || nextSize === "large" ? nextSize : "medium");
    setWidthFt(String(clampPositiveInt(initialValues.widthFt, 12)));
    setHeightFt(String(clampPositiveInt(initialValues.heightFt, 8)));
  }, [initialValues, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestAnimationFrame(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.select();
    });
  }, [isOpen]);

  const canSubmit = useMemo(() => text.trim().length > 0, [text]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal text-box-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>{mode === "edit" ? "TEXT BOX" : "NEW TEXT BOX"}</h2>

        <div className="modal-row">
          <label>WIDTH:</label>
          <input
            type="number"
            min={1}
            step={1}
            value={widthFt}
            onChange={(event) => setWidthFt(event.target.value)}
          />
        </div>

        <div className="modal-row">
          <label>HEIGHT:</label>
          <input
            type="number"
            min={1}
            step={1}
            value={heightFt}
            onChange={(event) => setHeightFt(event.target.value)}
          />
        </div>

        <div className="modal-row">
          <label>COLOR:</label>
          <div className="modal-chip-row" role="radiogroup" aria-label="Text box color">
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

        <div className="modal-row">
          <label>SIZE:</label>
          <div className="modal-chip-row" role="radiogroup" aria-label="Text box text size">
            {SIZES.map((item) => {
              const active = size === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={`modal-size-chip modal-size-${item} ${active ? "is-active" : ""}`}
                  onClick={() => setSize(item)}
                  aria-label={item}
                  aria-pressed={active}
                >
                  A
                </button>
              );
            })}
          </div>
        </div>

        <div className="modal-column">
          <label>TEXT:</label>
          <textarea
            ref={textAreaRef}
            className="text-box-content-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type text"
            rows={8}
            autoFocus
          />
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                text: text.trim(),
                color,
                size,
                widthFt: clampPositiveInt(Number(widthFt), 12),
                heightFt: clampPositiveInt(Number(heightFt), 8),
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
