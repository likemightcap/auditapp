import { useEffect, useMemo, useState } from "react";

export interface BumpOutModalSubmit {
  flats: 3 | 4 | 5 | 6;
  longEdgeFt: number;
}

interface BumpOutModalProps {
  isOpen: boolean;
  initialFlats: 3 | 4 | 5 | 6;
  initialLongEdgeFt: number;
  onCancel: () => void;
  onSubmit: (payload: BumpOutModalSubmit) => void;
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

function bumpOutPath(flats: 3 | 4 | 5 | 6): string {
  if (flats === 3) {
    return "M 3 20 L 21 20 L 16 8 L 8 8 Z";
  }
  if (flats === 4) {
    return "M 3 20 L 21 20 L 19 11 L 12 8 L 5 11 Z";
  }
  if (flats === 5) {
    return "M 3 20 L 21 20 L 21 13 L 17 8 L 7 8 L 3 13 Z";
  }
  return "M 3 20 L 21 20 L 21 14 L 18.5 10.3 L 12 8 L 5.5 10.3 L 3 14 Z";
}

const FLAT_OPTIONS: Array<{ flats: 3 | 4 | 5 | 6 }> = [
  { flats: 3 },
  { flats: 4 },
  { flats: 5 },
  { flats: 6 },
];

export function BumpOutModal({ isOpen, initialFlats, initialLongEdgeFt, onCancel, onSubmit }: BumpOutModalProps) {
  const [flats, setFlats] = useState<3 | 4 | 5 | 6>(5);
  const [longEdgeFt, setLongEdgeFt] = useState(8);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setFlats(initialFlats);
    setLongEdgeFt(clampToPositiveInt(initialLongEdgeFt));
  }, [initialFlats, initialLongEdgeFt, isOpen]);

  const canSubmit = useMemo(() => longEdgeFt >= 1, [longEdgeFt]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal bumpout-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>BUMP OUT</h2>

        <div className="modal-row">
          <label>STYLE:</label>
          <div className="bumpout-style-grid" role="radiogroup" aria-label="Bump out style">
            {FLAT_OPTIONS.map((option) => {
              const active = flats === option.flats;
              return (
                <button
                  key={option.flats}
                  type="button"
                  className={`bumpout-style-btn ${active ? "is-active" : ""}`}
                  onClick={() => setFlats(option.flats)}
                  aria-pressed={active}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={bumpOutPath(option.flats)} fill="rgba(29,112,192,0.12)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                  <span>{option.flats}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="modal-row">
          <label>LONG EDGE:</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => {
                setLongEdgeFt((current) => Math.max(1, current - 1));
              }}
            >
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={longEdgeFt}
              onChange={(event) => setLongEdgeFt(clampToPositiveInt(Number(event.target.value)))}
            />
            <span className="unit">'</span>
            <button
              type="button"
              onClick={() => {
                setLongEdgeFt((current) => Math.max(1, current + 1));
              }}
            >
              ▲
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="okay" disabled={!canSubmit} onClick={() => onSubmit({ flats, longEdgeFt })}>
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
