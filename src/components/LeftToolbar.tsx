import { useRef, useState } from "react";
import { calculateProjectMetrics } from "../utils/calculations";
import { useEditor } from "../state/EditorContext";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions";
import { getUtilityIconByToolId, isUtilityToolId } from "../assets/utilityIcons";
import { WindowModal } from "./WindowModal";
import type { WindowModalSubmit } from "./WindowModal";
import {
  exportProjectAsJson,
  importProjectFromJson,
  loadProjectFromLocalStorage,
  saveProjectToLocalStorage,
} from "../utils/persistence";
import type { ToolId } from "../types";

function clampPositiveInt(value: number, fallback: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(1, Math.round(normalized));
}

function ToolIcon({ toolId, fallback }: { toolId: ToolId; fallback: string }) {
  if (isUtilityToolId(toolId)) {
    return <img className="tool-icon-image" src={getUtilityIconByToolId(toolId)} alt="" aria-hidden="true" />;
  }

  if (toolId === "select") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 2 L4 20 L8.6 15.9 L11.6 22 L14.6 20.5 L11.5 14.6 L18 14.3 Z"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (toolId === "rectangle") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.2" y="6" width="17.6" height="12" fill="rgba(255,255,255,0.5)" stroke="#ffffff" strokeWidth="2.8" />
      </svg>
    );
  }

  if (toolId === "door") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 21 A10 10 0 0 1 13 11 L13 21 Z" fill="#a6a24a" />
        <path d="M3 21 A10 10 0 0 1 13 11" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="square" />
        <line x1="13" y1="11" x2="13" y2="21" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="square" />
        <line x1="3" y1="21" x2="13" y2="21" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="square" />
      </svg>
    );
  }

  if (toolId === "window") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.4" y="9.4" width="15.2" height="5.2" fill="none" stroke="#ffffff" strokeWidth="2.8" />
        <rect x="6.8" y="11" width="10.4" height="2" fill="#0f87a2" />
      </svg>
    );
  }

  if (toolId === "skylight") {
    return (
      <svg className="tool-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6.2" y="4.4" width="11.6" height="15.2" fill="none" stroke="#ffffff" strokeWidth="2.8" />
        <rect x="8" y="6.2" width="8" height="11.6" fill="#0f87a2" />
      </svg>
    );
  }

  if (toolId === "text") {
    return <span className="tool-icon-text-heavy">T</span>;
  }

  return <span className="icon">{fallback}</span>;
}

