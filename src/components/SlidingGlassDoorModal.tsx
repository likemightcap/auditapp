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

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setWidthFt(clampToPositiveInt(initialWidthFt));
    setHeightFt(clampToPositiveInt(initialHeightFt));
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
            <button type="button" onClick={() => setWidthFt((value) => Math.max(1, value - 1))}>
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={widthFt}
              onChange={(event) => setWidthFt(clampToPositiveInt(Number(event.target.value)))}
            />
            <span className="unit">'</span>
            <button type="button" onClick={() => setWidthFt((value) => Math.max(1, value + 1))}>
              ▲
            </button>
          </div>
        </div>

        <div className="modal-row">
          <label>HEIGHT:</label>
          <div className="stepper">
            <button type="button" onClick={() => setHeightFt((value) => Math.max(1, value - 1))}>
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={heightFt}
              onChange={(event) => setHeightFt(clampToPositiveInt(Number(event.target.value)))}
            />
            <span className="unit">'</span>
            <button type="button" onClick={() => setHeightFt((value) => Math.max(1, value + 1))}>
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
