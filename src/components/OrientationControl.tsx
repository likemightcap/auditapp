import { useEditor } from "../state/EditorContext";
import type { Orientation } from "../types";

const ORDER: Orientation[] = ["N", "E", "S", "W"];

export function OrientationControl() {
  const { state, dispatch } = useEditor();

  return (
    <div className="orientation-panel">
      <div className="orientation-title">ORIENTATION: {state.project.orientation}</div>
      <div className="orientation-grid" role="group" aria-label="Building orientation">
        {ORDER.map((value) => (
          <button
            key={value}
            type="button"
            className={`orientation-btn ${state.project.orientation === value ? "active" : ""}`}
            onClick={() => dispatch({ type: "SET_ORIENTATION", orientation: value })}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
