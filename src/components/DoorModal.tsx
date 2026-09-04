import { useEffect, useMemo, useState } from "react";

export interface DoorModalSubmit {
  widthFt: number;
  heightFt: number;
  mirrored: boolean;
}

interface DoorModalProps {
  isOpen: boolean;
  variant?: "modal" | "docked";
  onCollapse?: () => void;
  title?: string;
  initialWidthFt: number;
  initialHeightFt: number;
  initialMirrored: boolean;
  onCancel: () => void;
  onSubmit: (payload: DoorModalSubmit) => void;
  onLiveChange?: (payload: DoorModalSubmit) => void;
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function DoorModal({
  isOpen,
  variant = "modal",
  onCollapse,
  title = "DOOR",
  initialWidthFt,
  initialHeightFt,
  initialMirrored,
  onCancel,
  onSubmit,
  onLiveChange,
}: DoorModalProps) {
  const [widthFt, setWidthFt] = useState(3);
  const [heightFt, setHeightFt] = useState(7);
  const [widthDraft, setWidthDraft] = useState("3");
  const [heightDraft, setHeightDraft] = useState("7");
  const [mirrored, setMirrored] = useState(false);
  const [isLiveChangeReady, setIsLiveChangeReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setIsLiveChangeReady(false);
    const nextWidth = clampToPositiveInt(initialWidthFt);
    const nextHeight = clampToPositiveInt(initialHeightFt);
    setWidthFt(nextWidth);
    setHeightFt(nextHeight);
    setWidthDraft(String(nextWidth));
    setHeightDraft(String(nextHeight));
    setMirrored(Boolean(initialMirrored));
  }, [initialHeightFt, initialMirrored, initialWidthFt, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsLiveChangeReady(false);
      return;
    }
    const frame = requestAnimationFrame(() => setIsLiveChangeReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [initialHeightFt, initialMirrored, initialWidthFt, isOpen]);

  const canSubmit = useMemo(() => widthFt >= 1 && heightFt >= 1, [heightFt, widthFt]);

  useEffect(() => {
    if (!isOpen || !onLiveChange || !canSubmit || !isLiveChangeReady) {
      return;
    }
    onLiveChange({ widthFt, heightFt, mirrored });
  }, [canSubmit, heightFt, isLiveChangeReady, isOpen, mirrored, widthFt]);

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
        <h2>{title}</h2>

        <div className="modal-row">
          <label>WIDTH:</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => {
                setWidthFt((value) => {
                  const next = Math.max(1, value - 1);
                  setWidthDraft(String(next));
                  return next;
                });
              }}
            >
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={widthDraft}
              onChange={(event) => {
                const raw = event.target.value;
                setWidthDraft(raw);
                if (raw.trim() === "") {
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                setWidthFt(clampToPositiveInt(parsed));
              }}
              onBlur={() => {
                if (widthDraft.trim() === "") {
                  setWidthDraft(String(widthFt));
                  return;
                }
                const parsed = Number(widthDraft);
                if (!Number.isFinite(parsed)) {
                  setWidthDraft(String(widthFt));
                  return;
                }
                const nextWidth = clampToPositiveInt(parsed);
                setWidthFt(nextWidth);
                setWidthDraft(String(nextWidth));
              }}
            />
            <span className="unit">'</span>
            <button
              type="button"
              onClick={() => {
                setWidthFt((value) => {
                  const next = Math.max(1, value + 1);
                  setWidthDraft(String(next));
                  return next;
                });
              }}
            >
              ▲
            </button>
          </div>
        </div>

        <div className="modal-row">
          <label>HEIGHT:</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => {
                setHeightFt((value) => {
                  const next = Math.max(1, value - 1);
                  setHeightDraft(String(next));
                  return next;
                });
              }}
            >
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={heightDraft}
              onChange={(event) => {
                const raw = event.target.value;
                setHeightDraft(raw);
                if (raw.trim() === "") {
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                  return;
                }
                setHeightFt(clampToPositiveInt(parsed));
              }}
              onBlur={() => {
                if (heightDraft.trim() === "") {
                  setHeightDraft(String(heightFt));
                  return;
                }
                const parsed = Number(heightDraft);
                if (!Number.isFinite(parsed)) {
                  setHeightDraft(String(heightFt));
                  return;
                }
                const nextHeight = clampToPositiveInt(parsed);
                setHeightFt(nextHeight);
                setHeightDraft(String(nextHeight));
              }}
            />
            <span className="unit">'</span>
            <button
              type="button"
              onClick={() => {
                setHeightFt((value) => {
                  const next = Math.max(1, value + 1);
                  setHeightDraft(String(next));
                  return next;
                });
              }}
            >
              ▲
            </button>
          </div>
        </div>

        <div className="modal-row">
          <label>MIRROR:</label>
          <button
            type="button"
            className="modal-inline-button"
            onClick={() => setMirrored((value) => !value)}
          >
            {mirrored ? "MIRRORED" : "DEFAULT"}
          </button>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ widthFt, heightFt, mirrored })}
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
