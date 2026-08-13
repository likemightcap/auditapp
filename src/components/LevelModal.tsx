import { useEffect, useMemo, useState } from "react";

export interface LevelModalSubmit {
  name: string;
  unconditioned: boolean;
}

interface LevelModalProps {
  isOpen: boolean;
  title: string;
  initialName: string;
  initialUnconditioned: boolean;
  showDuplicate: boolean;
  showDelete: boolean;
  onCancel: () => void;
  onSubmit: (payload: LevelModalSubmit) => void;
  onDuplicate: (payload: LevelModalSubmit) => void;
  onDelete: () => void;
}

export function LevelModal({
  isOpen,
  title,
  initialName,
  initialUnconditioned,
  showDuplicate,
  showDelete,
  onCancel,
  onSubmit,
  onDuplicate,
  onDelete,
}: LevelModalProps) {
  const [name, setName] = useState("");
  const [unconditioned, setUnconditioned] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(initialName);
    setUnconditioned(initialUnconditioned);
  }, [initialName, initialUnconditioned, isOpen]);

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);

  if (!isOpen) {
    return null;
  }

  const payload: LevelModalSubmit = {
    name: name.trim(),
    unconditioned,
  };

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>

        <div className="modal-row">
          <label>NAME:</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Level name"
          />
        </div>

        <div className="modal-row">
          <label>UNCONDITIONED:</label>
          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={unconditioned}
              onChange={(event) => setUnconditioned(event.target.checked)}
            />
            Exclude this level from totals
          </label>
        </div>

        <div className="modal-actions level-modal-actions">
          {showDelete && (
            <button type="button" className="danger" onClick={onDelete}>
              DELETE
            </button>
          )}
          {showDuplicate && (
            <button
              type="button"
              className="cancel"
              disabled={!canSubmit}
              onClick={() => onDuplicate(payload)}
            >
              DUPLICATE
            </button>
          )}
          <button
            type="button"
            className="okay"
            disabled={!canSubmit}
            onClick={() => onSubmit(payload)}
          >
            SAVE
          </button>
          <button type="button" className="cancel" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </section>
    </div>
  );
}
