import { useEffect, useMemo, useState } from "react";
import {
  FLOOR_PRESET_LABELS,
  FLOOR_PRESET_ORDER,
  floorPresetRank,
  isAtticPreset,
  isBasementPreset,
} from "../constants/floors";
import type { FloorData, FloorPreset } from "../types";

export interface LevelModalSubmit {
  name: string;
  floorPreset: FloorPreset;
  unconditioned: boolean;
  copyFromFloorId?: string;
}

interface LevelModalProps {
  isOpen: boolean;
  title: string;
  mode: "create" | "edit";
  editingFloorId?: string;
  existingFloors: FloorData[];
  initialPreset: FloorPreset;
  initialName: string;
  initialUnconditioned: boolean;
  showDelete: boolean;
  onCancel: () => void;
  onSubmit: (payload: LevelModalSubmit) => void;
  onDelete: () => void;
}

export function LevelModal({
  isOpen,
  title,
  mode,
  editingFloorId,
  existingFloors,
  initialPreset,
  initialUnconditioned,
  showDelete,
  onCancel,
  onSubmit,
  onDelete,
}: LevelModalProps) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<FloorPreset>("FIRST_FLOOR");
  const [unconditioned, setUnconditioned] = useState(false);
  const [copyEnabled, setCopyEnabled] = useState(true);
  const [copyFromFloorId, setCopyFromFloorId] = useState("");

  const getDefaultCopyFromFloorId = (targetPreset: FloorPreset): string => {
    const sortedFloors = [...existingFloors].sort(
      (a, b) => floorPresetRank(a.floorPreset ?? "FIRST_FLOOR") - floorPresetRank(b.floorPreset ?? "FIRST_FLOOR"),
    );
    if (sortedFloors.length === 0) {
      return "";
    }

    if (targetPreset === "BASEMENT_CRAWLSPACE") {
      const firstFloor = sortedFloors.find((floor) => (floor.floorPreset ?? "FIRST_FLOOR") === "FIRST_FLOOR");
      return firstFloor?.id ?? sortedFloors[0].id;
    }

    const targetRank = floorPresetRank(targetPreset);
    for (let rank = targetRank - 1; rank >= 0; rank -= 1) {
      const presetAtRank = FLOOR_PRESET_ORDER[rank];
      if (!presetAtRank) {
        continue;
      }
      const floor = sortedFloors.find((candidate) => (candidate.floorPreset ?? "FIRST_FLOOR") === presetAtRank);
      if (floor) {
        return floor.id;
      }
    }

    const firstFloor = sortedFloors.find((floor) => (floor.floorPreset ?? "FIRST_FLOOR") === "FIRST_FLOOR");
    return firstFloor?.id ?? sortedFloors[0].id;
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName("");
    setPreset(initialPreset);
    setUnconditioned(initialUnconditioned);

    const firstExistingFloorId = getDefaultCopyFromFloorId(initialPreset);
    setCopyEnabled(firstExistingFloorId.length > 0);
    setCopyFromFloorId(firstExistingFloorId);
  }, [existingFloors, initialPreset, initialUnconditioned, isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== "create") {
      return;
    }

    const firstExistingFloorId = getDefaultCopyFromFloorId(preset);

    if (!firstExistingFloorId) {
      setCopyEnabled(false);
      setCopyFromFloorId("");
      return;
    }

    if (copyFromFloorId !== firstExistingFloorId) {
      setCopyFromFloorId(firstExistingFloorId);
    }
  }, [copyFromFloorId, existingFloors, isOpen, mode, preset]);

  const usedPresets = useMemo(() => {
    const next = new Set<FloorPreset>();
    for (const floor of existingFloors) {
      if (editingFloorId && floor.id === editingFloorId) {
        continue;
      }
      if (floor.floorPreset) {
        next.add(floor.floorPreset);
      }
    }
    return next;
  }, [editingFloorId, existingFloors]);

  const canSetUnconditioned = isBasementPreset(preset);
  const isAttic = isAtticPreset(preset);

  const floorOptions = useMemo(
    () =>
      FLOOR_PRESET_ORDER.map((floorPreset) => {
        const floor = existingFloors.find((item) => item.floorPreset === floorPreset);
        return {
          preset: floorPreset,
          floor,
        };
      }),
    [existingFloors],
  );

  const hasAnyExistingFloors = floorOptions.some((option) => Boolean(option.floor));

  if (!isOpen) {
    return null;
  }

  const payload: LevelModalSubmit = {
    name: name.trim().length > 0 ? name.trim() : FLOOR_PRESET_LABELS[preset],
    floorPreset: preset,
    unconditioned: isAttic ? true : canSetUnconditioned ? unconditioned : false,
    copyFromFloorId: mode === "create" && copyEnabled ? copyFromFloorId || undefined : undefined,
  };

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>

        <div className="modal-row">
          <label>PRESET:</label>
          <select
            value={preset}
            onChange={(event) => {
              const nextPreset = event.target.value as FloorPreset;
              setPreset(nextPreset);
            }}
          >
            {FLOOR_PRESET_ORDER.map((floorPreset) => (
              <option key={floorPreset} value={floorPreset} disabled={usedPresets.has(floorPreset)}>
                {FLOOR_PRESET_LABELS[floorPreset]}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-row">
          <label>CUSTOM NAME:</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Custom floor name"
          />
        </div>

        {mode === "create" && hasAnyExistingFloors && (
          <div className="modal-row">
            <label>COPY FLOOR:</label>
            <div className="modal-copy-floor-group">
              <label className="modal-checkbox rect-unconditioned-checkbox">
                <input
                  type="checkbox"
                  checked={copyEnabled}
                  disabled={!hasAnyExistingFloors}
                  onChange={(event) => setCopyEnabled(event.target.checked)}
                />
                Copy floorplan from selected floor
              </label>
              <select
                value={copyFromFloorId}
                disabled={!copyEnabled}
                onChange={(event) => setCopyFromFloorId(event.target.value)}
              >
                {floorOptions.map(({ preset: optionPreset, floor }) => (
                  <option key={optionPreset} value={floor?.id ?? ""} disabled={!floor}>
                    {floor ? floor.name : `${FLOOR_PRESET_LABELS[optionPreset]} (NOT CREATED)`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {canSetUnconditioned && (
          <div className="modal-row">
            <label>UNCONDITIONED:</label>
            <label className="modal-checkbox rect-unconditioned-checkbox">
              <input
                type="checkbox"
                checked={unconditioned}
                onChange={(event) => setUnconditioned(event.target.checked)}
              />
              Exclude this floor from totals
            </label>
          </div>
        )}

        {isAttic && (
          <div className="modal-row">
            <label>UNCONDITIONED:</label>
            <span>Attics are excluded from totals</span>
          </div>
        )}

        <div className="modal-actions level-modal-actions">
          {showDelete && (
            <button type="button" className="danger" onClick={onDelete}>
              DELETE
            </button>
          )}
          <button type="button" className="okay" onClick={() => onSubmit(payload)}>
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
