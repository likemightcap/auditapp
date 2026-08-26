import { useEffect, useMemo, useState } from "react";

export interface SlidingGlassDoorModalSubmit {
  widthFt: number;
  heightFt: number;
}

interface SlidingGlassDoorModalProps {
  isOpen: boolean;
  initialWidthFt: number;
  initialHeightFt: number;
  onCancel: () => void;
  onSubmit: (payload: SlidingGlassDoorModalSubmit) => void;
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function SlidingGlassDoorModal({
  isOpen,
  initialWidthFt,
  initialHeightFt,
  onCancel,
  onSubmit,
}: SlidingGlassDoorModalProps) {
  const [widthFt, setWidthFt] = useState(6);
  const [heightFt, setHeightFt] = useState(7);
  const [widthDraft, setWidthDraft] = useState("6");
  const [heightDraft, setHeightDraft] = useState("7");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextWidth = clampToPositiveInt(initialWidthFt);
    const nextHeight = clampToPositiveInt(initialHeightFt);
    setWidthFt(nextWidth);
    setHeightFt(nextHeight);
    setWidthDraft(String(nextWidth));
    setHeightDraft(String(nextHeight));
  }, [initialHeightFt, initialWidthFt, isOpen]);

  const canSubmit = useMemo(() => widthFt >= 1 && heightFt >= 1, [heightFt, widthFt]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>SLIDING GLASS DOOR</h2>

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

        <div className="modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ widthFt, heightFt })}
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
