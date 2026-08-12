import { useEffect, useMemo, useState } from "react";

export interface DoorModalSubmit {
  heightFt: number;
  mirrored: boolean;
}

interface DoorModalProps {
  isOpen: boolean;
  initialHeightFt: number;
  initialMirrored: boolean;
  onCancel: () => void;
  onSubmit: (payload: DoorModalSubmit) => void;
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function DoorModal({ isOpen, initialHeightFt, initialMirrored, onCancel, onSubmit }: DoorModalProps) {
  const [heightFt, setHeightFt] = useState(7);
  const [mirrored, setMirrored] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setHeightFt(clampToPositiveInt(initialHeightFt));
    setMirrored(Boolean(initialMirrored));
  }, [initialHeightFt, initialMirrored, isOpen]);

  const canSubmit = useMemo(() => heightFt >= 1, [heightFt]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>DOOR</h2>

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
            onClick={() => onSubmit({ heightFt, mirrored })}
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
