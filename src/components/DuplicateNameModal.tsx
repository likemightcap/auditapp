import { useEffect, useMemo, useState } from "react";

const COMMON_LEVEL_NAMES = ["1st Floor", "2nd Floor", "Basement", "Attic"] as const;

export interface DuplicateNameModalSubmit {
  name: string;
  unconditioned: boolean;
}

interface DuplicateNameModalProps {
  isOpen: boolean;
  initialName: string;
  initialUnconditioned: boolean;
  onCancel: () => void;
  onSubmit: (payload: DuplicateNameModalSubmit) => void;
}

export function DuplicateNameModal({
  isOpen,
  initialName,
  initialUnconditioned,
  onCancel,
  onSubmit,
}: DuplicateNameModalProps) {
  const [name, setName] = useState("");
  const [commonLevel, setCommonLevel] = useState("");
  const [unconditioned, setUnconditioned] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(initialName);
    setCommonLevel(COMMON_LEVEL_NAMES.includes(initialName as (typeof COMMON_LEVEL_NAMES)[number]) ? initialName : "");
    setUnconditioned(initialUnconditioned);
  }, [initialName, initialUnconditioned, isOpen]);

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>DUPLICATE NAME</h2>

        <div className="modal-row">
          <label>COMMON LEVEL:</label>
          <select
            value={commonLevel}
            onChange={(event) => {
              const value = event.target.value;
              setCommonLevel(value);
              if (value) {
                setName(value);
              }
            }}
          >
            <option value="">Custom</option>
            {COMMON_LEVEL_NAMES.map((levelName) => (
              <option key={levelName} value={levelName}>
                {levelName}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-row">
          <label>NAME:</label>
          <input
            type="text"
            value={name}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              setCommonLevel(
                COMMON_LEVEL_NAMES.includes(nextName as (typeof COMMON_LEVEL_NAMES)[number]) ? nextName : "",
              );
            }}
            placeholder="Name for duplicate level"
          />
        </div>

        <div className="modal-row">
          <label>UNCONDITIONED:</label>
          <label className="modal-checkbox rect-unconditioned-checkbox">
            <input
              type="checkbox"
              checked={unconditioned}
              onChange={(event) => setUnconditioned(event.target.checked)}
            />
            Exclude this level from totals
          </label>
        </div>

        <div className="modal-actions level-modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), unconditioned })}
          >
            DUPLICATE
          </button>
          <button type="button" className="cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </section>
    </div>
  );
}
