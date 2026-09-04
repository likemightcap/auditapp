import { useEffect, useMemo, useRef, useState } from "react";

export interface TextModalSubmit {
  text: string;
  color: string;
  size: "small" | "medium" | "large";
}

export interface TextModalInitialValues extends TextModalSubmit {}

interface TextModalProps {
  isOpen: boolean;
  variant?: "modal" | "docked";
  onCollapse?: () => void;
  mode?: "create" | "edit";
  initialValues: TextModalInitialValues;
  onCancel: () => void;
  onSubmit: (payload: TextModalSubmit) => void;
  onLiveChange?: (payload: TextModalSubmit) => void;
}

const CREATE_COLORS = ["WHITE", "GREEN", "RED", "YELLOW"] as const;
const EDIT_COLORS = ["WHITE", "GREEN", "RED", "YELLOW"] as const;
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

export function TextModal({
  isOpen,
  variant = "modal",
  onCollapse,
  mode = "create",
  initialValues,
  onCancel,
  onSubmit,
  onLiveChange,
}: TextModalProps) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("WHITE");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [isLiveChangeReady, setIsLiveChangeReady] = useState(false);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const colors = mode === "edit" ? EDIT_COLORS : CREATE_COLORS;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setIsLiveChangeReady(false);
    setText((initialValues.text ?? "").toUpperCase());
    const nextColor = initialValues.color.toUpperCase();
    if (nextColor === "BLUE") {
      setColor("GREEN");
    } else {
      setColor(nextColor);
    }
    setSize((initialValues.size ?? "medium") as "small" | "medium" | "large");
  }, [initialValues, isOpen, mode]);

  useEffect(() => {
    if (!isOpen) {
      setIsLiveChangeReady(false);
      return;
    }
    const frame = requestAnimationFrame(() => setIsLiveChangeReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialValues, isOpen, mode]);

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

  useEffect(() => {
    if (!isOpen || !onLiveChange || !canSubmit || !isLiveChangeReady) {
      return;
    }
    onLiveChange({ text: text.trim().toUpperCase(), color, size });
  }, [canSubmit, color, isLiveChangeReady, isOpen, size, text]);

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
        <h2>TEXT</h2>

        <div className="modal-row">
          <label>TEXT:</label>
          <input
            ref={textInputRef}
            className="text-content-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value.toUpperCase())}
            placeholder="Type label"
            autoFocus
          />
        </div>

        <div className="modal-row">
          <label>COLOR:</label>
          <div className="modal-chip-row" role="radiogroup" aria-label="Text color">
            {colors.map((item) => {
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
          <div className="modal-chip-row" role="radiogroup" aria-label="Text size">
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

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ text: text.trim().toUpperCase(), color, size })}
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
