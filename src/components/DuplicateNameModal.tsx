import { useEffect, useMemo, useState } from "react";

const COMMON_LEVEL_NAMES = ["1st Floor", "2nd Floor", "Basement", "Attic"] as const;

interface DuplicateNameModalProps {
  isOpen: boolean;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function DuplicateNameModal({
  isOpen,
  initialName,
  onCancel,
  onSubmit,
}: DuplicateNameModalProps) {
  const [name, setName] = useState("");
  const [commonLevel, setCommonLevel] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(initialName);
    setCommonLevel(COMMON_LEVEL_NAMES.includes(initialName as (typeof COMMON_LEVEL_NAMES)[number]) ? initialName : "");
  }, [initialName, isOpen]);

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

        <div className="modal-actions level-modal-actions">
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit(name.trim())}
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