function ToolGroup({
  title,
  ids,
  onWindowToolConfigRequest,
}: {
  title: string;
  ids: ToolId[];
  onWindowToolConfigRequest?: () => void;
}) {
  const { state, dispatch } = useEditor();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPointerIdRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const longPressFiredRef = useRef(false);

  const clearWindowToolLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = null;
    longPressPointerIdRef.current = null;
  };

  const orderedTools = ids
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  return (
    <div className="tool-group">
      <h3>{title}</h3>
      <div className="tool-grid">
        {orderedTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool-btn ${state.activeTool === tool.id ? "active" : ""}`}
            onClick={() => {
              if (tool.id === "window" && longPressFiredRef.current) {
                longPressFiredRef.current = false;
                return;
              }
              dispatch({ type: "SET_TOOL", tool: tool.id });
            }}
            onContextMenu={(event) => {
              if (tool.id !== "window") {
                return;
              }
              event.preventDefault();
              dispatch({ type: "SET_TOOL", tool: "window" });
              onWindowToolConfigRequest?.();
            }}
            onPointerDown={(event) => {
              if (tool.id !== "window" || event.pointerType !== "touch") {
                return;
              }
              clearWindowToolLongPress();
              longPressFiredRef.current = false;
              longPressPointerIdRef.current = event.pointerId;
              longPressStartRef.current = { x: event.clientX, y: event.clientY };
              longPressTimerRef.current = setTimeout(() => {
                longPressFiredRef.current = true;
                dispatch({ type: "SET_TOOL", tool: "window" });
                onWindowToolConfigRequest?.();
                clearWindowToolLongPress();
              }, 520);
            }}
            onPointerMove={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              const dx = event.clientX - longPressStartRef.current.x;
              const dy = event.clientY - longPressStartRef.current.y;
              if (Math.hypot(dx, dy) > 8) {
                clearWindowToolLongPress();
              }
            }}
            onPointerUp={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              clearWindowToolLongPress();
            }}
            onPointerCancel={(event) => {
              if (tool.id !== "window" || longPressPointerIdRef.current !== event.pointerId) {
                return;
              }
              clearWindowToolLongPress();
            }}
            onPointerLeave={() => {
              if (tool.id !== "window") {
                return;
              }
              clearWindowToolLongPress();
            }}
          >
            <ToolIcon toolId={tool.id} fallback={tool.icon} />
            <span className="label">{tool.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LeftToolbar() {
  const { state, dispatch } = useEditor();
  const metrics = calculateProjectMetrics(state.project, state.previewEntity);
  const [windowToolModalOpen, setWindowToolModalOpen] = useState(false);

  const windowDefaultWidthFt = clampPositiveInt(Number(state.project.metadata.windowDefaultWidthFt ?? 3), 3);
  const windowDefaultHeightFt = clampPositiveInt(Number(state.project.metadata.windowDefaultHeightFt ?? 4), 4);

  return (
    <aside className="left-toolbar">
      <ToolGroup title="TOOLS" ids={["select", "rectangle", "text"]} />
      <ToolGroup
        title="BUILDING"
        ids={["door", "window", "skylight"]}
        onWindowToolConfigRequest={() => setWindowToolModalOpen(true)}
      />
      <ToolGroup title="UTILITIES" ids={["condenser", "heater", "dhw", "gas", "electric", "other"]} />

      <section className="details-panel">
        <h3>DETAILS</h3>
        <div className="stats-row">
          <span>Total Ft²</span>
          <strong>{metrics.conditionedAreaFt2.toFixed(0)}</strong>
        </div>
        <div className="stats-row">
          <span>Avg Ceiling Height</span>
          <strong>{metrics.averageCeilingHeightFt.toFixed(1)}</strong>
        </div>
        <div className="stats-row">
          <span>Total Volume</span>
          <strong>{metrics.volumeFt3.toFixed(0)}</strong>
        </div>
        <div className="stats-row">
          <span>Walls (ft)</span>
          <strong>{metrics.activeFloor.wallLengthFt.toFixed(1)}</strong>
        </div>
        <div className="stats-row">
          <span>Objects</span>
          <strong>{metrics.activeFloor.totalEntities}</strong>
        </div>

        <div className="field-row">
          <label htmlFor="projectName">Project</label>
          <input
            id="projectName"
            value={state.project.projectName}
            onChange={(event) => dispatch({ type: "SET_PROJECT_NAME", projectName: event.target.value })}
          />
        </div>
        <div className="field-row">
          <label htmlFor="address">Address</label>
          <input
            id="address"
            value={state.project.address}
            onChange={(event) => dispatch({ type: "SET_ADDRESS", address: event.target.value })}
          />
        </div>
      </section>

      <section className="dev-controls">
        <h3>DEV STATE</h3>
        <div className="dev-btns">
          <button type="button" onClick={() => saveProjectToLocalStorage(state.project)}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              const loaded = loadProjectFromLocalStorage();
              if (loaded) {
                dispatch({ type: "LOAD_PROJECT", project: loaded });
              }
            }}
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => {
              const json = exportProjectAsJson(state.project);
              navigator.clipboard.writeText(json).catch(() => undefined);
              window.alert("Project JSON copied to clipboard.");
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const input = window.prompt("Paste project JSON");
              if (!input) {
                return;
              }
              try {
                const project = importProjectFromJson(input);
                dispatch({ type: "LOAD_PROJECT", project });
              } catch {
                window.alert("Invalid JSON payload.");
              }
            }}
          >
            Import JSON
          </button>
          <button type="button" onClick={() => dispatch({ type: "RESET_PROJECT" })}>
            Reset
          </button>
        </div>
      </section>

      <button className="return-btn" type="button" onClick={() => window.history.back()}>
        Return
      </button>

      <WindowModal
        isOpen={windowToolModalOpen}
        initialWidthFt={windowDefaultWidthFt}
        initialHeightFt={windowDefaultHeightFt}
        onCancel={() => setWindowToolModalOpen(false)}
        onSubmit={(payload: WindowModalSubmit) => {
          dispatch({
            type: "SET_DEFAULT_WINDOW_SIZE",
            widthFt: payload.widthFt,
            heightFt: payload.heightFt,
          });
          setWindowToolModalOpen(false);
        }}
      />
    </aside>
  );
}
