import { useEditor } from "../state/EditorContext";

export function FloorTabs() {
  const { state, dispatch } = useEditor();

  return (
    <div className="floor-tabs" role="tablist" aria-label="Floors">
      {state.project.floors.map((floor) => (
        <button
          key={floor.id}
          type="button"
          role="tab"
          className={`floor-tab ${state.project.activeFloorId === floor.id ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_ACTIVE_FLOOR", floorId: floor.id })}
          onDoubleClick={() => {
            const nextName = window.prompt("Rename floor", floor.name);
            if (nextName && nextName.trim()) {
              dispatch({ type: "RENAME_LEVEL", floorId: floor.id, name: nextName.trim() });
            }
          }}
        >
          {floor.name}
        </button>
      ))}
      <button
        type="button"
        className="floor-tab add"
        onClick={() => {
          const count = state.project.floors.length + 1;
          dispatch({ type: "ADD_LEVEL", floorName: `Level ${count}` });
        }}
      >
        + New
      </button>
    </div>
  );
}
