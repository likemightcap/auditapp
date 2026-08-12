import { useEffect, useMemo, useState } from "react";

export interface WindowModalSubmit {
  widthFt: number;
  heightFt: number;
}

interface WindowModalProps {
  isOpen: boolean;
  initialWidthFt: number;
  initialHeightFt: number;
  onCancel: () => void;
  onSubmit: (payload: WindowModalSubmit) => void;
}

const WINDOW_PRESETS: Array<{ widthFt: number; heightFt: number }> = [
  { widthFt: 2, heightFt: 3 },
  { widthFt: 3, heightFt: 4 },
  { widthFt: 3, heightFt: 5 },
  { widthFt: 3, heightFt: 6 },
  { widthFt: 4, heightFt: 4 },
  { widthFt: 4, heightFt: 5 },
  { widthFt: 5, heightFt: 4 },
  { widthFt: 6, heightFt: 4 },
];

const CUSTOM_PRESET_KEY = "custom";

function presetKey(widthFt: number, heightFt: number): string {
  return `${widthFt}x${heightFt}`;
}

function findPresetKey(widthFt: number, heightFt: number): string | null {
  const found = WINDOW_PRESETS.find((preset) => preset.widthFt === widthFt && preset.heightFt === heightFt);
  return found ? presetKey(found.widthFt, found.heightFt) : null;
}

function clampToPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.round(value));
}

export function WindowModal({ isOpen, initialWidthFt, initialHeightFt, onCancel, onSubmit }: WindowModalProps) {
  const [widthFt, setWidthFt] = useState(3);
  const [heightFt, setHeightFt] = useState(4);
  const [selectedPreset, setSelectedPreset] = useState<string>(presetKey(3, 4));

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextWidth = clampToPositiveInt(initialWidthFt);
    const nextHeight = clampToPositiveInt(initialHeightFt);
    const nextPresetKey = findPresetKey(nextWidth, nextHeight);
    setWidthFt(nextWidth);
    setHeightFt(nextHeight);
    setSelectedPreset(nextPresetKey ?? CUSTOM_PRESET_KEY);
  }, [initialHeightFt, initialWidthFt, isOpen]);

  const canSubmit = useMemo(() => widthFt >= 1 && heightFt >= 1, [heightFt, widthFt]);

  const syncPresetFromValues = (nextWidth: number, nextHeight: number) => {
    const matched = findPresetKey(nextWidth, nextHeight);
    setSelectedPreset(matched ?? CUSTOM_PRESET_KEY);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <section className="text-modal" onPointerDown={(event) => event.stopPropagation()}>
        <h2>WINDOW</h2>

        <div className="modal-row">
          <label>SIZE:</label>
          <select
            value={selectedPreset}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedPreset(value);
              if (value === CUSTOM_PRESET_KEY) {
                return;
              }
              const [nextWidthRaw, nextHeightRaw] = value.split("x");
              const nextWidth = clampToPositiveInt(Number(nextWidthRaw));
              const nextHeight = clampToPositiveInt(Number(nextHeightRaw));
              setWidthFt(nextWidth);
              setHeightFt(nextHeight);
            }}
          >
            {WINDOW_PRESETS.map((preset) => (
              <option key={presetKey(preset.widthFt, preset.heightFt)} value={presetKey(preset.widthFt, preset.heightFt)}>
                {`${preset.widthFt}' x ${preset.heightFt}'`}
              </option>
            ))}
            <option value={CUSTOM_PRESET_KEY}>CUSTOM</option>
          </select>
        </div>

        <div className="modal-row">
          <label>WIDTH:</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => {
                const nextWidth = Math.max(1, widthFt - 1);
                setWidthFt(nextWidth);
                syncPresetFromValues(nextWidth, heightFt);
              }}
            >
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={widthFt}
              onChange={(event) => {
                const nextWidth = clampToPositiveInt(Number(event.target.value));
                setWidthFt(nextWidth);
                syncPresetFromValues(nextWidth, heightFt);
              }}
            />
            <span className="unit">'</span>
            <button
              type="button"
              onClick={() => {
                const nextWidth = Math.max(1, widthFt + 1);
                setWidthFt(nextWidth);
                syncPresetFromValues(nextWidth, heightFt);
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
                const nextHeight = Math.max(1, heightFt - 1);
                setHeightFt(nextHeight);
                syncPresetFromValues(widthFt, nextHeight);
              }}
            >
              ▼
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={heightFt}
              onChange={(event) => {
                const nextHeight = clampToPositiveInt(Number(event.target.value));
                setHeightFt(nextHeight);
                syncPresetFromValues(widthFt, nextHeight);
              }}
            />
            <span className="unit">'</span>
            <button
              type="button"
              onClick={() => {
                const nextHeight = Math.max(1, heightFt + 1);
                setHeightFt(nextHeight);
                syncPresetFromValues(widthFt, nextHeight);
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
