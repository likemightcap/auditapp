import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(initialName);
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
          <label>NAME:</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
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
